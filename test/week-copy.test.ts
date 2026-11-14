// Copying a week's plan: what is taken, how copies are named, and how they survive sync.
// The copy and the automatic copy are the functions the page runs; the two-device tests save and merge
// through the real store and sync runner, with a shared folder standing in for Google Drive. Synthetic data only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../server/db.ts'
import { FolderRemote } from '../server/sync/remote.ts'
import { SyncRunner } from '../server/sync/runner.ts'
import { API_LEVEL, docsToState, emptyState, emptyWeek, normalizeDoc, normalizeState, type State, type WeekData } from '../src/lib/schema.ts'
import { CARE, autoCopy, autoCopyDue, carriedHabits, carryIdea, copyInto, keepSuggestions, planCopy, planSize, suggestions } from '../src/lib/weekCopy.ts'

const W1 = '2026-11-02'
const W2 = '2026-11-09'
const W3 = '2026-11-16'
const W4 = '2026-11-23'

const week = (over: Partial<WeekData> = {}): WeekData => ({ ...emptyWeek(), ...over })
const task = (id: string, q: 'A' | 'B' | 'C' | 'D' | null, extra: object = {}) => ({ id, text: `synthetic ${id}`, q, done: false, ...extra })
const idea = (id: string, status: 'idea' | 'doing' | 'done' = 'doing') => ({ id, text: `idea ${id}`, x: null, y: null, status, date: null, createdAt: '' })

function fullWeek(): WeekData {
  return week({
    goal: 'synthetic goal',
    notes: 'synthetic notes',
    selfCare: 'synthetic walk',
    reflection: { checkin: 'synthetic', success: '', lesson: '', future: '', more: '', reviewed: true },
    habits: [{ id: 'h1', name: 'Read', days: [true, true, false, false, false, false, false] }, { id: 'h2', name: '  ', days: Array(7).fill(false) }],
    tasks: [
      task('a', 'A'),
      task('b', 'B'),
      task('c', 'C'),
      task('d', 'D'),
      task('finished', 'A', { done: true }),
      task('unsorted', null),
      task('work-box', 'B', { ideaId: 'i-box' }),
      task('work-unsorted', null, { ideaId: 'i-unsorted' }),
      task('work-done', 'A', { ideaId: 'i-done' }),
    ],
  })
}

function notebook(weeks: Record<string, WeekData> = { [W1]: fullWeek() }): State {
  const s = emptyState()
  s.weeks = weeks
  s.settings.modules.focusMap = true
  s.focus.ideas = [idea('i-box'), idea('i-unsorted', 'idea'), idea('i-done', 'done'), idea('i-never', 'idea')]
  s.days[W1] = { grateful: '', notes: '', sentence: '', tasks: [{ id: 'dt', text: 'synthetic day task', estimate: 1, pomos: 0, done: false, weekTaskId: 'a' }] }
  return s
}

const copy = (s: State, monday: string) => copyInto(s, monday, emptyWeek)
const auto = (s: State, monday: string) => autoCopy(s, monday, emptyWeek)
/** The keys of every pencil line offered for `monday`, as the page shows them. */
const offered = (s: State, monday: string, prev: string, thisWeek: string) => {
  const o = suggestions(s, monday, prev, thisWeek)
  return [...o.tasks.map((t) => t.key), ...(o.selfCare !== null ? [CARE] : [])]
}
/** Keep all the pencil lines offered (or only `keys`), as the page does. */
const keep = (s: State, monday: string, prev: string, thisWeek: string, keys = offered(s, monday, prev, thisWeek)) =>
  keepSuggestions(s, monday, prev, thisWeek, new Set(keys), emptyWeek)
const on = (s: State, marked: string) => {
  Object.assign(s.settings, { autoCopyWeek: true, autoCopiedWeek: marked })
  return s
}

/** Tasks as text|box|done|idea, sorted: every field a person can see, so a lost tick or box shows. */
const taskLines = (w: WeekData) => w.tasks.map((t) => `${t.text}|${t.q}|${t.done}|${t.ideaId ?? ''}`).sort()
const habitLines = (w: WeekData) => w.habits.map((h) => `${h.name}|${h.days.map((d) => (d ? 1 : 0)).join('')}`).sort()

