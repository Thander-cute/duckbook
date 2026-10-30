// Moves operations between this device and the shared folder: push this device's new operations as
// one file, pull other devices' files, and copy day photos both ways. Local saving never waits for it.

import { createHash } from 'node:crypto'
import { parseDocKey, photoRefs } from '../../src/lib/schema.ts'
import type { Store } from '../db.ts'
import type { Op } from './engine.ts'
import type { Remote, RemoteFile } from './remote.ts'

const NOTEBOOK = 'notebook.json'
const OPS_FILE = /^ops-([0-9a-f]{16})-(\d{12})\.json$/
const PHOTO_FILE = /^photo-([0-9a-f]{64})\.jpg$/
const TS = /^\d{13}\.\d{6}\.[0-9a-f]{16}$/
const MAX_OPS_FILE = 50 * 1024 * 1024
/** Files listed by modification time are re-listed this far back, for clock differences and slow uploads. */
const OVERLAP_MS = 10 * 60_000

export interface SyncConfig { notebookId: string; joinedAt: string }
export interface SyncState { lastSync: string | null; error: string | null; running: boolean }
export type JoinMode = 'start' | 'replace' | 'merge'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function validOp(o: unknown): o is Op {
  if (!isObj(o) || typeof o.id !== 'string' || o.id.length > 64 || typeof o.dev !== 'string' || !/^[0-9a-f]{16}$/.test(o.dev)) return false
  if (typeof o.ts !== 'string' || !TS.test(o.ts) || typeof o.key !== 'string' || !parseDocKey(o.key) || typeof o.path !== 'string') return false
  try {
    if (!Array.isArray(JSON.parse(o.path))) return false
  } catch {
    return false
  }
  return (o.kind === 'set' && 'value' in o) || (o.kind === 'text' && typeof o.upd === 'string')
}

export class SyncRunner {
  readonly store: Store
  private remote: () => Promise<Remote | null>
  private log: (msg: string) => void
  private running: Promise<void> | null = null
  private again = false
  private error: string | null = null
  private timer: NodeJS.Timeout | null = null
  private nudgeTimer: NodeJS.Timeout | null = null

  constructor(store: Store, remote: () => Promise<Remote | null>, log: (msg: string) => void = () => {}) {
    this.store = store
    this.remote = remote
    this.log = log
    store.db.exec('CREATE TABLE IF NOT EXISTS sync_files (name TEXT PRIMARY KEY, at TEXT NOT NULL)')
  }

  config() {
    return this.store.getMeta<SyncConfig>('sync_config') ?? null
  }

  state(): SyncState {
    return { lastSync: this.store.getMeta<string>('sync_last') ?? null, error: this.error, running: !!this.running }
  }

