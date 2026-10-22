import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fixtureLegacy, startTestServer } from './helpers.ts'
import { normalizeState, stateToDocs } from '../src/lib/schema.ts'

const rawRequest = (port: number, headers: Record<string, string>, urlPath = '/api/health') =>
  new Promise<number>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })

test('host, header, and origin checks', async () => {
  const s = await startTestServer()
  try {
    assert.equal(await rawRequest(s.port, { Host: `evil.example:${s.port}`, 'X-Duckbook': '1' }), 421, 'DNS-rebinding host refused')
    assert.equal(await rawRequest(s.port, { Host: `localhost:${s.port}` }, '/api/data'), 403, 'missing app header refused')
    assert.equal((await s.call('GET', '/api/data', undefined, { Origin: 'http://evil.example' })).status, 403, 'foreign Origin refused')
    assert.equal((await s.call('GET', '/api/data', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'cross-site refused')
    assert.equal((await s.call('GET', '/api/data', undefined, { Origin: `http://localhost:${s.port}` })).status, 200)
    assert.equal(await rawRequest(s.port, { Host: `localhost:${s.port}` }, '/'), 200, 'app shell served')
  } finally {
    await s.cleanup()
  }
})

test('save, conflict, and strict validation', async () => {
  const s = await startTestServer()
  try {
    const day = { grateful: 'synthetic', tasks: [], notes: '', sentence: '' }
    let r = await s.call('PUT', '/api/docs', { changes: [{ key: 'day:2026-10-19', baseRev: 0, value: day }] })
    assert.equal(r.status, 200)
    const rev = r.json.revs['day:2026-10-19']
    assert.ok(rev > 0)

    r = await s.call('PUT', '/api/docs', { changes: [{ key: 'day:2026-10-19', baseRev: 0, value: { ...day, notes: 'stale tab' } }] })
    assert.equal(r.status, 409, 'stale base revision is a conflict')
    assert.equal(r.json.conflicts[0].value.notes, '', 'conflict returns the saved version')

    r = await s.call('PUT', '/api/docs', {
      changes: [
        { key: 'day:2026-10-20', baseRev: 0, value: day },
        { key: 'day:2026-10-19', baseRev: 0, value: day },
      ],
    })
    assert.equal(r.status, 409)
    assert.equal((await s.call('GET', '/api/data')).json.docs.length, 1, 'a batch with one conflict writes nothing')

    assert.equal((await s.call('PUT', '/api/docs', { changes: [{ key: 'day:2026-02-31', baseRev: 0, value: day }] })).status, 400, 'impossible date')
    assert.equal((await s.call('PUT', '/api/docs', { changes: [{ key: 'day:2026-10-21', baseRev: 0, value: { notes: 42 } }] })).status, 400, 'wrong type')
    assert.equal((await s.call('PUT', '/api/docs', { changes: [{ key: 'evil', baseRev: 0, value: {} }] })).status, 400, 'unknown key')

    r = await s.call('PUT', '/api/docs', { changes: [{ key: 'day:2026-10-19', baseRev: rev, value: { ...day, notes: 'next' } }] })
    assert.equal(r.status, 200)
  } finally {
    await s.cleanup()
  }
})

test('legacy migration is verified, marked, and never clobbers silently', async () => {
  const s = await startTestServer()
  try {
    const legacy = fixtureLegacy()
    let r = await s.call('POST', '/api/import/preview', { data: legacy })
    assert.equal(r.status, 200)
    assert.deepEqual([r.json.summary.months, r.json.summary.weeks, r.json.summary.days], [1, 1, 1])

    r = await s.call('POST', '/api/import', { data: legacy, source: 'legacy', sourceHash: 'abc' })
    assert.equal(r.status, 200)
    const expected = normalizeState(legacy).state
    const byKey = Object.fromEntries(r.json.docs.map((d: { key: string; value: unknown }) => [d.key, d.value]))
    for (const d of stateToDocs(expected)) assert.deepEqual(byKey[d.key], d.value, `${d.key} round-trips`)
    assert.equal((await s.call('GET', '/api/status')).json.migration.sourceHash, 'abc')

    r = await s.call('POST', '/api/import', { data: legacy, source: 'legacy' })
    assert.equal(r.status, 409, 'second import needs explicit replace')
    assert.equal(r.json.needsReplace, true)

    r = await s.call('POST', '/api/import', { data: legacy, source: 'legacy', replace: true })
    assert.equal(r.status, 200)
    assert.ok(r.json.backup, 'replacing takes a backup first')
  } finally {
    await s.cleanup()
  }
})

test('import validation: rejects non-planner data, keeps odd values aside', async () => {
  const s = await startTestServer()
  try {
    assert.equal((await s.call('POST', '/api/import', { data: { hello: 'world' } })).status, 400)
    assert.equal((await s.call('POST', '/api/import', { data: { version: 99, days: {} } })).status, 400, 'newer version refused')
    const odd = { days: { '2026-10-19': { notes: { weird: true }, tasks: 'nope' }, 'not-a-date': { notes: 'orphan' } } }
    const r = await s.call('POST', '/api/import', { data: odd })
    assert.equal(r.status, 200)
    assert.ok(r.json.issueCount >= 3)
    const db = new DatabaseSync(path.join(s.dataDir, 'duckbook.sqlite'), { readOnly: true })
    const q = db.prepare('SELECT path, value FROM quarantine ORDER BY id').all() as { path: string; value: string }[]
    db.close()
    assert.ok(q.some((x) => x.path === 'days.not-a-date' && x.value.includes('orphan')), 'unrecognized day kept in quarantine')
  } finally {
    await s.cleanup()
  }
})

test('backup and restore round trip, with verification', async () => {
  const s = await startTestServer()
  try {
    await s.call('POST', '/api/import', { data: fixtureLegacy(), source: 'file' })
    const before = (await s.call('GET', '/api/data')).json.docs
    const b = (await s.call('POST', '/api/backups')).json.backup
    assert.equal(b.verified, true)
    assert.ok(fs.existsSync(path.join(s.dataDir, 'backups', b.file)))

    const day = before.find((d: { key: string }) => d.key === 'day:2026-10-19')
    await s.call('PUT', '/api/docs', { changes: [{ key: day.key, baseRev: day.rev, value: { ...day.value, notes: 'changed after backup' } }] })
    await s.call('PUT', '/api/docs', { changes: [{ key: 'day:2026-10-25', baseRev: 0, value: { grateful: '', tasks: [], notes: 'new page', sentence: '' } }] })

    const r = await s.call('POST', '/api/backups/restore', { file: b.file })
    assert.equal(r.status, 200)
    const after = (await s.call('GET', '/api/data')).json.docs
    assert.deepEqual(after.map((d: { key: string; value: unknown }) => [d.key, d.value]), before.map((d: { key: string; value: unknown }) => [d.key, d.value]))
    assert.ok(after.every((d: { rev: number }, i: number) => d.rev > before[i].rev), 'restored pages get fresh revisions')

    const list = (await s.call('GET', '/api/backups')).json.backups
    assert.ok(list.some((x: { kind: string }) => x.kind === 'pre-restore'), 'pre-restore backup kept')

    assert.equal((await s.call('POST', '/api/backups/restore', { file: '../duckbook.sqlite' })).status, 422, 'path traversal refused')

    fs.writeFileSync(path.join(s.dataDir, 'backups', b.file), 'garbage')
    const bad = await s.call('POST', '/api/backups/restore', { file: b.file })
    assert.equal(bad.status >= 400, true, 'damaged backup refused')
    assert.deepEqual(
      (await s.call('GET', '/api/data')).json.docs.map((d: { value: unknown }) => d.value),
      after.map((d: { value: unknown }) => d.value),
      'failed restore changes nothing',
    )
  } finally {
    await s.cleanup()
  }
})

test('PIN lock guards every private endpoint and limits attempts', async () => {
  const s = await startTestServer()
  try {
    await s.call('POST', '/api/import', { data: fixtureLegacy() })
    assert.equal((await s.call('PUT', '/api/lock-settings', { pin: '12345' })).status, 403, 'PIN must be 6 digits')
    let r = await s.call('PUT', '/api/lock-settings', { pin: '246810', autoLockMin: 5 })
    assert.equal(r.status, 200)
    assert.equal(r.json.pinEnabled, true)
    assert.equal((await s.call('GET', '/api/data')).status, 200, 'setting the PIN keeps this tab unlocked')

    await s.call('POST', '/api/lock')
    for (const [m, u, b] of [
      ['GET', '/api/data'],
      ['PUT', '/api/docs', { changes: [] }],
      ['GET', '/api/export'],
      ['GET', '/api/backups'],
      ['POST', '/api/backups'],
      ['POST', '/api/backups/restore', { file: 'x' }],
      ['POST', '/api/import', { data: fixtureLegacy(), replace: true }],
      ['POST', '/api/import/preview', { data: fixtureLegacy() }],
      ['PUT', '/api/lock-settings', { pin: null }],
      ['POST', '/api/ping'],
    ] as [string, string, unknown?][]) {
      assert.equal((await s.call(m, u, b)).status, 401, `${m} ${u} locked`)
    }
    const st = (await s.call('GET', '/api/status')).json
    assert.equal(st.locked, true)
    assert.equal(st.dataDir, undefined, 'status reveals nothing private while locked')

    for (let i = 0; i < 4; i++) assert.equal((await s.call('POST', '/api/unlock', { pin: '000000' })).status, 403)
    r = await s.call('POST', '/api/unlock', { pin: '000000' })
    assert.equal(r.status, 429, 'fifth wrong PIN starts a wait')
    assert.ok(r.json.retryAfterMs > 20_000)
    assert.equal((await s.call('POST', '/api/unlock', { pin: '246810' })).status, 429, 'even the right PIN waits during lockout')

    s.auth['lockedUntil'] = 0 // skip the wait in the test
    r = await s.call('POST', '/api/unlock', { pin: '246810' })
    assert.equal(r.status, 200)
    assert.equal((await s.call('GET', '/api/data')).status, 200)

    s.auth.idleOverrideMs = 50
    await new Promise((res) => setTimeout(res, 120))
    assert.equal((await s.call('GET', '/api/data')).status, 401, 'idle session expires on the server')
    s.auth.idleOverrideMs = null

    await s.call('POST', '/api/unlock', { pin: '246810' })
    assert.equal((await s.call('PUT', '/api/lock-settings', { currentPin: '111111', pin: null })).status, 403, 'removing needs the current PIN')
    r = await s.call('PUT', '/api/lock-settings', { currentPin: '246810', pin: null })
    assert.equal(r.status, 200)
    s.dropCookie()
    assert.equal((await s.call('GET', '/api/data')).status, 200, 'no PIN, no lock')
  } finally {
    await s.cleanup()
  }
})

test('restore keeps the PIN; restart locks again', async () => {
  const s = await startTestServer()
  try {
    await s.call('POST', '/api/import', { data: fixtureLegacy() })
    const b = (await s.call('POST', '/api/backups')).json.backup
    await s.call('PUT', '/api/lock-settings', { pin: '135790' })
    assert.equal((await s.call('POST', '/api/backups/restore', { file: b.file })).status, 200)
    assert.equal((await s.call('GET', '/api/status')).json.pinEnabled, true, 'restoring pages does not remove the PIN')
  } finally {
    await s.cleanup()
  }
})

test('malformed URLs from any page cannot crash the server', async () => {
  const s = await startTestServer()
  try {
    assert.equal(await rawRequest(s.port, { Host: `localhost:${s.port}` }, '/%E0%A4%A'), 400)
    assert.equal(await rawRequest(s.port, { Host: `localhost:${s.port}` }, '/assets/%ZZ.js'), 400)
    assert.equal((await s.call('GET', '/api/health')).status, 200, 'still serving')
  } finally {
    await s.cleanup()
  }
})

test('retention never drops the pre-migration backup; other pools are capped', async () => {
  const s = await startTestServer()
  try {
    await s.call('POST', '/api/import', { data: fixtureLegacy() })
    await s.call('POST', '/api/import', { data: fixtureLegacy(), source: 'legacy', replace: true })
    const b = (await s.call('POST', '/api/backups')).json.backup
    for (let i = 0; i < 23; i++) assert.equal((await s.call('POST', '/api/backups/restore', { file: b.file })).status, 200)
    const list = (await s.call('GET', '/api/backups')).json.backups as { kind: string }[]
    assert.equal(list.filter((x) => x.kind === 'pre-migration').length, 1, 'pre-migration kept')
    assert.equal(list.filter((x) => x.kind === 'manual').length, 1, 'manual kept')
    assert.ok(list.filter((x) => x.kind === 'pre-restore').length <= 20, 'pre-restore pool capped')
    const st = (await s.call('GET', '/api/status')).json
    assert.equal(st.migration, null, 'a restore clears the "browser copy is in the database" marker')
  } finally {
    await s.cleanup()
  }
})

test('Focus Map page: strict saves, idea links on tasks, backup round trip, older data compatible', async () => {
  const s = await startTestServer()
  try {
    // Older export without focus or modules imports cleanly.
    let r = await s.call('POST', '/api/import', { data: fixtureLegacy() })
    assert.equal(r.status, 200)
    assert.ok(!r.json.docs.some((d: { key: string }) => d.key === 'focus'), 'no focus page until used')
    const settings = r.json.docs.find((d: { key: string }) => d.key === 'settings')
    assert.deepEqual(settings.value.modules, { focusMap: false }, 'module defaults to off')

    const focus = { ideas: [{ id: 'i1', text: 'synthetic idea', x: 0.8, y: 1.7, createdAt: '2026-10-22T00:00:00Z' }, { id: 'i2', text: 'unplaced', x: null, y: null, createdAt: '' }] }
    r = await s.call('PUT', '/api/docs', { changes: [{ key: 'focus', baseRev: 0, value: focus }] })
    assert.equal(r.status, 200)
    const saved = (await s.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === 'focus')
    assert.equal(saved.value.ideas[0].y, 1, 'coordinates are clamped to the map')
    assert.equal(saved.value.ideas[1].x, null)

    assert.equal((await s.call('PUT', '/api/docs', { changes: [{ key: 'focus', baseRev: saved.rev, value: { ideas: 'nope' } }] })).status, 400)
    assert.equal((await s.call('PUT', '/api/docs', { changes: [{ key: 'focus', baseRev: saved.rev, value: { ideas: [{ id: 'x', text: 5 }] } }] })).status, 400)

    const week = (await s.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === 'week:2026-10-19')
    const withLink = { ...week.value, tasks: [...week.value.tasks, { id: 'from-idea', text: 'synthetic idea', q: null, done: false, ideaId: 'i1' }] }
    r = await s.call('PUT', '/api/docs', { changes: [{ key: week.key, baseRev: week.rev, value: withLink }, { key: 'settings', baseRev: settings.rev, value: { ...settings.value, modules: { focusMap: true } } }] })
    assert.equal(r.status, 200)

    const b = (await s.call('POST', '/api/backups')).json.backup
    const before = (await s.call('GET', '/api/data')).json.docs.map((d: { key: string; value: unknown }) => [d.key, d.value])
    const cur = (await s.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === 'focus')
    await s.call('PUT', '/api/docs', { changes: [{ key: 'focus', baseRev: cur.rev, value: { ideas: [] } }] })
    assert.equal((await s.call('POST', '/api/backups/restore', { file: b.file })).status, 200)
    const after = (await s.call('GET', '/api/data')).json.docs.map((d: { key: string; value: unknown }) => [d.key, d.value])
    assert.deepEqual(after, before, 'restore brings back ideas, the module setting, and the task link')
    const task = after.find(([k]: [string]) => k === 'week:2026-10-19')[1].tasks.find((t: { id: string }) => t.id === 'from-idea')
    assert.equal(task.ideaId, 'i1')

    // Export → import keeps everything. Export spells out derived idea states, so compare what is read back.
    const { docsToState } = await import('../src/lib/schema.ts')
    const exp = (await s.call('GET', '/api/export')).json
    assert.equal(exp.state.focus.ideas.length, 2)
    r = await s.call('POST', '/api/import', { data: exp, replace: true })
    assert.equal(r.status, 200)
    const asState = (docs: [string, unknown][]) => docsToState(docs.map(([key, value]) => ({ key, value })))
    assert.deepEqual(asState(r.json.docs.map((d: { key: string; value: unknown }) => [d.key, d.value])), asState(before))
  } finally {
    await s.cleanup()
  }
})

test('server reports its API level and code fingerprint for update checks', async () => {
  const { API_LEVEL } = await import('../src/lib/schema.ts')
  const { codeFingerprint } = await import('../server/version.ts')
  const s = await startTestServer()
  try {
    const h = (await s.call('GET', '/api/health')).json
    assert.equal(h.apiLevel, API_LEVEL)
    assert.equal(h.code, codeFingerprint())
    assert.equal((await s.call('GET', '/api/status')).json.apiLevel, API_LEVEL, 'visible even while locked')
  } finally {
    await s.cleanup()
  }
})

test('ideas keep state and planned date; older ideas get a derived state that survives restore', async () => {
  const { docsToState } = await import('../src/lib/schema.ts')
  const s = await startTestServer()
  try {
    await s.call('POST', '/api/import', { data: fixtureLegacy() })
    // A Focus page as an older build (API level 2) stored it: no status, no date.
    const old = { ideas: [{ id: 'old-done', text: 'older idea, finished', x: 0.7, y: 0.7, createdAt: '' }, { id: 'old-open', text: 'older idea, open', x: null, y: null, createdAt: '' }] }
    let r = await s.call('PUT', '/api/docs', { changes: [{ key: 'focus', baseRev: 0, value: old }] })
    assert.equal(r.status, 200)
    const week = (await s.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === 'week:2026-10-19')
    const tasks = [...week.value.tasks, { id: 't-old-1', text: 'older idea, finished', q: 'A', done: true, ideaId: 'old-done' }, { id: 't-old-2', text: 'older copy', q: null, done: true, ideaId: 'old-done' }]
    await s.call('PUT', '/api/docs', { changes: [{ key: week.key, baseRev: week.rev, value: { ...week.value, tasks } }] })

    let docs = (await s.call('GET', '/api/data')).json.docs
    const stored = docs.find((d: { key: string }) => d.key === 'focus').value
    assert.equal('status' in stored.ideas[0], false, 'validation does not invent a state')
    assert.equal(stored.ideas[0].date, null)
    let st = docsToState(docs)
    assert.deepEqual(st.focus.ideas.map((i: { status: string }) => i.status), ['done', 'idea'], 'state derived from the planned copies')

    const b = (await s.call('POST', '/api/backups')).json.backup
    const focus = docs.find((d: { key: string }) => d.key === 'focus')
    await s.call('PUT', '/api/docs', { changes: [{ key: 'focus', baseRev: focus.rev, value: { ideas: [] } }] })
    assert.equal((await s.call('POST', '/api/backups/restore', { file: b.file })).status, 200)
    docs = (await s.call('GET', '/api/data')).json.docs
    st = docsToState(docs)
    assert.equal(st.focus.ideas[0].status, 'done', 'restoring an older backup keeps finished work finished')
    assert.ok(st.weeks['2026-10-19'].tasks.filter((t: { ideaId?: string; done: boolean }) => t.ideaId === 'old-done').every((t: { done: boolean }) => t.done), 'both older copies stay done')

    // New fields are validated strictly.
    const cur = docs.find((d: { key: string }) => d.key === 'focus')
    const next = { ideas: [{ id: 'n', text: 'new idea', x: null, y: null, status: 'doing', date: '2026-10-24', createdAt: '' }, { id: 'm', text: 'odd', x: null, y: null, status: 'bogus', date: '2026-02-31', createdAt: '' }] }
    r = await s.call('PUT', '/api/docs', { changes: [{ key: 'focus', baseRev: cur.rev, value: next }] })
    assert.equal(r.status, 200)
    const saved = (await s.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === 'focus').value.ideas
    assert.equal(saved[0].status, 'doing')
    assert.equal(saved[0].date, '2026-10-24')
    assert.equal('status' in saved[1], false, 'unknown state is not stored')
    assert.equal(saved[1].date, null, 'impossible date is not stored')
  } finally {
    await s.cleanup()
  }
})