// ───────── what is copied ─────────

test('copies unfinished boxed tasks, planned work, habit names and Self-care, and nothing else', () => {
  const s = notebook()
  const before = JSON.stringify(s.weeks[W1])
  copy(s, W2)
  const w = s.weeks[W2]
  assert.deepEqual(
    w.tasks.map((t) => [t.text, t.q, t.done, t.ideaId]),
    [
      ['synthetic a', 'A', false, undefined],
      ['synthetic b', 'B', false, undefined],
      ['synthetic c', 'C', false, undefined],
      ['synthetic d', 'D', false, undefined],
      ['synthetic work-box', 'B', false, 'i-box'],
      ['synthetic work-unsorted', null, false, 'i-unsorted'],
    ],
  )
  assert.deepEqual(habitLines(w), ['Read|0000000'], 'names only, ticks empty, no blank row')
  assert.equal(w.selfCare, 'synthetic walk')
  assert.deepEqual([w.goal, w.notes, w.reflection.checkin, w.reflection.reviewed], ['', '', '', false])
  assert.equal(s.days[W2], undefined, 'day tasks stay put')
  assert.ok(!w.tasks.some((t) => t.ideaId === 'i-never'), 'an idea never planned there stays on the map')
  assert.equal(JSON.stringify(s.weeks[W1]), before, 'source week unchanged')
  const ids = new Set(s.weeks[W1].tasks.map((t) => t.id))
  assert.ok(w.tasks.every((t) => !ids.has(t.id)), 'copies get ids of their own: an id lives in one week')
})

test('with Focus Map off, or the idea gone, an unsorted link reads as a plain task and stays behind', () => {
  const off = notebook()
  off.settings.modules.focusMap = false
  copy(off, W2)
  assert.ok(!off.weeks[W2].tasks.some((t) => t.ideaId === 'i-unsorted'))
  assert.ok(off.weeks[W2].tasks.some((t) => t.ideaId === 'i-box'), 'still in its box')

  const gone = notebook()
  gone.focus.ideas = gone.focus.ideas.filter((i) => i.id !== 'i-unsorted' && i.id !== 'i-box')
  copy(gone, W2)
  assert.ok(!gone.weeks[W2].tasks.some((t) => t.ideaId === 'i-unsorted'))
})

test('only adds: a second press adds nothing, and Self-care fills only when empty', () => {
  const s = notebook()
  s.weeks[W2] = week({ goal: 'keep', selfCare: 'my own', habits: [{ id: 'mine', name: 'read', days: [true, false, false, false, false, false, false] }], tasks: [task('own', 'A', { text: 'SYNTHETIC  B', done: true })] })
  copy(s, W2)
  const w = s.weeks[W2]
  assert.equal(w.goal, 'keep')
  assert.equal(w.selfCare, 'my own')
  assert.deepEqual(habitLines(w), ['read|1000000'], 'same habit by name, ticks kept, no second row')
  assert.equal(w.tasks[0].id, 'own')
  assert.ok(!w.tasks.some((t) => t.text === 'synthetic b'), 'same words count as already there, whatever the box')
  const after = JSON.stringify(w)
  assert.equal(planSize(copy(s, W2)!), 0)
  assert.equal(JSON.stringify(s.weeks[W2]), after)
})

test('a later press recognises a copy that was renamed or moved, in tasks and habits', () => {
  const s = notebook()
  copy(s, W2)
  const w = s.weeks[W2]
  const a = w.tasks.find((t) => t.text === 'synthetic a')!
  a.text = 'renamed'
  a.q = 'D'
  w.tasks.find((t) => t.ideaId === 'i-box')!.q = 'A'
  w.habits[0].name = 'Read a lot'
  assert.equal(planSize(planCopy(s, W2)!), 0)
})

test('a copy deleted by hand comes back only when the button is pressed again, as a new line', () => {
  const s = notebook()
  copy(s, W2)
  const gone = s.weeks[W2].tasks.find((t) => t.text === 'synthetic a')!
  s.weeks[W2].tasks = s.weeks[W2].tasks.filter((t) => t !== gone)
  const plan = planCopy(s, W2)!
  assert.deepEqual(plan.tasks.map((t) => t.text), ['synthetic a'])
  assert.notEqual(plan.tasks[0].id, gone.id)
})

