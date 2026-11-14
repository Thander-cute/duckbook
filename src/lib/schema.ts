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
  /** A day's own word size, where it differs from settings.monthSize. Absent when there are none. */
  sizes?: Record<string, number>
}

/** `ideaId` links a task back to the Focus Map idea it came from. */
export interface WeekTask { id: string; text: string; q: Quadrant | null; done: boolean; ideaId?: string }
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

/**
 * A kept photo: sha256 names of its full-size and thumbnail JPEG files, and the full size in pixels.
 * `title` is written on the white strip under the polaroid; `description` is a caption shown under
 * the photo in the viewer. Both are absent when empty, so photos without them are stored as before.
 */
export interface DayPhoto { full: string; thumb: string; w: number; h: number; title?: string; description?: string }
export const MAX_DAY_PHOTOS = 3
export const MAX_PHOTO_TITLE = 30
export const MAX_PHOTO_DESCRIPTION = 280
/** A caption may be written on at most four lines; later lines are folded into the fourth. */
export const MAX_PHOTO_LINES = 4
export const PHOTO_ID = /^[0-9a-f]{64}$/

/** A title is one line: whitespace runs become one space, the ends are trimmed, then it is cut. */
export const photoTitle = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_PHOTO_TITLE)

/** Normalise line endings and fold anything past the fourth line into it, joined with a space. */
export const foldPhotoLines = (text: string) => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length <= MAX_PHOTO_LINES) return lines.join('\n')
  const tail = lines
    .slice(MAX_PHOTO_LINES - 1)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
  return [...lines.slice(0, MAX_PHOTO_LINES - 1), tail].join('\n')
}

/** A description keeps its lines (up to four); only the ends are trimmed, then it is cut. */
export const photoDescription = (text: string) => foldPhotoLines(text.trim()).slice(0, MAX_PHOTO_DESCRIPTION)

export interface DayData {
  grateful: string
  tasks: DayTask[]
  notes: string
  sentence: string
  /** Absent when there are none, so days without photos are stored exactly as before. */
  photos?: DayPhoto[]
}

export interface Settings {
  ink: 'serif' | 'hand'
  focusMin: number
  breakMin: number
  /** Optional modules. Turning one off hides it; its data is kept. */
  modules: { focusMap: boolean; contacts: boolean; holidays: boolean; disc: boolean }
  /** The word size Month day cells start at, before they shrink to fit. */
  monthSize: number
  /** Copy the plan from the last week that has one when a new week begins. */
  autoCopyWeek: boolean
  /** Monday of the latest week the automatic copy is finished with, so it runs once per week on any device. */
  autoCopiedWeek: string | null
}

export type IdeaStatus = 'idea' | 'doing' | 'done'

/**
 * Focus Map idea, and the single source of truth for its work item once planned.
 * x: 0 = hard (left) … 1 = easy (right); y: 0 = low impact (bottom) … 1 = high (top). null = in the tray.
 * `date` is an optional planned day (YYYY-MM-DD).
 */
export interface Idea { id: string; text: string; x: number | null; y: number | null; status: IdeaStatus; date: string | null; createdAt: string }
export interface FocusData { ideas: Idea[] }

/**
 * A note for a stretch of days, drawn as a line across the month calendar. It may cross months.
 * `at` is the day (within start…end) where its words sit on the line.
 */
export interface Span { id: string; start: string; end: string; text: string; at: string }
export interface SpansData { spans: Span[] }

export type Gender = 'female' | 'male' | 'other' | ''

export type DiscType = 'D' | 'I' | 'S' | 'C'
export type DiscMix = Partial<Record<DiscType, number>>

/**
 * A person in the Contacts add-on. A birthday may be partial: day and month without a year, or none.
 * `disc` holds the share of each DISC type picked for them; the largest is their main one. Shares add
 * to 100 when written here, but edits merged from two devices may not, so they are read as proportions.
 */
export interface Contact { id: string; name: string; gender: Gender; day: number | null; month: number | null; year: number | null; disc: DiscMix; notes: string }
export interface ContactsData { people: Contact[] }

