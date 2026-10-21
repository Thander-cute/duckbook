// SQLite storage for the planner: one row per page, global monotonically increasing revisions,
// verified backups, and verified restore/import. Node's built-in node:sqlite, synchronous API:
// every function here runs to completion without interleaving with other requests.

import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { docsToState, normalizeDoc, parseDocKey, stateToDocs, summarize, type Doc, type Quarantined, type State } from '../src/lib/schema.ts'

export interface StoredDoc { key: string; rev: number; value: unknown }
export interface Change { key: string; baseRev: number; value: unknown }
export interface BackupInfo { file: string; kind: string; createdAt: string; docs: number; bytes: number; verified: boolean }

export class ConflictError extends Error {
  conflicts: StoredDoc[]
  constructor(conflicts: StoredDoc[]) {
    super('Some pages were changed in another tab.')
    this.conflicts = conflicts
  }
}

export class RestoreError extends Error {}

const BACKUP_FILE = /^duckbook-\d{8}-\d{6}-\d{3}-[a-z-]+\.sqlite$/
const KEEP_AUTO = 30
const KEEP_OTHER = 20

export class Store {
  readonly db: DatabaseSync
  readonly dataDir: string
  readonly backupDir: string

  constructor(dataDir: string) {
    this.dataDir = dataDir
    this.backupDir = path.join(dataDir, 'backups')
    fs.mkdirSync(this.backupDir, { recursive: true })
    this.db = new DatabaseSync(path.join(dataDir, 'duckbook.sqlite'))
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS backups (file TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL,
        docs INTEGER NOT NULL, bytes INTEGER NOT NULL, verified INTEGER NOT NULL, content_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantine (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT NOT NULL,
        path TEXT NOT NULL, value TEXT NOT NULL);
    `)
    const v = this.getMeta<number>('schema_version')
    if (v === undefined) {
      this.setMeta('schema_version', 1)
      this.setMeta('created_at', new Date().toISOString())
    } else if (v > 1) {
      throw new Error(`The database was created by a newer duckbook (schema ${v}). Refusing to open it.`)
    }
  }

  close() {
    this.db.close()
  }

  getMeta<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  setMeta(key: string, value: unknown) {
    if (value === undefined || value === null) this.db.prepare('DELETE FROM meta WHERE key = ?').run(key)
    else this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** Every write gets a revision never used before, so stale tabs can't match after an import or restore. */
  private nextRev() {
    const r = (this.getMeta<number>('rev_counter') ?? 0) + 1
    this.setMeta('rev_counter', r)
    return r
  }

  private touch() {
    this.setMeta('data_version', (this.getMeta<number>('data_version') ?? 0) + 1)
  }

  docCount() {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM docs').get() as { n: number }).n
  }

  allDocs(db: DatabaseSync = this.db): StoredDoc[] {
    const rows = db.prepare('SELECT key, value, rev FROM docs ORDER BY key').all() as { key: string; value: string; rev: number }[]
    return rows.map((r) => ({ key: r.key, rev: r.rev, value: JSON.parse(r.value) }))
  }

  /** Compare-and-swap save of changed pages. All or nothing. */
  putDocs(changes: Change[], force = false): Record<string, number> {
    const clean = changes.map((c) => ({ key: c.key, baseRev: c.baseRev, value: normalizeDoc(c.key, c.value) }))
    return this.tx(() => {
      const get = this.db.prepare('SELECT key, value, rev FROM docs WHERE key = ?')
      const conflicts: StoredDoc[] = []
      for (const c of clean) {
        const cur = get.get(c.key) as { key: string; value: string; rev: number } | undefined
        if ((cur?.rev ?? 0) !== c.baseRev && !force) conflicts.push(cur ? { key: cur.key, rev: cur.rev, value: JSON.parse(cur.value) } : { key: c.key, rev: 0, value: null })
      }
      if (conflicts.length) throw new ConflictError(conflicts)
      const put = this.db.prepare(
        'INSERT INTO docs (key, value, rev, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, rev = excluded.rev, updated_at = excluded.updated_at',
      )
      const now = new Date().toISOString()
      const revs: Record<string, number> = {}
      for (const c of clean) {
        const rev = this.nextRev()
        put.run(c.key, JSON.stringify(c.value), rev, now)
        revs[c.key] = rev
      }
      this.touch()
      return revs
    })
  }

  contentHash(db: DatabaseSync = this.db) {
    const h = createHash('sha256')
    for (const d of this.allDocs(db)) h.update(d.key).update('\0').update(JSON.stringify(d.value)).update('\0')
    return h.digest('hex')
  }

  /**
   * Replace every page with `state` (import, migration, restore). Takes a verified backup first,
   * writes in one transaction, then reads everything back and compares before reporting success.
   */
  replaceAll(input: State | Doc[], opts: { reason: 'pre-import' | 'pre-migration' | 'pre-restore'; quarantine?: Quarantined[]; source: string }) {
    const docs = (Array.isArray(input) ? input : stateToDocs(input)).map((d) => ({ key: d.key, value: normalizeDoc(d.key, d.value) }))
    const backup = this.docCount() ? this.createBackup(opts.reason) : null
    this.tx(() => {
      this.db.exec('DELETE FROM docs')
      const put = this.db.prepare('INSERT INTO docs (key, value, rev, updated_at) VALUES (?, ?, ?, ?)')
      const now = new Date().toISOString()
      for (const d of docs) put.run(d.key, JSON.stringify(d.value), this.nextRev(), now)
      const q = this.db.prepare('INSERT INTO quarantine (at, source, path, value) VALUES (?, ?, ?, ?)')
      for (const item of opts.quarantine ?? []) q.run(now, opts.source, item.path, JSON.stringify(item.value) ?? 'null')
      this.touch()
    })
    const expected = JSON.stringify(docs.sort((a, b) => a.key.localeCompare(b.key)))
    const actual = JSON.stringify(this.allDocs().map((d) => ({ key: d.key, value: d.value })))
    if (expected !== actual) throw new RestoreError('Pages read back after writing did not match. Your previous pages are in the backup taken just before.')
    return { backup: backup?.file ?? null, summary: summarize(docsToState(docs)) }
  }

  // ───────── backups ─────────

  createBackup(kind: string): BackupInfo {
    const now = new Date()
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d{3})Z$/, '-$1')
    const file = `duckbook-${stamp}-${kind}.sqlite`
    const full = path.join(this.backupDir, file)
    this.db.prepare('VACUUM INTO ?').run(full)
    const hash = this.contentHash()
    const docs = this.docCount()
    let verified = false
    const copy = new DatabaseSync(full, { readOnly: true })
    try {
      const ok = (copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check === 'ok'
      verified = ok && this.contentHash(copy) === hash
    } finally {
      copy.close()
    }
    if (!verified) {
      fs.rmSync(full, { force: true })
      throw new Error('Backup failed its verification check and was discarded.')
    }
    const bytes = fs.statSync(full).size
    this.db
      .prepare('INSERT INTO backups (file, kind, created_at, docs, bytes, verified, content_hash) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(file, kind, now.toISOString(), docs, bytes, hash)
    this.setMeta('last_backup', { at: now.toISOString(), dataVersion: this.getMeta<number>('data_version') ?? 0 })
    this.pruneBackups()
    return { file, kind, createdAt: now.toISOString(), docs, bytes, verified }
  }

  /** Take an automatic backup if pages changed since the last one and it's been at least `minHours`. */
  autoBackup(minHours: number): BackupInfo | null {
    const last = this.getMeta<{ at: string; dataVersion: number }>('last_backup')
    const version = this.getMeta<number>('data_version') ?? 0
    if (!this.docCount() || (last && last.dataVersion === version)) return null
    if (last && Date.now() - Date.parse(last.at) < minHours * 3600_000) return null
    return this.createBackup('auto')
  }

  listBackups(): BackupInfo[] {
    const rows = this.db.prepare('SELECT file, kind, created_at, docs, bytes, verified FROM backups ORDER BY created_at DESC').all() as {
      file: string
      kind: string
      created_at: string
      docs: number
      bytes: number
      verified: number
    }[]
    return rows
      .filter((r) => fs.existsSync(path.join(this.backupDir, r.file)))
      .map((r) => ({ file: r.file, kind: r.kind, createdAt: r.created_at, docs: r.docs, bytes: r.bytes, verified: r.verified === 1 }))
  }

  private pruneBackups() {
    const all = this.listBackups()
    const drop = [...all.filter((b) => b.kind === 'auto').slice(KEEP_AUTO), ...all.filter((b) => b.kind !== 'auto').slice(KEEP_OTHER)]
    for (const b of drop) {
      fs.rmSync(path.join(this.backupDir, b.file), { force: true })
      this.db.prepare('DELETE FROM backups WHERE file = ?').run(b.file)
    }
  }

  /** Restore pages from a backup file. The current pages are backed up first; lock settings are kept. */
  restoreBackup(file: string) {
    if (!BACKUP_FILE.test(file)) throw new RestoreError('Unknown backup.')
    const row = this.db.prepare('SELECT content_hash FROM backups WHERE file = ?').get(file) as { content_hash: string } | undefined
    const full = path.join(this.backupDir, file)
    if (!row || !fs.existsSync(full)) throw new RestoreError('That backup file is missing.')
    const copy = new DatabaseSync(full, { readOnly: true })
    let docs: StoredDoc[]
    try {
      const ok = (copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check === 'ok'
      if (!ok || this.contentHash(copy) !== row.content_hash) throw new RestoreError('That backup is damaged; nothing was changed.')
      docs = this.allDocs(copy)
    } finally {
      copy.close()
    }
    const result = this.replaceAll(docs.filter((d) => parseDocKey(d.key)), { reason: 'pre-restore', source: `restore:${file}` })
    if (this.contentHash() !== row.content_hash) throw new RestoreError('Restored pages did not match the backup. Your previous pages are in the pre-restore backup.')
    return result
  }
}
