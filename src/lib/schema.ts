// Planner data shape, defaults, and a non-destructive validator.
// Shared by the browser app and the local server, so it must stay free of DOM, React, and Node imports.

export type Quadrant = 'A' | 'B' | 'C' | 'D'

export interface Goal { text: string; done: boolean }

export interface MonthData {
  theme: string
  goals: Goal[]
  cells: Record<string, string>
  moods: Record<string, number>
  notes: string
}

export interface WeekTask { id: string; text: string; q: Quadrant | null; done: boolean }
export interface Habit { id: string; name: string; days: boolean[] }
export interface Reflection { checkin: string; success: string; lesson: string; future: string; more: string; reviewed: boolean }

export interface WeekData {
  goal: string
  notes: string
  tasks: WeekTask[]
  habits: Habit[]
  selfCare: string
  reflection: Reflection
}

export interface DayTask { id: string; text: string; estimate: number; pomos: number; done: boolean; weekTaskId?: string }

export interface DayData {
  grateful: string
  tasks: DayTask[]
  notes: string
  sentence: string
}

export interface Settings { ink: 'serif' | 'hand'; focusMin: number; breakMin: number }

export interface State {
  version: 1
  months: Record<string, MonthData>
  weeks: Record<string, WeekData>
  days: Record<string, DayData>
  settings: Settings
}

export const SCHEMA_VERSION = 1

export const emptyMonth = (): MonthData => ({
  theme: '',
  goals: [0, 1, 2].map(() => ({ text: '', done: false })),
  cells: {},
  moods: {},
  notes: '',
})

export const emptyWeek = (): WeekData => ({
  goal: '',
  notes: '',
  tasks: [],
  habits: [],
  selfCare: '',
  reflection: { checkin: '', success: '', lesson: '', future: '', more: '', reviewed: false },
})

export const emptyDay = (): DayData => ({ grateful: '', tasks: [], notes: '', sentence: '' })

export const defaultSettings = (): Settings => ({ ink: 'serif', focusMin: 25, breakMin: 5 })

export const emptyState = (): State => ({ version: 1, months: {}, weeks: {}, days: {}, settings: defaultSettings() })

// ───────── documents: how State is stored, one row per page ─────────

export type DocKind = 'month' | 'week' | 'day' | 'settings'
export interface Doc { key: string; value: unknown }

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