test('work already planned into the target, or moved on to a later week, is not planned there again', () => {
  const here = notebook()
  here.weeks[W2] = week({ tasks: [task('moved-here', null, { ideaId: 'i-box' })] })
  copy(here, W2)
  assert.equal(here.weeks[W2].tasks.filter((t) => t.ideaId === 'i-box').length, 1)

  const later = notebook()
  later.weeks[W3] = week({ tasks: [task('moved-on', 'A', { ideaId: 'i-box' })] })
  assert.ok(!planCopy(later, W2)!.tasks.some((t) => t.ideaId === 'i-box'))
})

test('a page with two tasks on one idea, from before copies, copies one', () => {
  const s = notebook({ [W1]: week({ tasks: [task('old-1', 'A', { ideaId: 'i-box' }), task('old-2', 'B', { ideaId: 'i-box' })] }) })
  assert.equal(planCopy(s, W2)!.tasks.length, 1)
})

test('ids of copies of copies stay short, whatever the id they came from', () => {
  const s = notebook({ [W1]: week({ tasks: [task('x'.repeat(500), 'A')] }) })
  copy(s, W2)
  copy(s, W3)
  for (const m of [W2, W3]) for (const t of s.weeks[m].tasks) assert.ok(t.id.length <= 100, `${m} id is ${t.id.length} long`)
  const first = s.weeks[W2].tasks[0].id
  const second = s.weeks[W3].tasks[0].id
  assert.ok(second.startsWith(first.split('~')[0] + '~'), 'a copy of a copy is still the same item')
  assert.notEqual(second, first, 'and each week has its own id')
})

test('habits seeded for a new week get an id of their own, so two devices never share one', () => {
  const s = notebook()
  const one = carriedHabits(s.weeks, W2)
  const two = carriedHabits(s.weeks, W2)
  assert.deepEqual(one.map((h) => h.name), ['Read'])
  assert.notEqual(one[0].id, two[0].id)
})

test('seeding skips blank and repeated habit names', () => {
  const s = notebook({ [W1]: week({ habits: [{ id: 'x', name: 'Read', days: Array(7).fill(true) }, { id: 'y', name: ' read ', days: Array(7).fill(false) }, { id: 'z', name: ' ', days: Array(7).fill(false) }] }) })
  assert.deepEqual(carriedHabits(s.weeks, W2).map((h) => [h.name, h.days.some(Boolean)]), [['Read', false]])
})

// ───────── which week it comes from ─────────

test('one device: a copy finished in W2 is the source for tasks, so the older unfinished task does not come back in W3', () => {
  const s = notebook({ [W1]: week({ tasks: [task('a', 'A')] }) })
  copy(s, W2)
  s.weeks[W2].tasks[0].done = true
  const plan = planCopy(s, W3)!
  assert.deepEqual(plan.tasks, [])
  assert.equal(plan.source, W2, 'the button can say where it looked')
  assert.equal(planSize(plan), 0)
})

test('a finished Focus idea counts too, and blank rows do not', () => {
  const finished = notebook({ [W1]: week({ tasks: [task('a', 'A')] }), [W2]: week({ tasks: [task('w', null, { ideaId: 'i-done', done: true })] }) })
  assert.deepEqual(planCopy(finished, W3)!.tasks, [])
  const blank = notebook({ [W1]: week({ tasks: [task('a', 'A')] }), [W2]: week({ tasks: [task('b', 'B', { text: '   ' })] }) })
  assert.deepEqual(planCopy(blank, W3)!.tasks.map((t) => t.text), ['synthetic a'])
})

test('a week with only a goal, habits or plain unsorted tasks is passed over for tasks', () => {
  const passed = week({ goal: 'only a goal', habits: [{ id: 'h', name: 'Run', days: Array(7).fill(false) }], tasks: [task('loose', null)] })
  const s = notebook({ [W1]: week({ tasks: [task('a', 'A')], habits: [{ id: 'old', name: 'Read', days: Array(7).fill(false) }] }), [W2]: passed })
  const plan = planCopy(s, W3)!
  assert.deepEqual(plan.tasks.map((t) => t.text), ['synthetic a'])
  assert.equal(plan.source, W1, 'tasks came from there')
  copy(s, W3)
  assert.deepEqual(s.weeks[W3].habits.map((h) => h.name), ['Run'], 'habits come from the latest week that has them')
})