/** A day to remember every year (an anniversary, a family day). */
export interface Occasion { id: string; name: string; day: number; month: number }
export interface OccasionsData { days: Occasion[] }

export interface State {
  version: 1
  months: Record<string, MonthData>
  weeks: Record<string, WeekData>
  days: Record<string, DayData>
  focus: FocusData
  spans: SpansData
  contacts: ContactsData
  occasions: OccasionsData
  settings: Settings
}

export const SCHEMA_VERSION = 1

/**
 * What the browser and server must agree on. Bump whenever a page shape or key changes, so a
 * browser with new code refuses to save through a server still running old code (which would
 * reject or silently drop new fields). 2 = Focus Map page, settings.modules, WeekTask.ideaId.
 * 3 = idea status and planned date. 4 = spans page (notes for a range of days). 5 = day photos.
 * 6 = a save of a page that moved on is merged and returned (`merged`), which the page must show.
 * 7 = contacts and occasions pages, settings.modules.contacts, .holidays and .disc, settings.monthSize, MonthData.sizes.
 * 9 = settings.autoCopyWeek and .autoCopiedWeek, day photo title and description. 8 is skipped: another
 * branch's build uses it, and equal levels would pass the handshake while that server dropped these fields.
 * 9 is not released (0.1.1 is 7), so the photo fields join it rather than taking a new level.
 */
export const API_LEVEL = 9

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

export const MONTH_SIZE = 15
export const MONTH_SIZE_MIN = 11
export const MONTH_SIZE_MAX = 28

export const defaultSettings = (): Settings => ({ ink: 'serif', focusMin: 25, breakMin: 5, modules: { focusMap: false, contacts: false, holidays: false, disc: false }, monthSize: MONTH_SIZE, autoCopyWeek: false, autoCopiedWeek: null })

export const emptyFocus = (): FocusData => ({ ideas: [] })

export const emptySpans = (): SpansData => ({ spans: [] })

export const emptyContacts = (): ContactsData => ({ people: [] })

export const emptyOccasions = (): OccasionsData => ({ days: [] })

export const emptyState = (): State => ({ version: 1, months: {}, weeks: {}, days: {}, focus: emptyFocus(), spans: emptySpans(), contacts: emptyContacts(), occasions: emptyOccasions(), settings: defaultSettings() })

// ───────── documents: how State is stored, one row per page ─────────

export type DocKind = 'month' | 'week' | 'day' | 'settings' | 'focus' | 'spans' | 'contacts' | 'occasions'

/** Pages that always exist in State with a default value, whether or not they were ever saved. */
export const SINGLETONS = ['settings', 'focus', 'spans', 'contacts', 'occasions'] as const
export interface Doc { key: string; value: unknown }

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/

export const validDayKey = (k: string) => {
  if (!DAY_KEY.test(k)) return false
  const [y, m, d] = k.split('-').map(Number)
  // Half-typed dates from a date field (0002-10-22, 0202-…) are not real planner days.
  if (y < 1900 || y > 2999) return false
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** "month:2026-10" → ['month', '2026-10']; null if the key is not a valid document key. */
export function parseDocKey(key: string): [DocKind, string] | null {
  if ((SINGLETONS as readonly string[]).includes(key)) return [key as DocKind, '']
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
    // Only written once used, so older backups and exports stay identical.
    ...(s.focus.ideas.length ? [{ key: 'focus', value: s.focus }] : []),
    ...(s.spans.spans.length ? [{ key: 'spans', value: s.spans }] : []),
    ...(s.contacts.people.length ? [{ key: 'contacts', value: s.contacts }] : []),
    ...(s.occasions.days.length ? [{ key: 'occasions', value: s.occasions }] : []),
  ]
}

/**
 * Ideas from before states existed carry no `status`: read it as Completed when every planned copy
 * is done, otherwise Idea. Derived on read, never written back on its own.
 */