export const validDayKey = (k: string) => {
  if (!DAY_KEY.test(k)) return false
  const [y, m, d] = k.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** "month:2026-10" → ['month', '2026-10']; null if the key is not a valid document key. */
export function parseDocKey(key: string): [DocKind, string] | null {
  if (key === 'settings') return ['settings', '']
  const [kind, id] = key.split(':')
  if (kind === 'month' && MONTH_KEY.test(id ?? '')) return ['month', id]
  if ((kind === 'week' || kind === 'day') && validDayKey(id ?? '')) return [kind, id]
  return null
}

export function stateToDocs(s: State): Doc[] {
  return [
    ...Object.entries(s.months).map(([k, v]) => ({ key: `month:${k}`, value: v })),
    ...Object.entries(s.weeks).map(([k, v]) => ({ key: `week:${k}`, value: v })),
    ...Object.entries(s.days).map(([k, v]) => ({ key: `day:${k}`, value: v })),
    { key: 'settings', value: s.settings },
  ]
}

/** Assemble State from already-validated documents. */
export function docsToState(docs: Doc[]): State {
  const s = emptyState()
  for (const { key, value } of docs) {
    const p = parseDocKey(key)
    if (!p) continue
    const [kind, id] = p
    if (kind === 'month') s.months[id] = value as MonthData
    else if (kind === 'week') s.weeks[id] = value as WeekData
    else if (kind === 'day') s.days[id] = value as DayData
    else s.settings = value as Settings
  }
  return s
}

// ───────── validation ─────────

export class SchemaError extends Error {}

export interface Quarantined { path: string; value: unknown }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Collects repairs while normalizing. In lenient mode (imports) values that don't fit are set aside in
 * `quarantine` so no user text is silently lost. In strict mode (live saves) any repair is an error.
 */
class Ctx {
  issues: string[] = []
  quarantine: Quarantined[] = []
  strict: boolean
  constructor(strict: boolean) {
    this.strict = strict
  }
  park(path: string, value: unknown, why: string) {
    if (this.strict) throw new SchemaError(`${path}: ${why}`)
    this.quarantine.push({ path, value })
    this.issues.push(`${path}: ${why}; kept aside.`)
  }
  str(v: unknown, path: string): string {
    if (typeof v === 'string') return v
    if (v === undefined || v === null) return ''
    if (!this.strict && (typeof v === 'number' || typeof v === 'boolean')) return String(v)
    this.park(path, v, 'expected text')
    return ''
  }
  list(v: unknown, path: string): unknown[] {
    if (Array.isArray(v)) return v
    if (v !== undefined && v !== null) this.park(path, v, 'expected a list')
    return []
  }
  record(v: unknown, path: string): Record<string, unknown> {
    if (isObj(v)) return v
    if (v !== undefined && v !== null) this.park(path, v, 'expected a record')
    return {}
  }
}

const bool = (v: unknown) => v === true
const num = (v: unknown, lo: number, hi: number, dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt
/** Missing ids get a deterministic one from the item's path, so the browser and server agree when verifying. */
const pathId = (path: string) => {
  let h = 5381
  for (let i = 0; i < path.length; i++) h = ((h * 33) ^ path.charCodeAt(i)) >>> 0
  return `p${h.toString(36)}`
}
const id = (v: unknown, path: string) => (typeof v === 'string' && v ? v : pathId(path))

function month(c: Ctx, m: Record<string, unknown>, p: string): MonthData {
  const goals = c.list(m.goals, `${p}.goals`).map((g, i) =>
    isObj(g) ? { text: c.str(g.text, `${p}.goals.${i}.text`), done: bool(g.done) } : { text: c.str(g, `${p}.goals.${i}`), done: false },
  )
  while (goals.length < 3) goals.push({ text: '', done: false })
  const cells: Record<string, string> = {}
  for (const [d, t] of Object.entries(c.record(m.cells, `${p}.cells`))) cells[d] = c.str(t, `${p}.cells.${d}`)
  const moods: Record<string, number> = {}
  for (const [d, v] of Object.entries(c.record(m.moods, `${p}.moods`))) {
    if (typeof v === 'number' && v >= 1 && v <= 5) moods[d] = Math.round(v)
    else c.park(`${p}.moods.${d}`, v, 'mood out of range')
  }
  return { theme: c.str(m.theme, `${p}.theme`), goals, cells, moods, notes: c.str(m.notes, `${p}.notes`) }
}

function week(c: Ctx, w: Record<string, unknown>, p: string): WeekData {
  const r = c.record(w.reflection, `${p}.reflection`)
  return {
    goal: c.str(w.goal, `${p}.goal`),
    notes: c.str(w.notes, `${p}.notes`),
    selfCare: c.str(w.selfCare, `${p}.selfCare`),
    tasks: c.list(w.tasks, `${p}.tasks`).flatMap((t, i) => {
      if (!isObj(t)) {
        c.park(`${p}.tasks.${i}`, t, 'unrecognized task')
        return []
      }
      const q = t.q === 'A' || t.q === 'B' || t.q === 'C' || t.q === 'D' ? t.q : null
      return [{ id: id(t.id, `${p}.tasks.${i}`), text: c.str(t.text, `${p}.tasks.${i}.text`), q, done: bool(t.done) }]
    }),
    habits: c.list(w.habits, `${p}.habits`).flatMap((h, i) => {
      if (!isObj(h)) {
        c.park(`${p}.habits.${i}`, h, 'unrecognized habit')
        return []
      }
      const days = Array.from({ length: 7 }, (_, d) => bool(Array.isArray(h.days) ? h.days[d] : false))
      return [{ id: id(h.id, `${p}.habits.${i}`), name: c.str(h.name, `${p}.habits.${i}.name`), days }]
    }),
    reflection: {
      checkin: c.str(r.checkin, `${p}.reflection.checkin`),
      success: c.str(r.success, `${p}.reflection.success`),
      lesson: c.str(r.lesson, `${p}.reflection.lesson`),
      future: c.str(r.future, `${p}.reflection.future`),
      more: c.str(r.more, `${p}.reflection.more`),
      reviewed: bool(r.reviewed),
    },
  }
}

function day(c: Ctx, d: Record<string, unknown>, p: string): DayData {
  return {
    grateful: c.str(d.grateful, `${p}.grateful`),
    notes: c.str(d.notes, `${p}.notes`),
    sentence: c.str(d.sentence, `${p}.sentence`),
    tasks: c.list(d.tasks, `${p}.tasks`).flatMap((t, i) => {
      if (!isObj(t)) {
        c.park(`${p}.tasks.${i}`, t, 'unrecognized task')
        return []
      }
      const task: DayTask = {
        id: id(t.id, `${p}.tasks.${i}`),
        text: c.str(t.text, `${p}.tasks.${i}.text`),
        estimate: num(t.estimate, 1, 10, 1),
        pomos: num(t.pomos, 0, 10, 0),
        done: bool(t.done),
      }
      if (typeof t.weekTaskId === 'string') task.weekTaskId = t.weekTaskId
      return [task]
    }),
  }
}

function settings(s: Record<string, unknown>): Settings {
  const d = defaultSettings()
  return { ink: s.ink === 'hand' ? 'hand' : 'serif', focusMin: num(s.focusMin, 1, 120, d.focusMin), breakMin: num(s.breakMin, 1, 60, d.breakMin) }
}

/** Validate one stored page. Strict: throws SchemaError instead of repairing. Used for every save. */
export function normalizeDoc(key: string, value: unknown): unknown {
  const p = parseDocKey(key)
  if (!p) throw new SchemaError(`Unknown page key "${key}".`)
  if (!isObj(value)) throw new SchemaError(`${key}: expected a record.`)
  const c = new Ctx(true)
  const [kind] = p
  if (kind === 'month') return month(c, value, key)
  if (kind === 'week') return week(c, value, key)
  if (kind === 'day') return day(c, value, key)
  return settings(value)
}

export interface NormalizeResult {
  state: State
  issues: string[]
  quarantine: Quarantined[]
}

/**
 * Lenient validation for imports and migration. Never drops user text: values that don't fit are
 * returned in `quarantine`. Throws SchemaError only when the input is not planner data at all,
 * or comes from a newer app version.
 */
export function normalizeState(raw: unknown): NormalizeResult {
  if (isObj(raw) && raw.format === 'duckbook-export' && isObj(raw.state)) raw = raw.state
  if (!isObj(raw)) throw new SchemaError('This is not duckbook data.')
  if (!('days' in raw) && !('weeks' in raw) && !('months' in raw)) throw new SchemaError('No months, weeks, or days found.')
  const version = raw.version ?? 1
  if (typeof version !== 'number' || version > SCHEMA_VERSION) {
    throw new SchemaError(`This was made by a newer version of duckbook (data version ${String(version)}).`)
  }

  const c = new Ctx(false)
  const s = emptyState()
  for (const [k, m] of Object.entries(c.record(raw.months, 'months'))) {
    if (MONTH_KEY.test(k) && isObj(m)) s.months[k] = month(c, m, `months.${k}`)
    else c.park(`months.${k}`, m, 'unrecognized month')
  }
  for (const [k, w] of Object.entries(c.record(raw.weeks, 'weeks'))) {
    if (validDayKey(k) && isObj(w)) s.weeks[k] = week(c, w, `weeks.${k}`)
    else c.park(`weeks.${k}`, w, 'unrecognized week')
  }
  for (const [k, d] of Object.entries(c.record(raw.days, 'days'))) {
    if (validDayKey(k) && isObj(d)) s.days[k] = day(c, d, `days.${k}`)
    else c.park(`days.${k}`, d, 'unrecognized day')
  }
  s.settings = settings(c.record(raw.settings, 'settings'))
  return { state: s, issues: c.issues, quarantine: c.quarantine }
}

export interface Summary { months: number; weeks: number; days: number; first: string | null; last: string | null }

export function summarize(s: State): Summary {
  const dates = [...Object.keys(s.days), ...Object.keys(s.weeks)].sort()
  return {
    months: Object.keys(s.months).length,
    weeks: Object.keys(s.weeks).length,
    days: Object.keys(s.days).length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  }
}