test('habits and Self-care each come from the latest earlier week that has them', () => {
  const s = notebook({
    [W1]: week({ selfCare: 'older care', habits: [{ id: 'h', name: 'Read', days: Array(7).fill(false) }], tasks: [task('a', 'A', { done: true })] }),
    [W2]: week({ tasks: [task('b', 'B')] }),
  })
  s.weeks[W3] = week()
  const plan = planCopy(s, W3)!
  assert.deepEqual([plan.tasks.map((t) => t.text), plan.habits.map((h) => h.name), plan.selfCare], [['synthetic b'], ['Read'], 'older care'])
  assert.equal(plan.source, W2, 'the latest week it takes something from')
  const newer = notebook({ [W1]: week({ selfCare: 'older' }), [W2]: week({ selfCare: 'newer' }) })
  assert.equal(planCopy(newer, W3)!.selfCare, 'newer')
})

test('the owner’s accepted exception: deleting every task from the latest week lets older unfinished ones come', () => {
  const s = notebook({ [W1]: week({ tasks: [task('a', 'A')] }), [W2]: week({ tasks: [task('b', 'B', { done: true })] }) })
  assert.deepEqual(planCopy(s, W3)!.tasks, [])
  s.weeks[W2].tasks = []
  assert.deepEqual(planCopy(s, W3)!.tasks.map((t) => t.text), ['synthetic a'])
})

test('nothing earlier, or nothing to copy anywhere, is no plan; a week only draws on earlier ones', () => {
  assert.equal(planCopy(notebook({ [W2]: fullWeek() }), W1), null)
  assert.equal(planCopy(notebook({ [W1]: week({ goal: 'only a goal', tasks: [task('loose', null)] }) }), W2), null)
})

// ───────── the two ways of copying, and the once-a-week mark ─────────

test('the automatic copy runs once for its week: a second run adds nothing, and a deleted copy stays deleted', () => {
  const s = notebook()
  assert.equal(auto(s, W2), false, 'switched off: nothing')
  assert.equal(W2 in s.weeks, false)
  on(s, W1)
  assert.equal(autoCopyDue(s, W2), true)
  assert.equal(auto(s, W2), true)
  assert.equal(s.settings.autoCopiedWeek, W2, 'the mark is saved with the copy')
  s.weeks[W2].tasks = s.weeks[W2].tasks.filter((t) => t.text !== 'synthetic a')
  assert.equal(autoCopyDue(s, W2), false)
  assert.equal(auto(s, W2), false)
  assert.ok(!s.weeks[W2].tasks.some((t) => t.text === 'synthetic a'), 'still gone after the second run')
})

test('with the switch off, nothing is copied automatically', () => {
  const s = notebook()
  assert.equal(auto(s, W2), false)
  assert.equal(W2 in s.weeks, false)
})

// ───────── pencil lines: last week's unfinished work, offered until someone keeps it ─────────

const ALL = ['a', 'b', 'c', 'd', 'work-box', 'work-unsorted', CARE].sort()

test('pencil lines come from the week right before, from the current week on, and never from past weeks', () => {
  const s = notebook()
  assert.deepEqual(offered(s, W2, W1, W2).sort(), ALL, 'six lines and Self-care from last week')
  assert.deepEqual(offered(s, W3, W2, W2), [], 'the week before is empty, so nothing from week one reaches week three')
  assert.deepEqual(offered(s, W2, W1, W3), [], 'a past week offers nothing')
})

test('looking at pencil lines saves nothing', () => {
  const s = notebook()
  const before = JSON.stringify(s)
  offered(s, W2, W1, W2)
  assert.equal(JSON.stringify(s), before)
  assert.equal(W2 in s.weeks, false)
})