export function withIdeaStatus(s: State): State {
  dedupeWeekTasks(s)
  if (!s.focus.ideas.some((i) => !i.status)) return s
  const tasks = Object.values(s.weeks).flatMap((w) => w.tasks)
  s.focus = {
    ...s.focus,
    ideas: s.focus.ideas.map((i) => {
      if (i.status) return i
      const linked = tasks.filter((t) => t.ideaId === i.id)
      return { ...i, status: linked.length && linked.every((t) => t.done) ? 'done' : 'idea', date: i.date ?? null }
    }),
  }
  return s
}

/**
 * A task id should live in one week. If an interrupted move ever left it in two, show it once:
 * in the week of its idea's planned date if that is one of them, otherwise the latest week.
 */
function dedupeWeekTasks(s: State) {
  const where = new Map<string, string[]>()
  for (const [monday, w] of Object.entries(s.weeks)) for (const t of w.tasks) where.set(t.id, [...(where.get(t.id) ?? []), monday])
  for (const [id, mondays] of where) {
    if (mondays.length < 2) continue
    const task = s.weeks[mondays[0]].tasks.find((t) => t.id === id)!
    const date = task.ideaId ? s.focus.ideas.find((i) => i.id === task.ideaId)?.date : null
    const preferred = date ? mondays.find((m) => m === weekMonday(date)) : undefined
    const keep = preferred ?? [...mondays].sort().pop()!
    for (const m of mondays) if (m !== keep) s.weeks[m] = { ...s.weeks[m], tasks: s.weeks[m].tasks.filter((t) => t.id !== id) }
  }
}

const weekMonday = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7))
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
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
    else if (kind === 'focus') s.focus = value as FocusData
    else if (kind === 'spans') s.spans = value as SpansData
    else if (kind === 'contacts') s.contacts = value as ContactsData
    else if (kind === 'occasions') s.occasions = value as OccasionsData
    // Settings saved by older versions lack newer fields; fill them with defaults.
    else s.settings = settings(isObj(value) ? value : {})
  }
  return withIdeaStatus(s)
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
  const sizes: Record<string, number> = {}
  for (const [d, v] of Object.entries(c.record(m.sizes, `${p}.sizes`))) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= MONTH_SIZE_MIN && v <= MONTH_SIZE_MAX) sizes[d] = v
    else c.park(`${p}.sizes.${d}`, v, 'size out of range')
  }
  return { theme: c.str(m.theme, `${p}.theme`), goals, cells, moods, notes: c.str(m.notes, `${p}.notes`), ...(Object.keys(sizes).length ? { sizes } : {}) }
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
      const task: WeekTask = { id: id(t.id, `${p}.tasks.${i}`), text: c.str(t.text, `${p}.tasks.${i}.text`), q, done: bool(t.done) }
      if (typeof t.ideaId === 'string' && t.ideaId) task.ideaId = t.ideaId
      return [task]
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
    ...dayPhotos(c, d.photos, `${p}.photos`),
  }
}

function dayPhotos(c: Ctx, v: unknown, p: string): { photos?: DayPhoto[] } {
  const photos: DayPhoto[] = []
  c.list(v, p).forEach((ph, i) => {
    if (!isObj(ph) || typeof ph.full !== 'string' || typeof ph.thumb !== 'string' || !PHOTO_ID.test(ph.full) || !PHOTO_ID.test(ph.thumb)) {
      c.park(`${p}.${i}`, ph, 'not a photo reference')
    } else if (photos.length >= MAX_DAY_PHOTOS) {
      c.park(`${p}.${i}`, ph, `more than ${MAX_DAY_PHOTOS} photos`)
    } else {
      const photo: DayPhoto = { full: ph.full, thumb: ph.thumb, w: num(ph.w, 1, 100_000, 1), h: num(ph.h, 1, 100_000, 1) }
      // A title or description that is only space is empty, and empty fields are not stored.
      const title = photoTitle(c.str(ph.title, `${p}.${i}.title`))
      const description = photoDescription(c.str(ph.description, `${p}.${i}.description`))
      if (title) photo.title = title
      if (description) photo.description = description
      photos.push(photo)
    }
  })
  return photos.length ? { photos } : {}
}

