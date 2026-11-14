// Copying a week's plan into a later week: what is taken, from which week, how copies are named, and
// the one change the button and the automatic copy each make. Shared by the browser and tests: types
// only from the schema, no other imports. `blank` is the schema's empty week, passed in by the caller.

import type { Habit, Quadrant, State, WeekData, WeekTask } from './schema.ts'

/**
 * Every copy has an id of its own: `<origin>~<random>`. Sync merges list items by id, field by field,
 * so two devices sharing an id would let the later copy undo ticks, boxes and renames made on the
 * earlier one. The cost, accepted, is a second line when two devices copy before they have synced.
 * The origin lets a copy be recognised on later presses even once renamed or moved, and it lasts
 * from copy to copy. Sync refuses ids over 100 characters, hence the limit.
 */
const origin = (id: string) => id.split('~')[0].slice(0, 60)
const newCopyId = (from: string) => `${origin(from)}~${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`

/** Habits have no identity beyond their name from week to week, so the name is their origin. */
const habitOrigin = (name: string) => `h${hash(sameWords(name))}`

const hash = (s: string) => {
  let a = 0x811c9dc5
  let b = 5381
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = ((b * 33) ^ c) >>> 0
  }
  return a.toString(36) + b.toString(36)
}

const sameWords = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

const named = (h: Habit) => !!h.name.trim()

function freshHabits(from: Habit[], have: Habit[]): Habit[] {
  const origins = new Set(have.map((h) => origin(h.id)))
  const names = new Set(have.map((h) => sameWords(h.name)))
  const out: Habit[] = []
  for (const h of from) {
    const name = sameWords(h.name)
    const stem = habitOrigin(h.name)
    if (!name || names.has(name) || origins.has(stem)) continue
    names.add(name)
    out.push({ id: newCopyId(stem), name: h.name, days: Array(7).fill(false) })
  }
  return out
}

/** Habits carry over: a new week starts with the habit names of the latest earlier week. */
export function carriedHabits(weeks: Record<string, WeekData>, monday: string): Habit[] {
  const prev = Object.keys(weeks)
    .filter((k) => k < monday && weeks[k].habits.some(named))
    .sort()
    .pop()
  return prev ? freshHabits(weeks[prev].habits, []) : []
}

const ideaOf = (s: State, t: WeekTask) => (t.ideaId ? s.focus.ideas.find((i) => i.id === t.ideaId) : undefined)

/**
 * A task that belongs to the week's plan: in a box, or planned Focus Map work wherever it sits (a
 * planned idea lands unsorted). An unsorted link to an idea that is gone, or whose add-on is off,
 * reads as a plain unsorted task.
 */
const inPlan = (s: State, t: WeekTask) => !!t.text.trim() && (t.q !== null || (!!ideaOf(s, t) && s.settings.modules.focusMap))

/** A task from an earlier week that the week can take. `key` is its id in that week, stable across renders. */
export interface Suggestion {
  key: string
  text: string
  q: Quadrant | null
  ideaId?: string
  stem: string
}

/** Unfinished plan lines of `from` that `monday` does not have yet, in order, with the ids they are known by. */
function candidates(s: State, from: WeekData, monday: string): Suggestion[] {
  const into = s.weeks[monday]
  const origins = new Set(into?.tasks.map((t) => origin(t.id)))
  const words = new Set(into?.tasks.map((t) => sameWords(t.text)))
  // Work planned into this week or moved on to a later one isn't planned here again.
  const ideas = new Set(
    Object.keys(s.weeks)
      .filter((k) => k >= monday)
      .flatMap((k) => s.weeks[k].tasks.map((t) => t.ideaId)),
  )
  // Two lines from one origin with the same words are a duplicate from sync: it stops here.
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const t of from.tasks) {
    if (!inPlan(s, t) || t.done || ideaOf(s, t)?.status === 'done') continue
    const stem = origin(t.ideaId ?? t.id)
    const line = `${stem}|${sameWords(t.text)}`
    if (origins.has(stem) || words.has(sameWords(t.text)) || (t.ideaId && ideas.has(t.ideaId)) || seen.has(line)) continue
    seen.add(line)
    if (t.ideaId) ideas.add(t.ideaId)
    out.push({ key: t.id, text: t.text, q: t.q, stem, ...(t.ideaId ? { ideaId: t.ideaId } : {}) })
  }
  return out
}

function freshTasks(s: State, from: WeekData, monday: string): WeekTask[] {
  return candidates(s, from, monday).map((c) => ({ id: newCopyId(c.stem), text: c.text, q: c.q, done: false, ...(c.ideaId ? { ideaId: c.ideaId } : {}) }))
}

/** `source` is the latest week the copy takes something from, or could have. */
export interface CopyPlan { source: string; tasks: WeekTask[]; habits: Habit[]; selfCare: string | null }

export const planSize = (p: CopyPlan) => p.tasks.length + p.habits.length + (p.selfCare === null ? 0 : 1)

/**
 * What copying into `monday` would add. Tasks come from the latest earlier week with any in its plan,
 * finished or not, so finished work stops older copies coming back. Habits and Self-care each come
 * from the latest earlier week that has them. Null if no earlier week has any of these.
 */