test('keeping one line adds it with an id of its own; the rest stay offered; the box goes with it', () => {
  const s = notebook()
  assert.deepEqual(keep(s, W2, W1, W2, ['b']), ['b'])
  assert.deepEqual(taskLines(s.weeks[W2]), ['synthetic b|B|false|'])
  assert.notEqual(s.weeks[W2].tasks[0].id, 'b', 'a copy has an id of its own')
  const left = offered(s, W2, W1, W2)
  assert.equal(left.includes('b'), false, 'kept, so not offered again')
  assert.equal(left.includes('a'), true)
  keep(s, W2, W1, W2, ['work-box'])
  assert.ok(taskLines(s.weeks[W2]).includes('synthetic work-box|B|false|i-box'), 'planned work keeps its box and its idea')
})

test('keep all adds each line once and fills Self-care only when it is empty; a second keep adds nothing', () => {
  const s = notebook()
  assert.equal(keep(s, W2, W1, W2).length, ALL.length)
  assert.equal(s.weeks[W2].tasks.length, 6)
  assert.equal(s.weeks[W2].selfCare, 'synthetic walk')
  assert.deepEqual(keep(s, W2, W1, W2), [], 'nothing left to keep')
  assert.equal(s.weeks[W2].tasks.length, 6)
})

test('Self-care already written is never offered or overwritten', () => {
  const s = notebook({ [W1]: fullWeek(), [W2]: week({ selfCare: 'synthetic mine' }) })
  assert.equal(offered(s, W2, W1, W2).includes(CARE), false)
  keep(s, W2, W1, W2, [CARE])
  assert.equal(s.weeks[W2].selfCare, 'synthetic mine')
})

test('a dropped line is left out of the list, and only for the keys given', () => {
  const s = notebook()
  const dropped = suggestions(s, W2, W1, W2, ['b', CARE])
  assert.equal(dropped.tasks.some((t) => t.key === 'b'), false)
  assert.equal(dropped.selfCare, null)
  assert.equal(suggestions(s, W2, W1, W2).tasks.some((t) => t.key === 'b'), true, 'without the drop it is offered')
})

test('writing first: a line the week already has, by words or by idea, is not offered', () => {
  const s = notebook({
    [W1]: fullWeek(),
    [W2]: week({ tasks: [{ id: 'typed', text: 'synthetic a', q: 'A', done: false }, { id: 'typed-work', text: 'my own words', q: 'B', done: false, ideaId: 'i-box' }] }),
  })
  const have = offered(s, W2, W1, W2)
  assert.equal(have.includes('a'), false, 'same words')
  assert.equal(have.includes('work-box'), false, 'same idea')
  assert.equal(have.includes('b'), true)
})

test('the automatic copy and the pencil lines never double: once copied, nothing is offered and a keep adds nothing', () => {
  const s = notebook()
  s.settings.autoCopyWeek = true
  assert.equal(auto(s, W2), true)
  assert.deepEqual(offered(s, W2, W1, W2), [])
  assert.deepEqual(keep(s, W2, W1, W2), [])
  assert.equal(s.weeks[W2].tasks.length, 6)
})

test('a line whose work has moved on since it was offered is not kept', () => {
  const s = notebook()
  s.weeks[W1].tasks.find((t) => t.id === 'b')!.done = true
  assert.deepEqual(keep(s, W2, W1, W2, ['b']), [])
  assert.equal(W2 in s.weeks, false, 'nothing kept, so the week is not made')
})

// ───────── moving a planned idea ─────────

test('moving a planned idea carries its copies in the latest week as one line; older copies stay put', () => {
  const s = notebook({
    [W1]: week({ tasks: [task('i-box~old', 'A', { ideaId: 'i-box' })] }),
    [W2]: week({ tasks: [task('i-box~a1', 'B', { ideaId: 'i-box' }), task('i-box~b2', null, { ideaId: 'i-box' })] }),
  })
  s.days[W2] = { grateful: '', notes: '', sentence: '', tasks: [{ id: 'dt', text: 'synthetic day on b2', estimate: 1, pomos: 0, done: false, weekTaskId: 'i-box~b2' }] }
  assert.equal(carryIdea(s, 'i-box', W4, emptyWeek), true)
  assert.deepEqual(s.weeks[W2].tasks, [], 'the latest week lets go of both copies')
  assert.deepEqual(s.weeks[W4].tasks.map((t) => [t.id, t.q, t.done, t.ideaId]), [['i-box~a1', 'B', false, 'i-box']], 'one line, keeping the boxed copy’s box')
  assert.equal(s.days[W2].tasks[0].weekTaskId, 'i-box~a1', 'a day task from the other copy follows the line that is left')
  assert.deepEqual(s.weeks[W1].tasks.map((t) => t.id), ['i-box~old'], 'the older copy stays where it is')
})

