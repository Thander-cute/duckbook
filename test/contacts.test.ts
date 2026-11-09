import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from './helpers.ts'
import { fromLunar, toLunar } from '../src/lib/lunar.ts'
import { normalizeState } from '../src/lib/schema.ts'
import { moveLine, segments, withType, withoutType } from '../src/lib/disc.ts'
import { ADD_ONS } from '../src/lib/addons.ts'

test('lunar calendar agrees with published Vietnamese dates', () => {
  // Tết, in both directions.
  for (const [d, m, y] of [[29, 1, 2025], [17, 2, 2026], [6, 2, 2027], [26, 1, 2028]]) {
    assert.deepEqual(toLunar(d, m, y), { day: 1, month: 1, year: y, leap: false })
    assert.deepEqual(fromLunar(1, 1, y), [d, m, y])
  }
  assert.deepEqual(fromLunar(15, 8, 2026), [25, 9, 2026], 'Trung thu 2026')
  assert.deepEqual(fromLunar(10, 3, 2026), [26, 4, 2026], 'Giỗ Tổ 2026')
  assert.deepEqual(toLunar(25, 7, 2025), { day: 1, month: 6, year: 2025, leap: true }, 'leap sixth month of 2025')
  assert.deepEqual(fromLunar(1, 6, 2025, true), [25, 7, 2025])
  assert.equal(fromLunar(1, 5, 2025, true), null, '2025 has no leap fifth month')
})

const anna = { id: 'c1', name: 'Synthetic Anna', gender: 'female', day: 29, month: 2, year: 1990, disc: { D: 60, I: 40 }, notes: 'synthetic note' }
const ben = { id: 'c2', name: 'Synthetic Ben', gender: '', day: 30, month: 4, year: null, disc: { C: 25, S: 25, I: 25, D: 25 }, notes: '' }
const noBirthday = { id: 'c3', name: 'Synthetic Chi', gender: 'other', day: null, month: null, year: null, disc: {}, notes: '' }

test('contacts and occasions: strict saves, backup and export', async () => {
  const s = await startTestServer()
  try {
    let r = await s.call('GET', '/api/data')
    assert.ok(!r.json.docs.some((d: { key: string }) => d.key === 'contacts'), 'no contacts page until used')

    for (const bad of [{ day: 30, month: 2 }, { day: 1, month: 13 }, { day: 5, month: null }, { gender: 'x' }, { day: null, month: null, year: 1990 }, { disc: 'D' }, { disc: { X: 50 } }, { disc: { D: 0 } }, { disc: { D: 101 } }, { disc: { D: 1.5 } }]) {
      r = await s.call('PUT', '/api/docs', { changes: [{ key: 'contacts', baseRev: 0, value: { people: [{ ...noBirthday, ...bad }] } }] })
      assert.equal(r.status, 400, `refused: ${JSON.stringify(bad)}`)
    }

    const people = [anna, ben, noBirthday]
    r = await s.call('PUT', '/api/docs', { changes: [{ key: 'contacts', baseRev: 0, value: { people } }] })
    assert.equal(r.status, 200)
    const days = [{ id: 'o1', name: 'Synthetic day', day: 15, month: 8 }]
    r = await s.call('PUT', '/api/docs', { changes: [{ key: 'occasions', baseRev: 0, value: { days } }] })
    assert.equal(r.status, 200)
    r = await s.call('PUT', '/api/docs', { changes: [{ key: 'occasions', baseRev: r.json.revs.occasions, value: { days: [{ ...days[0], day: 31, month: 4 }] } }] })
    assert.equal(r.status, 400, 'April has no 31st')

    const find = async (key: string) => (await s.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === key)
    assert.deepEqual((await find('contacts')).value.people, people)

    const backup = (await s.call('POST', '/api/backups')).json.backup
    const cur = await find('contacts')
    await s.call('PUT', '/api/docs', { changes: [{ key: 'contacts', baseRev: cur.rev, value: { people: [] } }] })
    assert.deepEqual((await find('contacts')).value.people, [], 'the last person can be removed')
    await s.call('POST', '/api/backups/restore', { file: backup.file })
    assert.deepEqual((await find('contacts')).value.people, people, 'restore brings everyone back')

    const exp = (await s.call('GET', '/api/export')).json
    assert.deepEqual(exp.state.contacts.people, people)
    assert.deepEqual(exp.state.occasions.days, days)

    // A bad entry in an import is set aside, not dropped; the good ones stay.
    exp.state.contacts.people.push({ ...noBirthday, id: 'c4', notes: 'synthetic keep', gender: 'x', day: 40, month: 1 })
    const n = normalizeState(exp)
    assert.equal(n.state.contacts.people.length, 4, 'the person and their text survive')
    assert.equal(n.state.contacts.people[3].notes, 'synthetic keep')
    assert.equal(n.state.contacts.people[3].day, null)
    assert.ok(n.quarantine.some((q) => q.path === 'contacts.people.3.day'), 'the bad date is kept aside')
  } finally {
    await s.cleanup()
  }
})