export function planCopy(s: State, monday: string): CopyPlan | null {
  const earlier = Object.keys(s.weeks)
    .filter((k) => k < monday)
    .sort()
    .reverse()
  const latest = (has: (w: WeekData) => boolean) => earlier.find((k) => has(s.weeks[k]))
  const taskWeek = latest((w) => w.tasks.some((t) => inPlan(s, t)))
  const habitWeek = latest((w) => w.habits.some(named))
  const careWeek = latest((w) => !!w.selfCare.trim())
  const into = s.weeks[monday]
  const tasks = taskWeek ? freshTasks(s, s.weeks[taskWeek], monday) : []
  const habits = habitWeek ? freshHabits(s.weeks[habitWeek].habits, into?.habits ?? carriedHabits(s.weeks, monday)) : []
  const selfCare = careWeek && !into?.selfCare.trim() ? s.weeks[careWeek].selfCare : null
  const possible = [taskWeek, habitWeek, careWeek].filter((k) => k !== undefined)
  if (!possible.length) return null
  const used = [tasks.length ? taskWeek : undefined, habits.length ? habitWeek : undefined, selfCare !== null ? careWeek : undefined].filter((k) => k !== undefined)
  return { source: (used.length ? used : possible).sort().pop()!, tasks, habits, selfCare }
}

/** Only adds. `week` is the target week, already seeded if it is new. */
export function applyCopyPlan(week: WeekData, plan: CopyPlan) {
  week.tasks.push(...plan.tasks)
  week.habits.push(...plan.habits)
  if (plan.selfCare !== null) week.selfCare = plan.selfCare
}

const seedWeek = (s: State, monday: string, blank: () => WeekData): WeekData => ({ ...blank(), habits: carriedHabits(s.weeks, monday) })

/** Adds the plan for `monday`, seeding the week if it is new. Returns the plan, null if no earlier week has one. */
export function copyInto(s: State, monday: string, blank: () => WeekData): CopyPlan | null {
  const plan = planCopy(s, monday)
  if (plan && planSize(plan)) applyCopyPlan((s.weeks[monday] ??= seedWeek(s, monday, blank)), plan)
  return plan
}

/** The key of the Self-care suggestion, which has no id of its own. */
export const CARE = 'care'

export interface Suggestions {
  tasks: Suggestion[]
  selfCare: string | null
}

/**
 * Pencil lines for `monday`: unfinished plan lines of the week before (`prev`), and its Self-care when this
 * week's is empty. Only the week right before, and only from `thisWeek` (the current Monday) onward. Lines
 * the week already has, by origin, words or idea, are left out, as are the `dropped` keys. Changes nothing.
 */
export function suggestions(s: State, monday: string, prev: string, thisWeek: string, dropped: readonly string[] = []): Suggestions {
  const from = monday >= thisWeek ? s.weeks[prev] : undefined
  if (!from) return { tasks: [], selfCare: null }
  const tasks = candidates(s, from, monday).filter((c) => !dropped.includes(c.key))
  const care = !from.selfCare.trim() || s.weeks[monday]?.selfCare.trim() || dropped.includes(CARE) ? null : from.selfCare
  return { tasks, selfCare: care }
}

/**
 * Keeps the pencil lines in `keys` for `monday`: each becomes a task of its own with a new id, and Self-care
 * fills only an empty field. Only what is still offered is added, so it never overwrites. Returns the keys kept.
 */
export function keepSuggestions(s: State, monday: string, prev: string, thisWeek: string, keys: ReadonlySet<string>, blank: () => WeekData): string[] {
  const offered = suggestions(s, monday, prev, thisWeek)
  const pick = offered.tasks.filter((c) => keys.has(c.key))
  const care = offered.selfCare !== null && keys.has(CARE)
  if (!pick.length && !care) return []
  const into = (s.weeks[monday] ??= seedWeek(s, monday, blank))
  into.tasks.push(...pick.map((c) => ({ id: newCopyId(c.stem), text: c.text, q: c.q, done: false, ...(c.ideaId ? { ideaId: c.ideaId } : {}) })))
  if (care) into.selfCare = offered.selfCare!
  return [...pick.map((c) => c.key), ...(care ? [CARE] : [])]
}

/** Whether the automatic copy still has this week to do: on, and not done for it yet. */
export const autoCopyDue = (s: State, monday: string): boolean => s.settings.autoCopyWeek && (s.settings.autoCopiedWeek ?? '') < monday

/** The automatic copy: the plan and the "done for this week" mark, in one change. False if not due. */
export function autoCopy(s: State, monday: string, blank: () => WeekData): boolean {
  if (!autoCopyDue(s, monday)) return false
  copyInto(s, monday, blank)
  s.settings.autoCopiedWeek = monday
  return true
}

/** Every week task linked to an idea, in week order. */
export const linkedWeekTasks = (s: State, ideaId: string) =>
  Object.keys(s.weeks)
    .sort()
    .flatMap((monday) => s.weeks[monday].tasks.filter((t) => t.ideaId === ideaId).map((task) => ({ monday, task })))

/**
 * Move a planned idea to `monday`. Its copies in the latest week that has one become one line there:
 * the boxed one keeps its box, finished in any copy means finished, and day tasks pulled from any of
 * them point at the line that is left. Copies in older weeks stay where they are. False if the idea
 * is in no week, or already in `monday`.
 */
export function carryIdea(s: State, ideaId: string, monday: string, blank: () => WeekData): boolean {
  const linked = linkedWeekTasks(s, ideaId)
  if (!linked.length || linked.some((l) => l.monday === monday)) return false
  const from = linked[linked.length - 1].monday
  const group = linked.filter((l) => l.monday === from).map((l) => l.task)
  const keep = group.find((t) => t.q !== null) ?? group[0]
  const moved: WeekTask = { ...keep, done: group.some((t) => t.done) }
  const gone = new Set(group.filter((t) => t !== keep).map((t) => t.id))
  s.weeks[from].tasks = s.weeks[from].tasks.filter((t) => t.ideaId !== ideaId)
  const into = (s.weeks[monday] ??= seedWeek(s, monday, blank))
  into.tasks.push(moved)
  for (const d of Object.values(s.days)) for (const t of d.tasks) if (t.weekTaskId && gone.has(t.weekTaskId)) t.weekTaskId = keep.id
  return true
}