test('moving keeps a finished state from any copy', () => {
  const s = notebook({ [W2]: week({ tasks: [task('i-box~x1', 'A', { ideaId: 'i-box', done: true }), task('i-box~x2', 'B', { ideaId: 'i-box' })] }) })
  carryIdea(s, 'i-box', W3, emptyWeek)
  assert.deepEqual(s.weeks[W3].tasks.map((t) => [t.id, t.q, t.done]), [['i-box~x1', 'A', true]])
})

test('moving does nothing when the idea is in no week or already in the target', () => {
  const none = notebook({ [W2]: week({ tasks: [task('loose', 'A')] }) })
  assert.equal(carryIdea(none, 'i-box', W3, emptyWeek), false)
  assert.equal(W3 in none.weeks, false)
  const here = notebook({ [W2]: week({ tasks: [task('i-box~a', 'B', { ideaId: 'i-box' })] }), [W3]: week({ tasks: [task('i-box~c', 'A', { ideaId: 'i-box' })] }) })
  const before = JSON.stringify(here)
  assert.equal(carryIdea(here, 'i-box', W3, emptyWeek), false)
  assert.equal(JSON.stringify(here), before)
})

// ───────── settings and page shape ─────────

test('settings: off by default, older pages read fine, and the fields survive a save and an import', () => {
  // Pages with these fields need API_LEVEL above the older level 7; the upgrade test checks the handshake.
  assert.ok(API_LEVEL > 7)
  const old = docsToState([{ key: 'settings', value: { ink: 'hand', focusMin: 25, breakMin: 5 } }])
  assert.equal(old.settings.autoCopyWeek, false)
  assert.equal(old.settings.autoCopiedWeek, null)
  assert.equal(old.settings.ink, 'hand')
  const set = { ...emptyState().settings, autoCopyWeek: true, autoCopiedWeek: W2 }
  assert.deepEqual(normalizeDoc('settings', set), set)
  assert.deepEqual(normalizeState({ version: 1, weeks: {}, settings: set }).state.settings, set)
  assert.equal((normalizeDoc('settings', { ...set, autoCopiedWeek: 'not a day' }) as State['settings']).autoCopiedWeek, null)
})

// ───────── two devices, through a shared folder ─────────

