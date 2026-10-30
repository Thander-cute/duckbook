// The op-log: every saved change becomes small operations on page leaves. Leaves merge
// last-writer-wins by a hybrid clock, free text merges character by character (Yjs), so applying
// the same operations in any order on any device gives the same pages.

import type { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import * as Y from 'yjs'
import { DEL, diff, flatten, isTextPath, parsePath, pathKey, unflatten, type LeafValue } from '../../src/lib/tree.ts'

export interface Op {
  id: string
  dev: string
  ts: string
  key: string
  path: string
  kind: 'set' | 'text'
  value?: LeafValue
  /** Yjs update, base64. */
  upd?: string
}

const ROOT = pathKey([])

const hash32 = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h
}

export class Sync {
  readonly db: DatabaseSync
  device = ''
  private client = 0

  constructor(db: DatabaseSync) {
    this.db = db
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_leaves (key TEXT NOT NULL, path TEXT NOT NULL, ts TEXT NOT NULL, value TEXT NOT NULL, ystate BLOB,
        PRIMARY KEY (key, path));
      CREATE TABLE IF NOT EXISTS sync_ops (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, dev TEXT NOT NULL, ts TEXT NOT NULL,
        key TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, value TEXT, upd BLOB);
    `)
    this.useDevice(this.meta<string>('sync_device') ?? randomBytes(8).toString('hex'))
  }

  private useDevice(dev: string) {
    this.setMeta('sync_device', dev)
    this.device = dev
    this.client = hash32(dev)
  }

  /** Forget every operation and start as a new device (before taking a notebook from another device). */
  reset() {
    this.db.exec('DELETE FROM sync_leaves; DELETE FROM sync_ops;')
    this.useDevice(randomBytes(8).toString('hex'))
  }

  /** Highest operation number on this device. */
  lastSeq() {
    return (this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM sync_ops').get() as { n: number }).n
  }

  private meta<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  private setMeta(key: string, value: unknown) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
  }

  // ───────── hybrid logical clock: wall time, then a counter, then the device ─────────

  private tick(): string {
    const last = this.meta<{ ms: number; c: number }>('sync_clock') ?? { ms: 0, c: 0 }
    const now = Date.now()
    const next = now > last.ms ? { ms: now, c: 0 } : { ms: last.ms, c: last.c + 1 }
    this.setMeta('sync_clock', next)
    return `${String(next.ms).padStart(13, '0')}.${String(next.c).padStart(6, '0')}.${this.device}`
  }

  /** After seeing another device's change, every later local change is ordered after it. */
  private observe(ts: string) {
    const [ms, c] = ts.split('.').map(Number)
    const last = this.meta<{ ms: number; c: number }>('sync_clock') ?? { ms: 0, c: 0 }
    if (ms > last.ms || (ms === last.ms && c > last.c)) this.setMeta('sync_clock', { ms, c })
  }

  private newId = () => randomBytes(9).toString('base64url')

  isEmpty() {
    return !this.db.prepare('SELECT 1 FROM sync_leaves LIMIT 1').get()
  }

  /** Record a page saved on this device. `after` undefined deletes the page. Call inside the save's transaction. */
  recordLocal(key: string, before: unknown, after: unknown): Op[] {
    const changes = after === undefined ? new Map<string, LeafValue>([[ROOT, DEL]]) : diff(before === undefined ? new Map() : flatten(before), flatten(after))
    const ops: Op[] = []
    for (const [path, value] of changes) {
      const op = typeof value === 'string' && isTextPath(parsePath(path)) ? this.textOp(key, path, value) : { id: this.newId(), dev: this.device, ts: this.tick(), key, path, kind: 'set' as const, value }
      if (op) {
        this.apply(op)
        ops.push(op)
      }
    }
    return ops
  }

  private loadText(key: string, path: string) {
    const row = this.db.prepare('SELECT ystate FROM sync_leaves WHERE key = ? AND path = ?').get(key, path) as { ystate: Uint8Array | null } | undefined
    const doc = new Y.Doc()
    if (row?.ystate) Y.applyUpdate(doc, row.ystate)
    return { doc, fresh: !row?.ystate }
  }

  private textOp(key: string, path: string, text: string): Op | null {
    const { doc, fresh } = this.loadText(key, path)
    // Set after loading: Yjs picks a new id if a loaded update already uses the doc's own.
    // The first text in a field gets an id derived from the content, so the same starting text
    // written on two devices (one notebook imported into another) merges into one copy, not two.
    doc.clientID = fresh && text ? hash32(`${key}\0${path}\0${text}`) : this.client
    const t = doc.getText('t')
    const cur = t.toString()
    if (cur === text) return null
    let a = 0
    while (a < cur.length && a < text.length && cur[a] === text[a]) a++
    let b = 0
    while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++
    const sv = Y.encodeStateVector(doc)
    doc.transact(() => {
      if (cur.length - a - b) t.delete(a, cur.length - a - b)
      if (text.length - a - b) t.insert(a, text.slice(a, text.length - b))
    })
    const upd = Buffer.from(Y.encodeStateAsUpdate(doc, sv)).toString('base64')
    return { id: this.newId(), dev: this.device, ts: this.tick(), key, path, kind: 'text', upd }
  }

  /** Apply one operation (local or from another device). Returns false if it was already applied. */
  apply(op: Op): boolean {
    const r = this.db
      .prepare('INSERT INTO sync_ops (id, dev, ts, key, path, kind, value, upd) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .run(op.id, op.dev, op.ts, op.key, op.path, op.kind, op.value === undefined ? null : JSON.stringify(op.value), op.upd ? Buffer.from(op.upd, 'base64') : null)
    if (!r.changes) return false
    this.observe(op.ts)
    const row = this.db.prepare('SELECT ts FROM sync_leaves WHERE key = ? AND path = ?').get(op.key, op.path) as { ts: string } | undefined
    if (op.kind === 'text') {
      const { doc } = this.loadText(op.key, op.path)
      Y.applyUpdate(doc, Buffer.from(op.upd ?? '', 'base64'))
      const ts = row && row.ts > op.ts ? row.ts : op.ts
      this.db
        .prepare(
          'INSERT INTO sync_leaves (key, path, ts, value, ystate) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key, path) DO UPDATE SET ts = excluded.ts, value = excluded.value, ystate = excluded.ystate',
        )
        .run(op.key, op.path, ts, JSON.stringify(doc.getText('t').toString()), Y.encodeStateAsUpdate(doc))
    } else if (!row || op.ts > row.ts) {
      this.db
        .prepare('INSERT INTO sync_leaves (key, path, ts, value) VALUES (?, ?, ?, ?) ON CONFLICT(key, path) DO UPDATE SET ts = excluded.ts, value = excluded.value')
        .run(op.key, op.path, op.ts, JSON.stringify(op.value))
    }
    return true
  }

  /** The page as the merged leaves describe it, before validation. `undefined` if absent or deleted. */
  materialize(key: string): unknown {
    const rows = this.db.prepare('SELECT path, ts, value FROM sync_leaves WHERE key = ?').all(key) as { path: string; ts: string; value: string }[]
    return unflatten(rows.map((r) => ({ path: parsePath(r.path), ts: r.ts, value: JSON.parse(r.value) as LeafValue })))
  }

  /** This device's operations after `seq`, oldest first, for sending to other devices. */
  localOps(afterSeq = 0, limit = 5000): { seq: number; op: Op }[] {
    const rows = this.db
      .prepare('SELECT seq, id, dev, ts, key, path, kind, value, upd FROM sync_ops WHERE dev = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(this.device, afterSeq, limit) as { seq: number; id: string; dev: string; ts: string; key: string; path: string; kind: 'set' | 'text'; value: string | null; upd: Uint8Array | null }[]
    return rows.map((r) => ({
      seq: r.seq,
      op: {
        id: r.id,
        dev: r.dev,
        ts: r.ts,
        key: r.key,
        path: r.path,
        kind: r.kind,
        ...(r.value !== null ? { value: JSON.parse(r.value) as LeafValue } : {}),
        ...(r.upd ? { upd: Buffer.from(r.upd).toString('base64') } : {}),
      },
    }))
  }
}