/** Every photo file a set of pages refers to (for cleaning up files nothing needs any more). */
export function photoRefs(docs: Doc[]): Set<string> {
  const out = new Set<string>()
  for (const d of docs) {
    if (!d.key.startsWith('day:') || !isObj(d.value) || !Array.isArray(d.value.photos)) continue
    for (const ph of d.value.photos) if (isObj(ph)) for (const k of ['full', 'thumb']) if (typeof ph[k] === 'string') out.add(ph[k] as string)
  }
  return out
}

function settings(s: Record<string, unknown>): Settings {
  const d = defaultSettings()
  const m = isObj(s.modules) ? s.modules : {}
  return {
    ink: s.ink === 'hand' ? 'hand' : 'serif',
    focusMin: num(s.focusMin, 1, 120, d.focusMin),
    breakMin: num(s.breakMin, 1, 60, d.breakMin),
    modules: { focusMap: bool(m.focusMap), contacts: bool(m.contacts), holidays: bool(m.holidays), disc: bool(m.disc) },
    monthSize: num(s.monthSize, MONTH_SIZE_MIN, MONTH_SIZE_MAX, d.monthSize),
    autoCopyWeek: bool(s.autoCopyWeek),
    autoCopiedWeek: typeof s.autoCopiedWeek === 'string' && validDayKey(s.autoCopiedWeek) ? s.autoCopiedWeek : null,
  }
}

/** A missing status stays missing (derived on read); a wrong one is refused on save, set aside on import. */
function ideaStatus(c: Ctx, v: unknown, path: string): { status?: IdeaStatus } {
  if (v === undefined || v === null) return {}
  if (v === 'idea' || v === 'doing' || v === 'done') return { status: v }
  c.park(path, v, 'unknown state')
  return {}
}

function ideaDate(c: Ctx, v: unknown, path: string): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'string' && validDayKey(v)) return v
  c.park(path, v, 'not a valid date')
  return null
}

const coord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000 : null)

function focus(c: Ctx, f: Record<string, unknown>, p: string): FocusData {
  return {
    ideas: c.list(f.ideas, `${p}.ideas`).flatMap((it, i) => {
      if (!isObj(it)) {
        c.park(`${p}.ideas.${i}`, it, 'unrecognized idea')
        return []
      }
      const x = coord(it.x)
      const y = coord(it.y)
      const placed = x !== null && y !== null
      return [
        {
          id: id(it.id, `${p}.ideas.${i}`),
          text: c.str(it.text, `${p}.ideas.${i}.text`),
          x: placed ? x : null,
          y: placed ? y : null,
          // Ideas saved before states existed have none; it is derived from their tasks when read
          // (see withIdeaStatus), so validation must not invent one here.
          ...ideaStatus(c, it.status, `${p}.ideas.${i}.status`),
          date: ideaDate(c, it.date, `${p}.ideas.${i}.date`),
          createdAt: typeof it.createdAt === 'string' ? it.createdAt : '',
        } as Idea,
      ]
    }),
  }
}

function spans(c: Ctx, f: Record<string, unknown>, p: string): SpansData {
  return {
    spans: c.list(f.spans, `${p}.spans`).flatMap((it, i) => {
      const q = `${p}.spans.${i}`
      if (!isObj(it) || typeof it.start !== 'string' || typeof it.end !== 'string' || !validDayKey(it.start) || !validDayKey(it.end) || it.start > it.end) {
        c.park(q, it, 'not a range of days')
        return []
      }
      const at = typeof it.at === 'string' && it.at >= it.start && it.at <= it.end ? it.at : null
      if (at === null && it.at !== undefined) c.park(`${q}.at`, it.at, 'outside its range')
      return [{ id: id(it.id, q), start: it.start, end: it.end, text: c.str(it.text, `${q}.text`), at: at ?? it.start }]
    }),
  }
}

const GENDERS: Gender[] = ['female', 'male', 'other', '']

/** A day of a month, or null. Checked against a leap year, so 29 Feb is a real birthday. */
function dayOfMonth(day: unknown, month: unknown): [number, number] | null {
  if (!Number.isInteger(day) || !Number.isInteger(month)) return null
  const d = day as number
  const m = month as number
  if (m < 1 || m > 12 || d < 1) return null
  return d <= new Date(2000, m, 0).getDate() ? [d, m] : null
}