function device() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-weekcopy-'))
  const store = new Store(dir)
  return {
    store,
    state: () => docsToState(store.allDocs()),
    /** Save what differs between the state before and after an edit, the way a tab does. */
    edit(fn: (s: State) => void) {
      const s = structuredClone(this.state())
      fn(s)
      const keys = [...Object.keys(s.weeks).map((k) => `week:${k}`), 'settings', 'focus', ...Object.keys(s.days).map((k) => `day:${k}`)]
      const value = (k: string) => (k === 'settings' ? s.settings : k === 'focus' ? s.focus : k.startsWith('week:') ? s.weeks[k.slice(5)] : s.days[k.slice(4)])
      const now = new Map(store.allDocs().map((d) => [d.key, d]))
      const changes = keys.filter((k) => JSON.stringify(now.get(k)?.value) !== JSON.stringify(normalizeDoc(k, value(k)))).map((k) => ({ key: k, baseRev: now.get(k)?.rev ?? 0, value: value(k) }))
      if (changes.length) store.putDocs(changes)
    },
    close() {
      store.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

interface Pair {
  a: ReturnType<typeof device>
  b: ReturnType<typeof device>
  /** Both devices sync, then A once more, so each has the other's changes. */
  sync: () => Promise<void>
  syncA: () => Promise<void>
  syncB: () => Promise<void>
}

async function twoDevices(run: (p: Pair) => Promise<void>) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-weekcopy-drive-'))
  const remote = new FolderRemote(folder)
  const a = device()
  const b = device()
  const ra = new SyncRunner(a.store, async () => remote)
  const rb = new SyncRunner(b.store, async () => remote)
  const syncA = () => ra.syncNow()
  const syncB = () => rb.syncNow()
  const sync = async () => {
    await ra.syncNow()
    await rb.syncNow()
    await ra.syncNow()
  }
  try {
    a.edit((s) => Object.assign(s, notebook()))
    await ra.join('start')
    await rb.join('replace')
    await run({ a, b, sync, syncA, syncB })
    assert.deepEqual(a.store.allDocs().map((d) => [d.key, d.value]), b.store.allDocs().map((d) => [d.key, d.value]), 'both devices hold the same pages')
  } finally {
    ra.stop()
    rb.stop()
    a.close()
    b.close()
    fs.rmSync(folder, { recursive: true, force: true })
  }
}

const sorted = (xs: string[]) => [...xs].sort()

test('sync, scenario 1: a copy edited on one device and the same week copied unsynced on the other keeps every edit', async () => {
  await twoDevices(async ({ a, b, sync, syncA }) => {
    a.edit((s) => void copy(s, W2))
    await syncA()
    a.edit((s) => {
      const w = s.weeks[W2]
      for (const t of w.tasks) {
        if (t.text === 'synthetic a') t.done = true
        if (t.text === 'synthetic b') t.q = 'D'
      }
      w.tasks = w.tasks.filter((t) => t.text !== 'synthetic c')
      w.habits[0].days[0] = true
    })
    // B has seen nothing of W2 yet, so it copies from its own older view.
    b.edit((s) => void copy(s, W2))
    await sync()
    const w = a.state().weeks[W2]
    assert.deepEqual(taskLines(w), sorted([
      'synthetic a|A|false|', 'synthetic a|A|true|',
      'synthetic b|B|false|', 'synthetic b|D|false|',
      'synthetic c|C|false|',
      'synthetic d|D|false|', 'synthetic d|D|false|',
      'synthetic work-box|B|false|i-box', 'synthetic work-box|B|false|i-box',
      'synthetic work-unsorted|null|false|i-unsorted', 'synthetic work-unsorted|null|false|i-unsorted',
    ]), 'A’s finished, moved and deleted lines are as A left them; B’s copy adds its own set')
    assert.deepEqual(habitLines(w), ['Read|0000000', 'Read|1000000'], 'A’s tick is kept; B’s seeded row is the extra one')
    assert.equal(w.selfCare, 'synthetic walk')
  })
})

test('sync, scenario 2: ticks on a habit survive when the other device starts the same week by typing a goal', async () => {
  await twoDevices(async ({ a, b, sync, syncA }) => {
    a.edit((s) => void (s.weeks[W2] = { ...emptyWeek(), habits: carriedHabits(s.weeks, W2) }))
    await syncA()
    a.edit((s) => void (s.weeks[W2].habits[0].days = [true, true, false, false, false, false, false]))
    await syncA()
    // B has not seen W2: it starts the week itself, which seeds the habit again under its own id.
    b.edit((s) => void (s.weeks[W2] = { ...emptyWeek(), goal: 'typed on B', habits: carriedHabits(s.weeks, W2) }))
    await sync()
    const w = a.state().weeks[W2]
    assert.equal(w.goal, 'typed on B')
    assert.deepEqual(habitLines(w), ['Read|0000000', 'Read|1100000'], 'the ticks are still there; the extra row is the accepted duplicate')
    assert.deepEqual(habitLines(b.state().weeks[W2]), habitLines(w), 'both devices agree')
  })
})

test('sync, scenario 4: copies of the same line, from before and after a rename, keep their whole text', async () => {
  await twoDevices(async ({ a, b, sync, syncA }) => {
    a.edit((s) => void copy(s, W2))
    await syncA()
    // B reworded the line in W1 and copies it into W2 without having seen A’s copy: the same source, a different text.
    b.edit((s) => {
      s.weeks[W1].tasks.find((t) => t.id === 'a')!.text = 'synthetic a, reworded on B'
      copy(s, W2)
    })
    await sync()
    const texts = a.state().weeks[W2].tasks.map((t) => t.text)
    assert.deepEqual(texts.filter((t) => t.startsWith('synthetic a')).sort(), ['synthetic a', 'synthetic a, reworded on B'], 'each line whole, neither mixed into the other')
    assert.ok(texts.every((t) => !/arenamed|reworded on B[a-z]/.test(t)))
  })
})

test('sync: both devices copy Self-care from the same week, and it is written once', async () => {
  await twoDevices(async ({ a, b, sync }) => {
    a.edit((s) => void copy(s, W2))
    b.edit((s) => void copy(s, W2))
    await sync()
    assert.equal(a.state().weeks[W2].selfCare, 'synthetic walk')
  })
})

test('sync: a line kept on one device and the automatic copy on the other, both unsynced: the accepted duplicate, nothing lost', async () => {
  await twoDevices(async ({ a, b, sync }) => {
    a.edit((s) => void keep(on(s, W1), W2, W1, W2, ['a']))
    b.edit((s) => void auto(on(s, W1), W2))
    await sync()
    const w = a.state().weeks[W2]
    assert.equal(taskLines(w).filter((t) => t.startsWith('synthetic a|')).length, 2, 'one line from each device')
    assert.equal(a.state().settings.autoCopiedWeek, W2)
  })
})

test('sync: work typed by hand on the other device is kept next to the copies', async () => {
  await twoDevices(async ({ a, b, sync }) => {
    a.edit((s) => void auto(on(s, W1), W2))
    b.edit((s) => void (s.weeks[W2] = week({ tasks: [task('typed-on-b', 'A')] })))
    await sync()
    assert.ok(taskLines(a.state().weeks[W2]).includes('synthetic typed-on-b|A|false|'))
    assert.ok(taskLines(a.state().weeks[W2]).includes('synthetic a|A|false|'))
  })
})

test('sync: a copy deleted on one device is not copied back by a device that has seen the mark', async () => {
  await twoDevices(async ({ a, b, sync, syncB }) => {
    a.edit((s) => void auto(on(s, W1), W2))
    await sync()
    a.edit((s) => void (s.weeks[W2].tasks = s.weeks[W2].tasks.filter((t) => t.text !== 'synthetic a')))
    await sync()
    await syncB()
    const seen = b.state()
    assert.equal(seen.settings.autoCopiedWeek, W2)
    assert.equal(auto(structuredClone(seen), W2), false, 'the second run on B adds nothing')
    assert.ok(!seen.weeks[W2].tasks.some((t) => t.text === 'synthetic a'))
  })
})

test('sync, finding 5: a device behind on its own unsynced edits copies from what it has; the newer edit is not lost, and A’s automatic copy waits for the mark', async () => {
  await twoDevices(async ({ a, b, sync, syncB }) => {
    a.edit((s) => void copy(s, W2))
    await sync()
    // A adds a task to W2 and has not synced it yet.
    a.edit((s) => void s.weeks[W2].tasks.push(task('newer-on-a', 'B')))
    // B copies W3 after its own sync, which does not yet include A’s newer task.
    await syncB()
    b.edit((s) => void auto(on(s, W2), W3))
    await sync()
    assert.ok(taskLines(b.state().weeks[W2]).includes('synthetic newer-on-a|B|false|'), 'the newer task reaches B as it always does')
    assert.ok(!taskLines(b.state().weeks[W3]).includes('synthetic newer-on-a|B|false|'), 'W3 is the copy B took; the newer task is not in it')
    assert.equal(a.state().settings.autoCopiedWeek, W3)
    a.edit((s) => void assert.equal(auto(s, W3), false, 'A does not copy again; the button can add the newer task'))
  })
})

test('sync: both devices synced, then both run the automatic copy before either mark arrives: a duplicate line, and then one mark', async () => {
  await twoDevices(async ({ a, b, sync, syncA, syncB }) => {
    a.edit((s) => void on(s, W1))
    await sync()
    await syncA()
    await syncB()
    a.edit((s) => void auto(s, W2))
    b.edit((s) => void auto(s, W2))
    await sync()
    const w = a.state().weeks[W2]
    assert.equal(taskLines(w).filter((t) => t.startsWith('synthetic a|')).length, 2, 'the race adds two copies of each line; both are whole')
    assert.equal(a.state().settings.autoCopiedWeek, W2)
    assert.equal(b.state().settings.autoCopiedWeek, W2)
    a.edit((s) => void assert.equal(auto(s, W2), false))
    b.edit((s) => void assert.equal(auto(s, W2), false))
  })
})
