import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../server/db.ts'
import { normalizeState, repairDoc, stateToDocs } from '../src/lib/schema.ts'
import { fixtureLegacy } from './helpers.ts'

const day = (over: Record<string, unknown> = {}) => ({ grateful: '', tasks: [], notes: '', sentence: '', ...over })

function device() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-sync-'))
  const store = new Store(dir)
  const sent = { seq: 0 }
  return {
    store,
    dir,
    get: (key: string) => store.allDocs().find((d) => d.key === key),
    save(key: string, value: unknown) {
      const rev = this.get(key)?.rev ?? 0
      return store.putDocs([{ key, baseRev: rev, value }]).revs
    },
    /** Ops not yet sent from this device. */
    outbox() {
      const ops = store.sync.localOps(sent.seq)
      if (ops.length) sent.seq = ops[ops.length - 1].seq
      return ops.map((o) => o.op)
    },
    close() {
      store.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}
type Device = ReturnType<typeof device>

function exchange(...devs: Device[]) {
  const boxes = devs.map((d) => d.outbox())
  devs.forEach((d, i) => boxes.forEach((ops, j) => i !== j && d.store.applyRemote(ops)))
}

/** Every page equals what its leaves describe: the op-log never drifts from the stored pages. */
function assertReplays(d: Device) {
  for (const doc of d.store.allDocs()) assert.deepEqual(repairDoc(doc.key, d.store.sync.materialize(doc.key)).value, doc.value, `replay of ${doc.key}`)
}

const pages = (d: Device) => d.store.allDocs().map((x) => ({ key: x.key, value: x.value }))

test('op-log replays to the stored pages, including an existing notebook', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-sync-'))
  try {
    const before = new Store(dir)
    before.replaceAll(normalizeState(fixtureLegacy()).state, { reason: 'pre-import', source: 'test' })
    // Simulate a notebook from before the op-log: drop its operations.
    before.db.exec("DELETE FROM sync_leaves; DELETE FROM sync_ops; DELETE FROM meta WHERE key = 'sync_data_version';")
    before.close()
    const store = new Store(dir)
    assert.ok(!store.sync.isEmpty(), 'existing pages became operations')
    for (const doc of store.allDocs()) assert.deepEqual(repairDoc(doc.key, store.sync.materialize(doc.key)).value, doc.value)
    store.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('two devices converge on edits to different fields and lists', () => {
  const a = device()
  const b = device()
  try {
    a.save('day:2026-10-19', day({ notes: 'from A', tasks: [{ id: 't1', text: 'task one', estimate: 1, pomos: 0, done: false }] }))
    exchange(a, b)
    assert.deepEqual(b.get('day:2026-10-19')?.value, a.get('day:2026-10-19')?.value)

    // Offline on both: A ticks the task and adds one, B adds another task and writes gratitude.
    const base = b.get('day:2026-10-19')!.value as any
    a.save('day:2026-10-19', { ...base, tasks: [{ ...base.tasks[0], done: true }, { id: 'ta', text: 'from A', estimate: 2, pomos: 0, done: false }] })
    b.save('day:2026-10-19', { ...base, grateful: 'from B', tasks: [...base.tasks, { id: 'tb', text: 'from B', estimate: 1, pomos: 0, done: false }] })
    exchange(a, b)

    assert.deepEqual(pages(a), pages(b), 'same pages on both')
    const merged = a.get('day:2026-10-19')!.value as any
    assert.equal(merged.grateful, 'from B')
    assert.equal(merged.notes, 'from A')
    assert.deepEqual(merged.tasks.map((t: any) => [t.id, t.done]).sort(), [['t1', true], ['ta', false], ['tb', false]])
    assertReplays(a)
    assertReplays(b)
  } finally {
    a.close()
    b.close()
  }
})

test('free text typed on two devices merges without losing either side', () => {
  const a = device()
  const b = device()
  try {
    a.save('day:2026-10-20', day({ notes: 'Morning walk. Evening read.' }))
    exchange(a, b)
    const base = b.get('day:2026-10-20')!.value as any
    a.save('day:2026-10-20', { ...base, notes: 'Morning walk by the lake. Evening read.' })
    b.save('day:2026-10-20', { ...base, notes: 'Morning walk. Evening read two chapters.' })
    exchange(a, b)
    assert.equal((a.get('day:2026-10-20')!.value as any).notes, 'Morning walk by the lake. Evening read two chapters.')
    assert.deepEqual(pages(a), pages(b))
  } finally {
    a.close()
    b.close()
  }
})

test('the same notebook on two devices does not double its text when they first sync', () => {
  const a = device()
  const b = device()
  try {
    const state = normalizeState(fixtureLegacy()).state
    a.store.replaceAll(state, { reason: 'pre-import', source: 'test' })
    b.store.replaceAll(state, { reason: 'pre-import', source: 'test' })
    exchange(a, b)
    assert.deepEqual(pages(a), pages(b))
    assert.deepEqual(
      pages(a),
      stateToDocs(state)
        .map((d) => ({ key: d.key, value: d.value }))
        .sort((x, y) => x.key.localeCompare(y.key)),
    )
  } finally {
    a.close()
    b.close()
  }
})

test('edit vs delete, three devices, duplicated and out-of-order delivery', () => {
  const [a, b, c] = [device(), device(), device()]
  try {
    a.save('week:2026-10-19', {
      goal: '',
      notes: '',
      selfCare: '',
      tasks: [
        { id: 'w1', text: 'keep', q: 'A', done: false },
        { id: 'w2', text: 'drop', q: null, done: false },
      ],
      habits: [],
      reflection: { checkin: '', success: '', lesson: '', future: '', more: '', reviewed: false },
    })
    exchange(a, b, c)
    const base = b.get('week:2026-10-19')!.value as any
    b.save('week:2026-10-19', { ...base, tasks: [base.tasks[0]] })
    c.save('week:2026-10-19', { ...base, tasks: [{ ...base.tasks[0], text: 'keep edited' }, base.tasks[1]] })
    const fromB = b.outbox()
    const fromC = c.outbox()
    // A gets C's change before B's, and B's twice.
    a.store.applyRemote(fromC)
    a.store.applyRemote(fromB)
    a.store.applyRemote(fromB)
    b.store.applyRemote(fromC)
    c.store.applyRemote(fromB)
    assert.deepEqual(pages(a), pages(b))
    assert.deepEqual(pages(b), pages(c))
    assert.deepEqual((a.get('week:2026-10-19')!.value as any).tasks.map((t: any) => t.text), ['keep edited'])
  } finally {
    a.close()
    b.close()
    c.close()
  }
})

test('a restore on one device reaches the other and is not undone by older edits', () => {
  const a = device()
  const b = device()
  try {
    a.save('day:2026-10-21', day({ notes: 'v1' }))
    const backup = a.store.createBackup('manual')
    a.save('day:2026-10-21', day({ notes: 'v2' }))
    exchange(a, b)
    a.store.restoreBackup(backup.file)
    exchange(a, b)
    assert.equal((b.get('day:2026-10-21')!.value as any).notes, 'v1')
    assert.deepEqual(pages(a), pages(b))
  } finally {
    a.close()
    b.close()
  }
})

test('a tab saving over a page that sync changed is merged, not a conflict', () => {
  const a = device()
  const b = device()
  try {
    a.save('day:2026-10-22', day({ notes: 'first line', grateful: '' }))
    exchange(a, b)
    const tabRev = b.get('day:2026-10-22')!.rev
    const tabView = b.get('day:2026-10-22')!.value as any
    // A edits the gratitude and the start of the notes; B's open tab meanwhile adds to the end of the notes.
    a.save('day:2026-10-22', { ...tabView, grateful: 'from A', notes: 'First line' })
    exchange(a, b)
    const r = b.store.putDocs([{ key: 'day:2026-10-22', baseRev: tabRev, value: { ...tabView, notes: 'first line, then more from B' } }])
    const merged = r.merged['day:2026-10-22'] as any
    assert.equal(merged.grateful, 'from A')
    assert.equal(merged.notes, 'First line, then more from B')
    assert.deepEqual(b.get('day:2026-10-22')!.value, merged)
    exchange(a, b)
    assert.deepEqual(pages(a), pages(b))
    // An unknown base (a tab from before the page existed) is still a conflict.
    assert.throws(() => b.store.putDocs([{ key: 'day:2026-10-22', baseRev: 0, value: day() }]), /changed in another tab/)
  } finally {
    a.close()
    b.close()
  }
})

test('pages changed by an older duckbook are picked up when the notebook opens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-sync-'))
  try {
    let store = new Store(dir)
    store.putDocs([{ key: 'day:2026-10-23', baseRev: 0, value: day({ notes: 'new app' }) }])
    // An older duckbook writes the page directly and bumps data_version, but not the op-log.
    store.db.prepare('UPDATE docs SET value = ? WHERE key = ?').run(JSON.stringify(day({ notes: 'old app' })), 'day:2026-10-23')
    store.db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'data_version'").run()
    store.close()
    store = new Store(dir)
    assert.equal((repairDoc('day:2026-10-23', store.sync.materialize('day:2026-10-23')).value as any).notes, 'old app')
    store.close()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