test('settings from before these add-ons read with them off', async () => {
  const s = await startTestServer()
  try {
    const r = await s.call('PUT', '/api/docs', { changes: [{ key: 'settings', baseRev: 0, value: { ink: 'serif', focusMin: 25, breakMin: 5, modules: { focusMap: true } } }] })
    assert.equal(r.status, 200)
    const doc = (await s.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === 'settings')
    assert.deepEqual(doc.value.modules, { focusMap: true, contacts: false, holidays: false, disc: false })
    assert.equal(doc.value.monthSize, 15)
  } finally {
    await s.cleanup()
  }
})

test('a Month day keeps its own word size; pages without one are stored as before', async () => {
  const s = await startTestServer()
  try {
    const month = { theme: '', goals: [], cells: { '2026-11-10': 'synthetic' }, moods: {}, notes: '' }
    let r = await s.call('PUT', '/api/docs', { changes: [{ key: 'month:2026-11', baseRev: 0, value: month }] })
    assert.equal(r.status, 200)
    const get = async () => (await s.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === 'month:2026-11')
    assert.equal('sizes' in (await get()).value, false)
    r = await s.call('PUT', '/api/docs', { changes: [{ key: 'month:2026-11', baseRev: (await get()).rev, value: { ...month, sizes: { '2026-11-10': 200 } } }] })
    assert.equal(r.status, 400, 'an impossible size is refused')
    r = await s.call('PUT', '/api/docs', { changes: [{ key: 'month:2026-11', baseRev: (await get()).rev, value: { ...month, sizes: { '2026-11-10': 12 } } }] })
    assert.equal(r.status, 200)
    assert.deepEqual((await get()).value.sizes, { '2026-11-10': 12 })
  } finally {
    await s.cleanup()
  }
})

test('DISC mix: picks share evenly, dropping keeps proportions, the largest comes first, the lines move in steps', () => {
  const sum = (m: object) => Object.values(m).reduce((n: number, v) => n + (v as number), 0)
  let m = withType({}, 'S')
  assert.deepEqual(m, { S: 100 })
  m = withType(m, 'D')
  assert.deepEqual(m, { S: 50, D: 50 })
  assert.deepEqual(segments(m)[0][0], 'S', 'a tie keeps the first pick as main')
  m = withType(m, 'C')
  assert.deepEqual(m, { S: 50, D: 40, C: 10 }, 'a third colour leaves the main one alone when two are level')
  assert.equal(segments(m)[0][0], 'S')
  m = withType(m, 'I')
  assert.deepEqual(m, { S: 40, D: 40, C: 10, I: 10 })
  assert.equal(segments(m)[0][0], 'S', 'still the main one')
  assert.equal(sum(m), 100)
  assert.deepEqual(withType({ D: 70, S: 30 }, 'C'), { D: 60, S: 30, C: 10 }, 'shares already set are kept')
  assert.deepEqual(withoutType({ S: 50, D: 30, C: 20 }, 'S'), { D: 60, C: 40 })
  assert.deepEqual(withoutType({ S: 34, D: 33, C: 33 }, 'C'), { S: 50, D: 50 }, 'an even share stays even')
  assert.deepEqual(withoutType({ S: 34, D: 33, C: 33 }, 'S'), { D: 50, C: 50 })
  assert.equal(sum(withoutType({ S: 50, D: 25, C: 15, I: 10 }, 'I')), 100)
  assert.deepEqual(withoutType({ S: 100 }, 'S'), {})

  assert.deepEqual(segments({ C: 15, S: 50, I: 5, D: 30 }).map(([k]) => k), ['S', 'D', 'C', 'I'])
  assert.equal(segments({ D: 40, S: 40, C: 40 }).reduce((n, [, v]) => n + v, 0), 100, 'a merged mix over 100 reads as proportions')

  const bar = segments({ S: 50, D: 30, C: 20 })
  assert.deepEqual(moveLine(bar, 0, 62), [['S', 60], ['D', 20], ['C', 20]], 'snaps to a step')
  assert.deepEqual(moveLine(bar, 0, 99), [['S', 75], ['D', 5], ['C', 20]], 'a neighbour keeps one step')
  assert.deepEqual(moveLine(bar, 1, 0), [['S', 50], ['D', 5], ['C', 45]], 'other colours stay put')
})

test('Each add-on has a plain version, and it is the top of its history', () => {
  const ids = Object.keys(ADD_ONS) as (keyof typeof ADD_ONS)[]
  assert.deepEqual(ids.sort(), ['contacts', 'disc', 'focusMap', 'holidays'])
  for (const id of ids) {
    const a = ADD_ONS[id]
    assert.match(a.version, /^\d+\.\d+\.\d+$/, id)
    assert.equal(a.version, a.history[0].version, id)
    assert.ok(a.history.every((h) => h.note.length > 0), id)
  }
})
