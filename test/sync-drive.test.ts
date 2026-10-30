import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startTestServer } from './helpers.ts'
import { startFakeGoogle } from './fake-google.ts'

const day = (over: Record<string, unknown> = {}) => ({ grateful: '', tasks: [], notes: '', sentence: '', ...over })

test('two notebooks sync through Google Drive (fake): sign in, start, take, edit, sign out', async () => {
  const google = await startFakeGoogle()
  const saved = { ...process.env }
  Object.assign(process.env, google.env)
  const a = await startTestServer()
  const b = await startTestServer()
  try {
    let r = await a.call('GET', '/api/sync')
    assert.equal(r.json.google.configured, true)
    assert.equal(r.json.google.connected, false)
    assert.equal(r.json.joined, null)

    const connect = async (s: typeof a) => {
      const { authUrl } = (await s.call('POST', '/api/sync/connect')).json
      assert.match(authUrl, /scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file/)
      assert.match(authUrl, /code_challenge_method=S256/)
      assert.equal(await google.approve(authUrl), 200)
      assert.equal((await s.call('GET', '/api/sync')).json.google.connected, true)
      assert.ok(!fs.readFileSync(path.join(s.dataDir, 'duckbook.sqlite')).includes('rt-fixture'), 'token is not in the notebook database')
    }

    await a.call('PUT', '/api/docs', { changes: [{ key: 'day:2026-10-28', baseRev: 0, value: day({ notes: 'synthetic note from A' }) }] })
    await connect(a)
    assert.deepEqual((await a.call('POST', '/api/sync/inspect')).json, { hasNotebook: false, localPages: 1 })
    r = await a.call('POST', '/api/sync/join', { mode: 'start' })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.ok(r.json.joined.notebookId)
    assert.ok([...google.files.values()].some((f) => f.name === 'Duckbook Sync'), 'a visible folder in Drive')

    await b.call('PUT', '/api/docs', { changes: [{ key: 'day:2026-10-01', baseRev: 0, value: day({ notes: 'synthetic page only on B' }) }] })
    await connect(b)
    assert.deepEqual((await b.call('POST', '/api/sync/inspect')).json, { hasNotebook: true, localPages: 1 })
    r = await b.call('POST', '/api/sync/join', { mode: 'replace' })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.ok(r.json.backup, 'B was backed up before taking the notebook')
    const docsOf = async (s: typeof a) => (await s.call('GET', '/api/data')).json.docs.map((d: { key: string; value: unknown }) => ({ key: d.key, value: d.value }))
    assert.deepEqual(await docsOf(b), await docsOf(a))

    // Edit on both; each sync carries the other's change. A tab on B still holding an older version merges.
    const onB = (await b.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === 'day:2026-10-28')
    const aRev = (await a.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === 'day:2026-10-28').rev
    await a.call('PUT', '/api/docs', { changes: [{ key: 'day:2026-10-28', baseRev: aRev, value: day({ notes: 'Synthetic note from A', grateful: 'A was here' }) }] })
    await a.call('POST', '/api/sync/now')
    r = await b.call('POST', '/api/sync/now')
    assert.equal(r.json.error, null)
    r = await b.call('PUT', '/api/docs', { changes: [{ key: 'day:2026-10-28', baseRev: onB.rev, value: { ...onB.value, notes: 'synthetic note from A, and B' } }] })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json.merged['day:2026-10-28'], day({ notes: 'Synthetic note from A, and B', grateful: 'A was here' }))
    await b.call('POST', '/api/sync/now')
    await a.call('POST', '/api/sync/now')
    assert.deepEqual(await docsOf(a), await docsOf(b))

    // Leaving keeps the pages and the Drive files; signing out forgets the token.
    const before = google.files.size
    r = await a.call('POST', '/api/sync/leave', { signOut: true })
    assert.equal(r.json.joined, null)
    assert.equal(r.json.google.connected, false)
    assert.equal(google.files.size, before)
    assert.equal((await docsOf(a)).length, 1, 'pages stay')
    assert.ok(!fs.existsSync(path.join(a.dataDir, 'sync-google.json')))
  } finally {
    await a.cleanup()
    await b.cleanup()
    await google.stop()
    process.env = saved
  }
})

test('sync API is locked behind the PIN like everything else', async () => {
  const s = await startTestServer()
  try {
    await s.call('PUT', '/api/lock-settings', { pinEnabled: true, pin: '123456', autoLockMin: 0 })
    await s.call('POST', '/api/lock')
    assert.equal((await s.call('GET', '/api/sync')).status, 401)
    assert.equal((await s.call('POST', '/api/sync/connect')).status, 401)
  } finally {
    await s.cleanup()
  }
})