const absent = (v: unknown) => v === null || v === undefined

function contacts(c: Ctx, f: Record<string, unknown>, p: string): ContactsData {
  return {
    people: c.list(f.people, `${p}.people`).flatMap((it, i) => {
      const q = `${p}.people.${i}`
      if (!isObj(it)) {
        c.park(q, it, 'unrecognized person')
        return []
      }
      const gender = GENDERS.includes(it.gender as Gender) ? (it.gender as Gender) : ''
      if (gender !== it.gender && !absent(it.gender)) c.park(`${q}.gender`, it.gender, 'unknown gender')
      const none = absent(it.day) && absent(it.month)
      const dm = none ? null : dayOfMonth(it.day, it.month)
      if (!none && !dm) c.park(`${q}.day`, { day: it.day, month: it.month }, 'not a day of the year')
      const yearOk = dm && Number.isInteger(it.year) && (it.year as number) >= 1800 && (it.year as number) <= 2999
      if (!yearOk && !absent(it.year)) c.park(`${q}.year`, it.year, 'not a birth year')
      const disc: DiscMix = {}
      for (const [k, v] of Object.entries(c.record(it.disc, `${q}.disc`))) {
        if ((k === 'D' || k === 'I' || k === 'S' || k === 'C') && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100) disc[k] = v as number
        else c.park(`${q}.disc.${k}`, v, 'not a DISC share')
      }
      return [
        {
          id: id(it.id, q),
          name: c.str(it.name, `${q}.name`),
          gender,
          day: dm ? dm[0] : null,
          month: dm ? dm[1] : null,
          year: yearOk ? (it.year as number) : null,
          disc,
          notes: c.str(it.notes, `${q}.notes`),
        },
      ]
    }),
  }
}

function occasions(c: Ctx, f: Record<string, unknown>, p: string): OccasionsData {
  return {
    days: c.list(f.days, `${p}.days`).flatMap((it, i) => {
      const q = `${p}.days.${i}`
      const dm = isObj(it) ? dayOfMonth(it.day, it.month) : null
      if (!isObj(it) || !dm) {
        c.park(q, it, 'not a day of the year')
        return []
      }
      return [{ id: id(it.id, q), name: c.str(it.name, `${q}.name`), day: dm[0], month: dm[1] }]
    }),
  }
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
  if (kind === 'focus') return focus(c, value, key)
  if (kind === 'spans') return spans(c, value, key)
  if (kind === 'contacts') return contacts(c, value, key)
  if (kind === 'occasions') return occasions(c, value, key)
  return settings(value)
}

/** Validate one page leniently: values that don't fit are returned in `quarantine` instead of failing. */
export function repairDoc(key: string, value: unknown): { value: unknown; quarantine: Quarantined[] } {
  const p = parseDocKey(key)
  if (!p) throw new SchemaError(`Unknown page key "${key}".`)
  const c = new Ctx(false)
  const v = isObj(value) ? value : {}
  const [kind] = p
  const out =
    kind === 'month' ? month(c, v, key)
    : kind === 'week' ? week(c, v, key)
    : kind === 'day' ? day(c, v, key)
    : kind === 'focus' ? focus(c, v, key)
    : kind === 'spans' ? spans(c, v, key)
    : kind === 'contacts' ? contacts(c, v, key)
    : kind === 'occasions' ? occasions(c, v, key)
    : settings(v)
  return { value: out, quarantine: c.quarantine }
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
  s.focus = focus(c, c.record(raw.focus, 'focus'), 'focus')
  s.spans = spans(c, c.record(raw.spans, 'spans'), 'spans')
  s.contacts = contacts(c, c.record(raw.contacts, 'contacts'), 'contacts')
  s.occasions = occasions(c, c.record(raw.occasions, 'occasions'), 'occasions')
  // Imported state is written as-is, so keep stored ideas without a status as they were.
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
