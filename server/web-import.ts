import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { docsToState, normalizeState, photoRefs, stateToDocs } from '../src/lib/schema.ts'
import { RestoreError, type StoredDoc, type Store } from './db.ts'

export function webServerRunning(dataDir: string) {
  const file = path.join(dataDir, 'server.pid')
  if (!fs.existsSync(file)) return false
  const pid = Number(fs.readFileSync(file, 'utf8'))
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

export async function webIsRunning(dataDir: string, port: number) {
  if (webServerRunning(dataDir)) return true
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { 'X-Duckbook': '1' }, signal: AbortSignal.timeout(800) })
    return response.ok && (await response.json() as { app?: string }).app === 'duckbook'
  } catch { return false }
}

export function readWeb(dataDir: string) {
  const file = path.join(dataDir, 'duckbook.sqlite')
  if (!fs.existsSync(file)) return null
  // SQLite readOnly still writes WAL reader sidecars. Open a disposable snapshot instead.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-web-snapshot-'))
  const copy = path.join(staging, 'duckbook.sqlite')
  let db: DatabaseSync | undefined
  try {
    fs.copyFileSync(file, copy)
    if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, `${copy}-wal`)
    db = new DatabaseSync(copy, { readOnly: true })
    db.exec('BEGIN')
    if ((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') throw new RestoreError('The browser notebook database is damaged. Nothing was imported.')
    const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
    if (version?.value !== '1') throw new RestoreError('The browser notebook database version is not supported.')
    const rows = db.prepare('SELECT key, value, rev FROM docs ORDER BY key').all() as { key: string; value: string; rev: number }[]
    const docs: StoredDoc[] = rows.map((row) => ({ ...row, value: JSON.parse(row.value) }))
    const normalized = normalizeState(docsToState(docs))
    const photos = new Map<string, Buffer>()
    let missingPhotos = 0
    for (const id of photoRefs(stateToDocs(normalized.state))) {
      const photo = path.join(dataDir, 'photos', `${id}.jpg`)
      if (!fs.existsSync(photo)) { missingPhotos++; continue }
      const bytes = fs.readFileSync(photo)
      if (createHash('sha256').update(bytes).digest('hex') !== id) throw new RestoreError('A browser notebook photo failed its hash check. Nothing was imported.')
      photos.set(id, bytes)
    }
    db.exec('COMMIT')
    return { ...normalized, photos, missingPhotos }
  } finally {
    db?.close()
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

export function importWeb(store: Store, source: NonNullable<ReturnType<typeof readWeb>>) {
  if (source.missingPhotos) throw new RestoreError('Some browser notebook photos are missing. Nothing was imported; keep the browser copy to recover them.')
  for (const [id, bytes] of source.photos) {
    store.savePhoto(bytes)
    const actual = store.readPhoto(id)
    if (!actual || createHash('sha256').update(actual).digest('hex') !== id) throw new RestoreError('A copied photo could not be verified. Pages were not changed.')
  }
  const out = store.replaceAll(source.state, { reason: 'pre-import', source: 'web', quarantine: source.quarantine })
  store.setMeta('migration', null)
  return { ...out, issueCount: source.issues.length, docs: store.allDocs(), photosCopied: source.photos.size }
}