  /** Sync every `everyMs` while joined, and shortly after local saves (see nudge). */
  start(everyMs = 60_000) {
    this.stop()
    this.timer = setInterval(() => void this.syncNow().catch(() => {}), everyMs)
    this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer)
    this.timer = this.nudgeTimer = null
  }

  /** A page was saved here: push it soon, batching quick successive saves into one file. */
  nudge(delayMs = 5000) {
    if (!this.config()) return
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer)
    this.nudgeTimer = setTimeout(() => void this.syncNow().catch(() => {}), delayMs)
    this.nudgeTimer.unref()
  }

  /** What the folder holds, to decide how to join. */
  async inspect() {
    const remote = await this.need()
    const files = await remote.list()
    return { hasNotebook: files.some((f) => f.name === NOTEBOOK), localPages: this.store.docCount() }
  }

  /**
   * Join the folder's notebook. 'start': the folder is empty, this notebook becomes the shared one.
   * 'replace': take the folder's notebook (a verified backup of this one first). 'merge': combine both.
   */
  async join(mode: JoinMode) {
    if (this.config()) throw new Error('Sync is already on.')
    const remote = await this.need()
    const files = await remote.list()
    const notebook = files.find((f) => f.name === NOTEBOOK)
    let notebookId: string
    if (mode === 'start') {
      if (notebook) throw new Error('This Drive already has a duckbook notebook. Take it, or merge with it.')
      notebookId = createHash('sha256').update(`${Date.now()}${Math.random()}`).digest('hex').slice(0, 16)
      await remote.create(NOTEBOOK, Buffer.from(JSON.stringify({ format: 'duckbook-sync', version: 1, notebookId, createdAt: new Date().toISOString() })), 'application/json')
    } else {
      if (!notebook) throw new Error('There is no duckbook notebook in this Drive yet.')
      const meta = JSON.parse((await remote.read(notebook)).toString('utf8'))
      if (!isObj(meta) || meta.format !== 'duckbook-sync' || typeof meta.notebookId !== 'string') throw new Error('The notebook file in Drive is not one duckbook can read.')
      if (typeof meta.version !== 'number' || meta.version > 1) throw new Error('The notebook in Drive was made by a newer duckbook. Update this app first.')
      notebookId = meta.notebookId
    }
    let backup: string | null = null
    if (mode === 'replace') {
      // Download everything first; only then replace, in one transaction.
      const all: Op[] = []
      const names: string[] = []
      for (const f of files.filter((f) => OPS_FILE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name))) {
        all.push(...(await this.readOps(remote, f)))
        names.push(f.name)
      }
      backup = this.store.takeRemote(all).backup
      this.markApplied(names)
    }
    this.store.setMeta('sync_pushed', mode === 'replace' ? this.store.sync.lastSeq() : 0)
    this.store.setMeta('sync_config', { notebookId, joinedAt: new Date().toISOString() } satisfies SyncConfig)
    this.store.setMeta('sync_listed', null)
    this.log(`sync: joined (${mode})`)
    await this.syncNow()
    return { backup }
  }

  /** Stop syncing on this device. Pages stay; nothing in Drive is deleted. */
  leave() {
    this.stop()
    this.store.setMeta('sync_config', null)
    this.store.setMeta('sync_pushed', null)
    this.store.setMeta('sync_listed', null)
    this.store.db.exec('DELETE FROM sync_files')
    this.error = null
  }

  /** One sync at a time; a call during a sync runs another one right after it. */
  syncNow(): Promise<void> {
    if (!this.config()) return Promise.resolve()
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        try {
          await this.once()
          this.error = null
          this.store.setMeta('sync_last', new Date().toISOString())
        } catch (e) {
          this.error = (e as Error).message
          this.log(`sync: ${this.error}`)
          throw e
        }
      } while (this.again)
    })().finally(() => (this.running = null))
    return this.running
  }

  private async need() {
    const remote = await this.remote()
    if (!remote) throw new Error('Google Drive is not connected.')
    return remote
  }

  private async once() {
    const remote = await this.need()
    const startedAt = Date.now()
    const listedAt = this.store.getMeta<string>('sync_listed')
    const files = await remote.list(listedAt ? new Date(Date.parse(listedAt) - OVERLAP_MS).toISOString() : undefined)
    await this.push(remote)
    await this.pull(remote, files)
    await this.photos(remote)
    this.store.setMeta('sync_listed', new Date(startedAt).toISOString())
  }

  private async push(remote: Remote) {
    const sync = this.store.sync
    for (;;) {
      const after = this.store.getMeta<number>('sync_pushed') ?? 0
      const batch = sync.localOps(after)
      if (!batch.length) return
      const last = batch[batch.length - 1].seq
      const body = Buffer.from(JSON.stringify({ format: 'duckbook-ops', version: 1, dev: sync.device, ops: batch.map((b) => b.op) }))
      await remote.create(`ops-${sync.device}-${String(last).padStart(12, '0')}.json`, body, 'application/json')
      this.store.setMeta('sync_pushed', last)
    }
  }

  private async readOps(remote: Remote, f: RemoteFile): Promise<Op[]> {
    const raw = await remote.read(f)
    if (raw.length > MAX_OPS_FILE) throw new Error(`${f.name} is too large.`)
    const body = JSON.parse(raw.toString('utf8'))
    if (!isObj(body) || body.format !== 'duckbook-ops' || !Array.isArray(body.ops)) throw new Error(`${f.name} is not a duckbook changes file.`)
    if (typeof body.version !== 'number' || body.version > 1) throw new Error('Another device runs a newer duckbook. Update this app to keep syncing.')
    const dev = OPS_FILE.exec(f.name)![1]
    if (!body.ops.every((o: unknown) => validOp(o) && o.dev === dev)) throw new Error(`${f.name} has changes duckbook can't read.`)
    return body.ops as Op[]
  }

  private markApplied(names: string[]) {
    const ins = this.store.db.prepare('INSERT INTO sync_files (name, at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING')
    const now = new Date().toISOString()
    for (const n of names) ins.run(n, now)
  }

  private async pull(remote: Remote, files: RemoteFile[]) {
    const seen = this.store.db.prepare('SELECT 1 FROM sync_files WHERE name = ?')
    const fresh = files
      .filter((f) => {
        const m = OPS_FILE.exec(f.name)
        return m && m[1] !== this.store.sync.device && !seen.get(f.name)
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const f of fresh) {
      const changed = this.store.applyRemote(await this.readOps(remote, f))
      this.markApplied([f.name])
      if (changed.length) this.log(`sync: ${changed.length} page(s) updated from ${f.name.slice(4, 12)}`)
    }
  }

  private async photos(remote: Remote) {
    const refs = photoRefs(this.store.allDocs())
    if (!refs.size) return
    const sent = new Set((this.store.db.prepare('SELECT name FROM sync_files WHERE name LIKE ?').all('photo-%') as { name: string }[]).map((r) => r.name))
    const missingHere = [...refs].filter((id) => !this.store.readPhoto(id))
    const toSend = [...refs].filter((id) => !sent.has(`photo-${id}.jpg`) && this.store.readPhoto(id))
    if (!missingHere.length && !toSend.length) return
    // Photos may predate the last listing, so look at everything when there is work to do.
    const all = await remote.list()
    const there = new Map(all.filter((f) => PHOTO_FILE.test(f.name)).map((f) => [f.name, f]))
    for (const id of toSend) {
      const name = `photo-${id}.jpg`
      if (!there.has(name)) await remote.create(name, this.store.readPhoto(id)!, 'image/jpeg')
      this.markApplied([name])
    }
    for (const id of missingHere) {
      const f = there.get(`photo-${id}.jpg`)
      if (!f) continue
      const bytes = await remote.read(f)
      if (createHash('sha256').update(bytes).digest('hex') !== id) {
        this.log(`sync: photo ${id.slice(0, 8)} in Drive is damaged; skipped`)
        continue
      }
      this.store.savePhoto(bytes)
      this.markApplied([f.name])
    }
  }
}
