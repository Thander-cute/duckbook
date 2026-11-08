import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../server/db.ts'
import { normalizeState, repairDoc, stateToDocs } from '../src/lib/schema.ts'
import { fixtureLegacy } from './helpers.ts'
import { FolderRemote } from '../server/sync/remote.ts'
import { SyncRunner } from '../server/sync/runner.ts'

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

// ───────── through a shared folder standing in for Google Drive ─────────

const jpeg = (seed: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(`synthetic photo ${seed}`), Buffer.from([0xff, 0xd9])])

test('devices sync through a shared folder: start, take, edit both, photos', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-drive-'))
  const remote = new FolderRemote(folder)
  const a = device()
  const b = device()
  const ra = new SyncRunner(a.store, async () => remote)
  const rb = new SyncRunner(b.store, async () => remote)
  try {
    const photo = a.store.savePhoto(jpeg('a'))
    a.save('day:2026-10-24', day({ notes: 'on A before sync', photos: [{ full: photo, thumb: photo, w: 10, h: 10 }] }))
    b.save('day:2026-10-01', day({ notes: 'B had its own page' }))
    assert.deepEqual(await rb.inspect(), { hasNotebook: false, localPages: 1 })
    await ra.join('start')
    await assert.rejects(rb.join('start'), /already has a duckbook notebook/)

    const { backup } = await rb.join('replace')
    assert.ok(backup, 'B was backed up before taking the notebook')
    assert.deepEqual(pages(b), pages(a))
    assert.ok(b.store.readPhoto(photo), 'photo copied')

    a.save('day:2026-10-24', { ...(a.get('day:2026-10-24')!.value as object), grateful: 'A again' })
    b.save('day:2026-10-25', day({ notes: 'written on B' }))
    await rb.syncNow()
    await ra.syncNow()
    await rb.syncNow()
    assert.deepEqual(pages(a), pages(b))
    assert.equal((b.get('day:2026-10-24')!.value as any).grateful, 'A again')
    assert.equal((a.get('day:2026-10-25')!.value as any).notes, 'written on B')
  } finally {
    a.close()
    b.close()
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('merge join keeps both notebooks; damaged files are reported, not applied', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-drive-'))
  const remote = new FolderRemote(folder)
  const a = device()
  const b = device()
  const ra = new SyncRunner(a.store, async () => remote)
  const rb = new SyncRunner(b.store, async () => remote)
  try {
    a.save('day:2026-10-26', day({ notes: 'A' }))
    b.save('day:2026-10-27', day({ notes: 'B' }))
    await ra.join('start')
    await rb.join('merge')
    await ra.syncNow()
    assert.deepEqual(pages(a), pages(b))
    assert.deepEqual(pages(a).map((p) => p.key), ['day:2026-10-26', 'day:2026-10-27'])

    fs.writeFileSync(path.join(folder, 'ops-00000000000000ff-000000000001.json'), '{"format":"duckbook-ops","version":1,"ops":[{"id":"x"}]}')
    await assert.rejects(ra.syncNow(), /can't read/)
    assert.match(ra.state().error ?? '', /can't read/)
    assert.deepEqual(pages(a), pages(b), 'nothing applied')
  } finally {
    a.close()
    b.close()
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

// ───────── review findings (2026-10-31), each reproduced first ─────────

const month = (cells: Record<string, string>) => ({ theme: '', goals: [], cells, moods: {}, notes: '' })

test('a removed calendar note stays removed whatever order the changes arrive in', () => {
  const [a, b, c] = [device(), device(), device()]
  try {
    a.save('month:2026-10', month({ '2026-10-05': 'synthetic cell' }))
    const created = a.outbox()
    a.save('month:2026-10', month({}))
    const removed = a.outbox()
    b.store.applyRemote(created)
    b.store.applyRemote(removed)
    c.store.applyRemote(removed)
    c.store.applyRemote(created)
    assert.deepEqual((b.get('month:2026-10')!.value as any).cells, {})
    assert.deepEqual(pages(b), pages(c))
  } finally {
    a.close()
    b.close()
    c.close()
  }
})

test('a page removed and written again does not bring back its old tasks', () => {
  const a = device()
  const b = device()
  try {
    a.save('day:2026-10-10', day({ tasks: [{ id: 'old', text: 'old task', estimate: 1, pomos: 0, done: false }] }))
    a.store.replaceAll(normalizeState({ version: 1, days: {} }).state, { reason: 'pre-import', source: 'test' })
    a.save('day:2026-10-10', day({ notes: 'new life' }))
    assertReplays(a)
    exchange(a, b)
    assert.deepEqual((b.get('day:2026-10-10')!.value as any).tasks, [])
    assert.deepEqual(pages(a), pages(b))
  } finally {
    a.close()
    b.close()
  }
})

test('changes that would not make a page are refused whole, nothing applied', () => {
  const a = device()
  try {
    a.save('day:2026-10-11', day({ notes: 'keep me' }))
    const bad = { id: 'x1', dev: '00000000000000aa', ts: '9999999999999.000000.00000000000000aa', key: 'day:2026-10-11', path: '[]', kind: 'set' as const, value: 'not a page' }
    assert.throws(() => a.store.applyRemote([bad as any]))
    assert.equal((a.get('day:2026-10-11')!.value as any).notes, 'keep me')
  } finally {
    a.close()
  }
})

test('a failed take from Drive leaves this device as it was', () => {
  const a = device()
  try {
    a.save('day:2026-10-12', day({ notes: 'mine' }))
    const dev = a.store.sync.device
    const junk = { id: 'y1', dev: '00000000000000bb', ts: '0000000000001.000000.00000000000000bb', key: 'day:2026-10-12', path: '["notes"]', kind: 'text' as const, upd: Buffer.from('not yjs').toString('base64') }
    assert.throws(() => a.store.takeRemote([junk]))
    assert.equal(a.store.sync.device, dev)
    assert.equal(a.store.getMeta('sync_device'), dev)
    assert.ok(a.store.sync.localOps().length > 0, 'own operations still found')
    assert.equal((a.get('day:2026-10-12')!.value as any).notes, 'mine')
  } finally {
    a.close()
  }
})

/** A folder whose clock runs an hour behind this computer's. */
class SkewedRemote extends FolderRemote {
  async list(since?: string) {
    const shift = (iso: string, by: number) => new Date(Date.parse(iso) + by).toISOString()
    const files = await super.list(since ? shift(since, 3600_000) : undefined)
    return files.map((f) => ({ ...f, modifiedTime: shift(f.modifiedTime!, -3600_000) }))
  }
}

test('a Drive clock far from this computer’s still finds every new file', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-drive-'))
  const remote = new SkewedRemote(folder)
  const a = device()
  const b = device()
  const ra = new SyncRunner(a.store, async () => remote)
  const rb = new SyncRunner(b.store, async () => remote)
  try {
    a.save('day:2026-10-13', day({ notes: 'one' }))
    await ra.join('start')
    await rb.join('replace')
    for (const text of ['two', 'three']) {
      a.save('day:2026-10-13', { ...(a.get('day:2026-10-13')!.value as object), notes: text })
      await ra.syncNow()
      await rb.syncNow()
      assert.equal((b.get('day:2026-10-13')!.value as any).notes, text)
    }
  } finally {
    a.close()
    b.close()
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('starting a new Drive notebook from pages that came from another one sends them all', async () => {
  const [f1, f2] = [fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-drive-')), fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-drive-'))]
  const [a, b, c] = [device(), device(), device()]
  try {
    a.save('day:2026-10-14', day({ notes: 'from A' }))
    await new SyncRunner(a.store, async () => new FolderRemote(f1)).join('start')
    const rb1 = new SyncRunner(b.store, async () => new FolderRemote(f1))
    await rb1.join('replace')
    rb1.leave()
    await new SyncRunner(b.store, async () => new FolderRemote(f2)).join('start')
    await new SyncRunner(c.store, async () => new FolderRemote(f2)).join('replace')
    assert.deepEqual(pages(c), pages(b))
    assert.equal((c.get('day:2026-10-14')!.value as any).notes, 'from A')
  } finally {
    for (const d of [a, b, c]) d.close()
    for (const f of [f1, f2]) fs.rmSync(f, { recursive: true, force: true })
  }
})

test('photos go up before the pages that show them; a photo Drive lacks is reported', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-drive-'))
  const remote = new FolderRemote(folder)
  const a = device()
  const b = device()
  try {
    const kept = a.store.savePhoto(jpeg('kept'))
    const lost = a.store.savePhoto(jpeg('lost'))
    a.save('day:2026-10-15', day({ photos: [kept, lost].map((id) => ({ full: id, thumb: id, w: 10, h: 10 })) }))
    fs.rmSync(path.join(a.store.photoDir, `${lost}.jpg`))
    await new SyncRunner(a.store, async () => remote).join('start')
    const ops = fs.readdirSync(folder).filter((n) => n.startsWith('ops-')).map((n) => fs.statSync(path.join(folder, n)).mtimeMs)
    assert.ok(fs.statSync(path.join(folder, `photo-${kept}.jpg`)).mtimeMs <= Math.min(...ops), 'photo written before the changes')
    const rb = new SyncRunner(b.store, async () => remote)
    await rb.join('replace')
    assert.ok(b.store.readPhoto(kept))
    assert.equal(rb.state().warning, '1 photo not in Drive yet')
  } finally {
    a.close()
    b.close()
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('contacts and days to remember sync: two devices add at once, edits merge, and the last one can be removed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-contacts-'))
  const remote = new FolderRemote(dir)
  const a = device()
  const b = device()
  const [ra, rb] = [a, b].map((d) => new SyncRunner(d.store, async () => remote))
  const person = (id: string, name: string, over = {}) => ({ id, name, gender: '', day: null, month: null, year: null, disc: {}, notes: '', ...over })
  const people = (d: Device) => (d.get('contacts')?.value as { people: { id: string; name: string; notes: string; day: number | null }[] }).people
  const both = async () => {
    await ra.syncNow()
    await rb.syncNow()
    await ra.syncNow()
  }
  try {
    a.save('contacts', { people: [person('c1', 'Synthetic Anna', { day: 3, month: 4 })] })
    a.save('occasions', { days: [{ id: 'o1', name: 'Synthetic day', day: 15, month: 8 }] })
    await ra.join('start')
    await rb.join('replace')
    assert.deepEqual(people(b).map((x) => [x.id, x.day]), [['c1', 3]])
    assert.deepEqual((b.get('occasions')?.value as { days: unknown[] }).days.length, 1)

    a.save('contacts', { people: [...people(a), person('c2', 'Synthetic Ben')] })
    b.save('contacts', { people: [{ ...people(b)[0], notes: 'from b' }, person('c3', 'Synthetic Chi')] })
    await both()
    for (const d of [a, b]) {
      assert.deepEqual(people(d).map((x) => x.id).sort(), ['c1', 'c2', 'c3'], 'both additions kept')
      assert.equal(people(d).find((x) => x.id === 'c1')!.notes, 'from b')
    }
    assertReplays(a)
    assertReplays(b)

    // Each device resizes the same person's mix: both land, even if the shares no longer add to 100.
    const withDisc = (d: Device, disc: object) => d.save('contacts', { people: people(d).map((x) => (x.id === 'c1' ? { ...x, disc } : x)) })
    withDisc(a, { D: 50, S: 50 })
    await both()
    withDisc(a, { D: 70, S: 30 })
    withDisc(b, { D: 50, S: 50, C: 25 })
    await both()
    const mixes = [a, b].map((d) => (people(d).find((x) => x.id === 'c1') as unknown as { disc: object }).disc)
    assert.deepEqual(mixes[0], mixes[1], 'both devices agree')
    assertReplays(a)
    assertReplays(b)

    a.save('contacts', { people: [] })
    await both()
    assert.deepEqual(people(b), [], 'removing the last person reaches the other device')
    assert.equal(rb.state().error, null, 'and sync keeps going')
    b.save('contacts', { people: [person('c4', 'Synthetic Dao')] })
    await both()
    assert.deepEqual(people(a).map((x) => x.id), ['c4'], 'a person can be added after the list emptied')
  } finally {
    a.close()
    b.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
