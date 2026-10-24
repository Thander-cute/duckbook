import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { start } from '../server/main.ts'
import { Store } from '../server/db.ts'
import { API_LEVEL, normalizeState } from '../src/lib/schema.ts'
import { fixtureLegacy } from './helpers.ts'

function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => {
    const file = path.join(entry.parentPath, entry.name)
    return [path.relative(root, file), createHash('sha256').update(fs.readFileSync(file)).digest('hex')]
  }))
}

test('desktop gate and read-only browser import: photos, replace consent, running refusal, atomic failures', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-web-import-'))
  const sourceDir = path.join(temp, 'source')
  const source = new Store(sourceDir)
  const jpeg = Buffer.from([255, 216, 255, 224, 11, 22, 33])
  const id = source.savePhoto(jpeg)
  const state = normalizeState(fixtureLegacy()).state
  state.days['2026-10-19'].photos = [{ full: id, thumb: id, w: 1, h: 1 }]
  source.replaceAll(state, { reason: 'pre-import', source: 'test' })
  source.close()
  const before = snapshot(sourceDir)
  const server = await start({ port: 0, dataDir: path.join(temp, 'target'), distDir: 'dist', token: 'test-token', webDataDir: sourceDir, webPort: 5396, quiet: true })
  const base = `http://127.0.0.1:${server.port}`
  const call = async (route: string, body?: unknown, extra: Record<string, string> = {}) => {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'X-Duckbook': '1', 'X-Duckbook-Api': String(API_LEVEL), 'X-Duckbook-Token': 'test-token', 'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json() as any }
  }
  try {
    for (const route of ['/api/health', '/api/status', '/api/data', `/api/photos/${id}`, '/api/import/web/preview']) {
      assert.equal((await call(route, undefined, { 'X-Duckbook-Token': '' })).status, 403)
      assert.equal((await call(route, undefined, { 'X-Duckbook-Token': 'wrong' })).status, 403)
    }
    assert.equal((await fetch(base)).status, 200)
    assert.equal((await call('/api/status')).body.desktop.webImport, true)
    let preview = await call('/api/import/web/preview')
    assert.equal(preview.body.photos, 1)
    assert.equal(preview.body.missingPhotos, 0)
    assert.equal(preview.body.summary.days, 1)
    let result = await call('/api/import/web', {})
    assert.equal(result.status, 200)
    assert.equal(result.body.photosCopied, 1)
    assert.deepEqual(server.store.readPhoto(id), jpeg)
    assert.deepEqual(snapshot(sourceDir), before, 'source unchanged byte for byte including directory contents')
    const saved = server.store.allDocs()
    assert.equal((await call('/api/import/web', {})).body.needsReplace, true)
    fs.writeFileSync(path.join(sourceDir, 'server.pid'), String(process.pid))
    assert.equal((await call('/api/import/web', { replace: true })).body.webServerRunning, true)
    preview = await call('/api/import/web/preview')
    assert.equal(preview.body.webServerRunning, true)
    assert.equal(preview.body.summary, null)
    fs.rmSync(path.join(sourceDir, 'server.pid'))
    fs.writeFileSync(path.join(sourceDir, 'photos', `${id}.jpg`), Buffer.from('bad hash'))
    assert.equal((await call('/api/import/web', { replace: true })).status, 422)
    assert.deepEqual(server.store.allDocs(), saved)
    fs.rmSync(path.join(sourceDir, 'photos', `${id}.jpg`))
    assert.equal((await call('/api/import/web/preview')).body.missingPhotos, 1)
    assert.equal((await call('/api/import/web', { replace: true })).status, 422)
    assert.deepEqual(server.store.allDocs(), saved)
    fs.writeFileSync(path.join(sourceDir, 'photos', `${id}.jpg`), jpeg)
    const savePhoto = server.store.savePhoto
    server.store.savePhoto = () => { throw new Error('synthetic copy failure') }
    assert.equal((await call('/api/import/web', { replace: true })).status, 500)
    assert.deepEqual(server.store.allDocs(), saved)
    server.store.savePhoto = savePhoto
    result = await call('/api/import/web', { replace: true })
    assert.equal(result.status, 200)
    assert.ok(result.body.backup)
    assert.deepEqual(snapshot(sourceDir), before)
  } finally {
    await server.stop()
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
