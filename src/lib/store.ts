import { useSyncExternalStore } from 'react'
import { produce, type Draft } from 'immer'
import { weekStart } from './date'
import { api, ApiError, OfflineError, setLockedHandler } from './api'
import { API_LEVEL, SINGLETONS, validDayKey, docsToState, emptyDay, emptyFocus, emptyMonth, emptySpans, emptyState, emptyWeek, type DayData, type FocusData, type SpansData, type Habit, type IdeaStatus, type MonthData, type State, type WeekData } from './schema'

export * from './schema'

// ───────── tiny observable ─────────

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: T) {
      value = next
      listeners.forEach((l) => l())
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
  }
}

// ───────── session: is the server reachable, is the notebook locked ─────────

export interface Status {
  apiLevel?: number
  pinEnabled: boolean
  autoLockMin: number
  locked: boolean
  retryAfterMs: number
  docCount?: number
  quarantineCount?: number
  dataDir?: string
  migration?: { at: string; sourceHash: string | null; summary: { days: number; weeks: number; months: number } } | null
  lastBackup?: { at: string } | null
  /** Present only in the desktop app. */
  desktop?: { webImport: boolean }
}

export type Phase = 'loading' | 'offline' | 'outdated' | 'locked' | 'unlocked'
export interface Session { phase: Phase; status: Status | null }

const session = observable<Session>({ phase: 'loading', status: null })
export const useSession = () => useSyncExternalStore(session.subscribe, session.get)
export const getSession = () => session.get()
export const onSession = session.subscribe

// ───────── save status ─────────

export type SaveStatus =
  | { kind: 'saved' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; keys: string[] }

const saveStatus = observable<SaveStatus>({ kind: 'saved' })
export const useSaveStatus = () => useSyncExternalStore(saveStatus.subscribe, saveStatus.get)

// ───────── planner state ─────────

let state: State = emptyState()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Server revision per page, and the exact value object last confirmed saved. */
let revs = new Map<string, number>()
/** Settings and the Focus Map exist with defaults even if never saved; defaults count as saved. */
const defaultsSaved = (s: State) => new Map<string, unknown>(SINGLETONS.map((k) => [k, docRef(s, k)]))
let savedRefs = defaultsSaved(state)
/** Edits that could not be sent before a lock; resent (with their original base revision) after unlock. */
let parked: { key: string; baseRev: number; value: unknown }[] = []

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('duckbook') : null

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

const splitKey = (key: string): [string, string] => ((SINGLETONS as readonly string[]).includes(key) ? [key, ''] : (key.split(':') as [string, string]))

function docRef(s: State, key: string): unknown {
  if (key === 'settings') return s.settings
  if (key === 'focus') return s.focus
  if (key === 'spans') return s.spans
  const [kind, id] = key.split(':')
  return kind === 'month' ? s.months[id] : kind === 'week' ? s.weeks[id] : s.days[id]
}

function allKeys(s: State) {
  return [
    ...Object.keys(s.months).map((k) => `month:${k}`),
    ...Object.keys(s.weeks).map((k) => `week:${k}`),
    ...Object.keys(s.days).map((k) => `day:${k}`),
    ...SINGLETONS,
  ]
}

const dirtyKeys = () => allKeys(state).filter((k) => docRef(state, k) !== savedRefs.get(k))

export const isUnlocked = () => session.get().phase === 'unlocked'

export function update(recipe: (draft: Draft<State>) => void) {
  // Never let an edit land on the blank state shown while locked or loading.
  if (!isUnlocked()) return
  state = produce(state, recipe)
  emit()
  scheduleSave()
}

export const getState = () => state

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

type ServerDoc = { key: string; rev: number; value: unknown }

/**
 * Take pages from the server. Pages with unsaved local edits are always kept (they surface as a
 * conflict on save if the server moved on). 'merge' ignores responses older than what this tab
 * already has; 'replace' also drops pages the server no longer has (after an import or restore).
 */
function adoptDocs(docs: ServerDoc[], mode: 'merge' | 'replace') {
  const dirty = new Set(dirtyKeys())
  const fresh = docsToState(docs)
  const take = docs.filter((doc) => !dirty.has(doc.key) && (mode === 'replace' || doc.rev >= (revs.get(doc.key) ?? 0)))
  const serverKeys = new Set(docs.map((d) => d.key))
  const next = produce(state, (d) => {
    if (mode === 'replace') {
      for (const key of allKeys(state)) {
        if (serverKeys.has(key) || dirty.has(key)) continue
        const [kind, id] = splitKey(key)
        if (kind === 'month') delete d.months[id]
        else if (kind === 'week') delete d.weeks[id]
        else if (kind === 'day') delete d.days[id]
        else if (kind === 'focus') d.focus = emptyFocus()
        else if (kind === 'spans') d.spans = emptySpans()
        else d.settings = emptyState().settings
      }
    }
    for (const doc of take) {
      const [kind, id] = splitKey(doc.key)
      if (kind === 'month') d.months[id] = fresh.months[id] as Draft<MonthData>
      else if (kind === 'week') d.weeks[id] = fresh.weeks[id] as Draft<WeekData>
      else if (kind === 'day') d.days[id] = fresh.days[id] as Draft<DayData>
      else if (kind === 'focus') d.focus = fresh.focus as Draft<FocusData>
      else if (kind === 'spans') d.spans = fresh.spans as Draft<SpansData>
      else if (kind === 'settings') d.settings = fresh.settings
    }
  })
  state = next
  if (mode === 'replace') {
    for (const key of [...revs.keys()]) if (!dirty.has(key)) revs.delete(key)
    for (const key of [...savedRefs.keys()]) if (!dirty.has(key)) savedRefs.delete(key)
    for (const k of SINGLETONS) if (!dirty.has(k) && !serverKeys.has(k)) savedRefs.set(k, docRef(state, k))
  }
  for (const doc of take) {
    revs.set(doc.key, doc.rev)
    savedRefs.set(doc.key, docRef(state, doc.key))
  }
  emit()
}

async function loadAll() {
  const { docs } = await api<{ docs: ServerDoc[] }>('GET', '/api/data')
  adoptDocs(docs, 'replace')
}

/** Pull pages changed elsewhere (another tab) without touching unsaved local edits. */
export async function refresh() {
  if (!isUnlocked()) return
  try {
    const { docs } = await api<{ docs: ServerDoc[] }>('GET', '/api/data')
    if (isUnlocked()) adoptDocs(docs, 'merge')
  } catch {
    /* save status already shows connectivity problems */
  }
}

// ───────── saving ─────────

let saveTimer: number | undefined
let inflight: Promise<void> | null = null
let retryMs = 2000

function scheduleSave(delay = 400) {
  window.clearTimeout(saveTimer)
  if (saveStatus.get().kind === 'saved') saveStatus.set({ kind: 'pending' })
  saveTimer = window.setTimeout(() => void flush(), delay)
}

/** Save every unsaved page now. Resolves true only if everything is saved afterwards. */
export async function flush(force = false): Promise<boolean> {
  window.clearTimeout(saveTimer)
  if (!isUnlocked()) return false
  if (inflight) {
    await inflight
    return dirtyKeys().length ? flush(force) : saveStatus.get().kind === 'saved'
  }
  const st = saveStatus.get()
  if (st.kind === 'conflict' && !force) return false
  const keys = dirtyKeys()
  if (!keys.length) {
    if (st.kind !== 'saved') saveStatus.set({ kind: 'saved' })
    return true
  }
  const sent = keys.map((key) => ({ key, baseRev: revs.get(key) ?? 0, value: docRef(state, key) }))
  saveStatus.set({ kind: 'saving' })
  inflight = (async () => {
    try {
      const { revs: next } = await api<{ revs: Record<string, number> }>('PUT', '/api/docs', { changes: sent, force })
      for (const c of sent) {
        // If the tab locked while this was in flight, the parked copy is either this exact edit
        // (now saved) or a newer one whose base is now our own save.
        const p = parked.find((x) => x.key === c.key)
        if (p && p.value === c.value) parked = parked.filter((x) => x !== p)
        else if (p) p.baseRev = next[c.key]
        if (!isUnlocked()) continue
        revs.set(c.key, next[c.key])
        savedRefs.set(c.key, c.value)
      }
      retryMs = 2000
      channel?.postMessage({ type: 'saved', keys: sent.map((c) => c.key) })
      saveStatus.set(dirtyKeys().length ? { kind: 'saving' } : { kind: 'saved' })
      if (dirtyKeys().length) scheduleSave(50)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body.outdated) {
        // The server is a different version now; nothing more is sent until that is sorted out.
        void reloadStatus().catch(() => {})
      } else if (e instanceof ApiError && e.status === 409) {
        const conflicts = (e.body.conflicts as { key: string }[] | undefined) ?? []
        saveStatus.set({ kind: 'conflict', keys: conflicts.map((c) => c.key) })
      } else if (e instanceof ApiError && e.status === 401) {
        // Locked underneath us: goLocked() already parked these edits to resend after unlock.
      } else {
        const message = e instanceof OfflineError ? 'Not saved: the duckbook server isn’t responding. Retrying…' : `Not saved: ${(e as Error).message}`
        saveStatus.set({ kind: 'error', message })
        scheduleSave(retryMs)
        retryMs = Math.min(30_000, retryMs * 2)
      }
    } finally {
      inflight = null
    }
  })()
  await inflight
  return !dirtyKeys().length && saveStatus.get().kind === 'saved'
}

/**
 * Resolve a conflict. One edit can touch several pages (a moved task: the idea and two weeks), so
 * both choices act on the whole batch: "theirs" drops every unsaved edit in this tab and reloads;
 * "mine" saves all of this tab's pages over what is stored.
 */
export async function resolveConflict(choice: 'theirs' | 'mine') {
  if (choice === 'mine') {
    await flush(true)
    return
  }
  const { docs } = await api<{ docs: ServerDoc[] }>('GET', '/api/data')
  state = emptyState()
  revs = new Map()
  savedRefs = defaultsSaved(state)
  saveStatus.set({ kind: 'saved' })
  adoptDocs(docs, 'replace')
}

window.addEventListener('beforeunload', (e) => {
  const unsaved = (isUnlocked() && (dirtyKeys().length > 0 || inflight !== null)) || parked.length > 0
  if (!unsaved) return
  if (isUnlocked()) void flush()
  e.preventDefault()
})

// The desktop app calls this before closing its window: true when nothing is left unsaved.
Object.assign(window, { duckbookFlush: async () => (await flush()) && parked.length === 0 })

/** Pages edited before a lock that still need saving after unlock. */
export const parkedCount = () => parked.length

// ───────── lock / unlock / boot ─────────

function clearPrivate() {
  window.clearTimeout(saveTimer)
  state = emptyState()
  revs = new Map()
  savedRefs = defaultsSaved(state)
  emit()
}

function goLocked(status: Status | null) {
  const pending = isUnlocked() ? dirtyKeys().map((key) => ({ key, baseRev: revs.get(key) ?? 0, value: docRef(state, key) })) : []
  if (pending.length) parked = [...parked.filter((p) => !pending.some((q) => q.key === p.key)), ...pending]
  clearPrivate()
  session.set({ phase: 'locked', status: status ?? (session.get().status ? { ...session.get().status!, locked: true } : null) })
  document.title = 'duckbook'
}

setLockedHandler(() => {
  if (session.get().phase === 'unlocked') goLocked(null)
})

export async function fetchStatus() {
  return api<Status>('GET', '/api/status')
}

async function enter(status: Status) {
  if (status.apiLevel !== API_LEVEL) return session.set({ phase: 'outdated', status })
  await loadAll()
  session.set({ phase: 'unlocked', status })
  saveStatus.set({ kind: 'saved' })
  if (parked.length) {
    const toApply = parked
    parked = []
    // Re-apply the edits on top of what's saved, keeping their original base revisions so a page
    // changed elsewhere in the meantime surfaces as a conflict instead of being overwritten.
    state = produce(state, (d) => {
      for (const p of toApply) {
        const [kind, id] = splitKey(p.key)
        if (kind === 'month') d.months[id] = p.value as Draft<MonthData>
        else if (kind === 'week') d.weeks[id] = p.value as Draft<WeekData>
        else if (kind === 'day') d.days[id] = p.value as Draft<DayData>
        else if (kind === 'focus') d.focus = p.value as Draft<FocusData>
        else if (kind === 'spans') d.spans = p.value as Draft<SpansData>
        else d.settings = p.value as State['settings']
      }
    })
    for (const p of toApply) revs.set(p.key, p.baseRev)
    emit()
    void flush()
  }
  applyPendingCredits()
}

export async function boot() {
  try {
    const status = await fetchStatus()
    // A server started before an update would reject or drop newer fields: don't edit through it.
    if (status.apiLevel !== API_LEVEL) session.set({ phase: 'outdated', status })
    else if (status.locked) session.set({ phase: 'locked', status })
    else await enter(status)
  } catch (e) {
    session.set({ phase: 'offline', status: null })
    console.warn('duckbook: server unavailable', (e as Error).message)
  }
}

export async function unlock(pin: string): Promise<{ ok: true } | { ok: false; error: string; retryAfterMs: number }> {
  try {
    await api('POST', '/api/unlock', { pin })
    await enter(await fetchStatus())
    channel?.postMessage({ type: 'unlocked' })
    return { ok: true }
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.status === 429 ? 'Too many tries.' : 'Wrong PIN.', retryAfterMs: Number(e.body.retryAfterMs ?? 0) }
    return { ok: false, error: (e as Error).message, retryAfterMs: 0 }
  }
}

export async function lock() {
  if (!isUnlocked()) return
  try {
    await Promise.race([flush(), new Promise((r) => setTimeout(r, 3000))])
  } catch {
    /* parked below */
  }
  goLocked(null)
  try {
    await api('POST', '/api/lock')
  } catch {
    /* the server forgets sessions on restart anyway */
  }
  channel?.postMessage({ type: 'locked' })
}

/** Refresh status (PIN on/off, backups, migration) without touching pages. */
export async function reloadStatus() {
  const status = await fetchStatus()
  if (status.apiLevel !== API_LEVEL) {
    goLocked(status)
    session.set({ phase: 'outdated', status })
  } else if (status.locked) goLocked(status)
  else session.set({ ...session.get(), status })
  return status
}

/** After an import or restore replaced every page on the server. */
export async function reloadAll() {
  await loadAll()
  await reloadStatus()
  channel?.postMessage({ type: 'replaced' })
}

channel?.addEventListener('message', (e: MessageEvent) => {
  const t = e.data?.type
  if (t === 'locked' && isUnlocked()) goLocked(null)
  else if (t === 'unlocked' && session.get().phase === 'locked') void boot()
  else if (t === 'replaced' && isUnlocked()) void loadAll().catch(() => {})
  else if (t === 'saved') void refresh()
})

window.addEventListener('focus', () => void refresh())

// ───────── pomodoro credit, safe while locked ─────────

let pendingCredits: { dayKey: string; taskId: string }[] = []

export function creditPomodoro(dayKey: string, taskId: string) {
  if (!isUnlocked()) {
    pendingCredits.push({ dayKey, taskId })
    return
  }
  update((s) => {
    const t = s.days[dayKey]?.tasks.find((x) => x.id === taskId)
    if (t) t.pomos = Math.min(10, t.pomos + 1)
  })
}

function applyPendingCredits() {
  const list = pendingCredits
  pendingCredits = []
  list.forEach((c) => creditPomodoro(c.dayKey, c.taskId))
}

// ───────── read helpers and edits used by the views ─────────

const EMPTY_MONTH = emptyMonth()
const EMPTY_WEEK = emptyWeek()
const EMPTY_DAY = emptyDay()

export const useMonth = (monthKey: string) => useStore((s) => s.months[monthKey] ?? EMPTY_MONTH)
export const useDay = (dayKey: string) => useStore((s) => s.days[dayKey] ?? EMPTY_DAY)
export const useSettings = () => useStore((s) => s.settings)
export const useFocus = () => useStore((s) => s.focus)
export const editFocus = (fn: (f: Draft<FocusData>) => void) => update((s) => fn(s.focus))
export const useSpans = () => useStore((s) => s.spans.spans)
export const editSpans = (fn: (f: Draft<SpansData>) => void) => update((s) => fn(s.spans))

/** Habits carry over: a new week starts with the habit names of the latest earlier week. */
function carriedHabits(weeks: Record<string, WeekData>, mondayKey: string): Habit[] {
  const prev = Object.keys(weeks)
    .filter((k) => k < mondayKey && weeks[k].habits.length)
    .sort()
    .pop()
  return prev ? weeks[prev].habits.map((h) => ({ id: uid(), name: h.name, days: Array(7).fill(false) })) : []
}

export const editMonth = (monthKey: string, fn: (m: Draft<MonthData>) => void) =>
  update((s) => fn((s.months[monthKey] ??= emptyMonth())))

export const editWeek = (anyDayKey: string, fn: (w: Draft<WeekData>) => void) => {
  const monday = weekStart(anyDayKey)
  update((s) => fn((s.weeks[monday] ??= { ...emptyWeek(), habits: carriedHabits(s.weeks, monday) })))
}

export const editDay = (dayKey: string, fn: (d: Draft<DayData>) => void) =>
  update((s) => fn((s.days[dayKey] ??= emptyDay())))

/** Week as it will look once touched, including carried-over habits. */
export function useWeekWithSeed(mondayKey: string): WeekData {
  return useStore((s) => s.weeks[mondayKey] ?? seeded(s.weeks, mondayKey))
}

const seedCache = new Map<string, { src: Record<string, WeekData>; week: WeekData }>()
function seeded(weeks: Record<string, WeekData>, mondayKey: string): WeekData {
  const hit = seedCache.get(mondayKey)
  if (hit && hit.src === weeks) return hit.week
  const habits = carriedHabits(weeks, mondayKey)
  const week = habits.length ? { ...EMPTY_WEEK, habits } : EMPTY_WEEK
  seedCache.set(mondayKey, { src: weeks, week })
  return week
}

/** Complete/uncomplete a week task and keep linked day tasks in sync (and vice versa). */
// ───────── one work item: idea ↔ week task(s) ↔ day task(s) ─────────
//
// A planned Focus Map idea is one piece of work. The idea holds the truth (title, state, planned
// date); week tasks link to it with `ideaId`, day tasks link to a week task with `weekTaskId`.
// Every edit goes through applyWork() so all copies change in the same save.

export type WorkPatch = Partial<{ text: string; status: IdeaStatus; date: string | null }>

type S = Draft<State>

function linkedWeekTasks(s: State | S, ideaId: string) {
  const out: { monday: string; task: WeekData['tasks'][number] }[] = []
  for (const monday of Object.keys(s.weeks).sort()) for (const task of s.weeks[monday].tasks) if (task.ideaId === ideaId) out.push({ monday, task })
  return out
}

function findWeekTask(s: State | S, taskId: string) {
  for (const monday of Object.keys(s.weeks)) {
    const task = s.weeks[monday].tasks.find((t) => t.id === taskId)
    if (task) return { monday, task }
  }
  return null
}

/** The idea behind a week task, if it came from the Focus Map and the idea still exists. */
export const ideaOfWeekTask = (s: State, task: { ideaId?: string }) => (task.ideaId ? s.focus.ideas.find((i) => i.id === task.ideaId) : undefined)

/** The idea behind a day task (through the week task it was pulled from). */
export function ideaOfDayTask(s: State, task: { weekTaskId?: string }) {
  if (!task.weekTaskId) return undefined
  const wt = findWeekTask(s, task.weekTaskId)
  return wt ? ideaOfWeekTask(s, wt.task) : undefined
}

export const plannedWeeks = (s: State, ideaId: string) => [...new Set(linkedWeekTasks(s, ideaId).map((l) => l.monday))]

function ensureWeek(s: S, monday: string) {
  return (s.weeks[monday] ??= { ...emptyWeek(), habits: carriedHabits(s.weeks, monday) })
}

function moveWeekTask(s: S, from: string, to: string, taskId: string) {
  const src = s.weeks[from]
  const i = src?.tasks.findIndex((t) => t.id === taskId) ?? -1
  if (i < 0) return
  const [task] = src.tasks.splice(i, 1)
  ensureWeek(s, to).tasks.push(task)
}

function applyWork(s: S, ideaId: string, patch: WorkPatch) {
  const idea = s.focus.ideas.find((i) => i.id === ideaId)
  if (!idea) return
  if (patch.date && !validDayKey(patch.date)) return
  if (patch.text !== undefined) idea.text = patch.text
  if (patch.status !== undefined) idea.status = patch.status
  if (patch.date !== undefined) idea.date = patch.date
  const linked = linkedWeekTasks(s, ideaId)
  const done = idea.status === 'done'
  // Titles are only rewritten when the title is what changed, so older copies renamed on their
  // own keep their wording until the work item itself is renamed.
  // An emptied title is a moment in typing (or a row about to be deleted), not a new name for the work.
  const retitle = patch.text !== undefined && patch.text.trim() !== ''
  const restate = patch.status !== undefined
  for (const { task } of linked) {
    if (retitle) task.text = idea.text
    if (restate) task.done = done
  }
  const ids = new Set(linked.map((l) => l.task.id))
  for (const d of Object.values(s.days))
    for (const t of d.tasks)
      if (t.weekTaskId && ids.has(t.weekTaskId)) {
        if (retitle) t.text = idea.text
        if (restate) t.done = done
      }
  // A new planned date carries the planned week task along to that week.
  if (patch.date && linked.length) {
    const target = weekStart(patch.date)
    const latest = linked[linked.length - 1]
    if (!linked.some((l) => l.monday === target)) moveWeekTask(s, latest.monday, target, latest.task.id)
  }
}

export const editWork = (ideaId: string, patch: WorkPatch) => update((s) => applyWork(s, ideaId, patch))

/**
 * Put an idea into a week's plan. Never creates a second task: if it is already planned elsewhere
 * its latest task moves here instead. Lands unsorted, ready for the matrix.
 */
export function planIdea(ideaId: string, monday: string) {
  update((s) => {
    const idea = s.focus.ideas.find((i) => i.id === ideaId)
    if (!idea || !idea.text.trim()) return
    const linked = linkedWeekTasks(s, ideaId)
    if (linked.some((l) => l.monday === monday)) return
    if (linked.length) moveWeekTask(s, linked[linked.length - 1].monday, monday, linked[linked.length - 1].task.id)
    else ensureWeek(s, monday).tasks.push({ id: uid(), text: idea.text.trim(), q: null, done: idea.status === 'done', ideaId })
  })
}

/** Complete/uncomplete a week task and keep linked day tasks (and its idea) in sync. */
export function setWeekTaskDone(mondayKey: string, taskId: string, done: boolean) {
  update((s) => {
    const t = s.weeks[mondayKey]?.tasks.find((x) => x.id === taskId)
    if (!t) return
    if (ideaOfWeekTask(s as State, t)) return applyWork(s, t.ideaId!, { status: done ? 'done' : 'doing' })
    t.done = done
    for (const d of Object.values(s.days))
      d.tasks.forEach((dt) => {
        if (dt.weekTaskId === taskId) dt.done = done
      })
  })
}

export function setDayTaskDone(dayKey: string, taskId: string, done: boolean) {
  update((s) => {
    const dt = s.days[dayKey]?.tasks.find((x) => x.id === taskId)
    if (!dt) return
    const idea = ideaOfDayTask(s as State, dt)
    if (idea) return applyWork(s, idea.id, { status: done ? 'done' : 'doing' })
    dt.done = done
    if (dt.weekTaskId) {
      const wt = findWeekTask(s, dt.weekTaskId)
      if (wt) wt.task.done = done
    }
  })
}

/** Rename a week or day task; a linked one renames the whole work item. */
export function renameWeekTask(mondayKey: string, taskId: string, text: string) {
  update((s) => {
    const t = s.weeks[mondayKey]?.tasks.find((x) => x.id === taskId)
    if (!t) return
    t.text = text
    if (text.trim() && ideaOfWeekTask(s as State, t)) applyWork(s, t.ideaId!, { text })
  })
}

export function renameDayTask(dayKey: string, taskId: string, text: string) {
  update((s) => {
    const dt = s.days[dayKey]?.tasks.find((x) => x.id === taskId)
    if (!dt) return
    dt.text = text
    const idea = text.trim() ? ideaOfDayTask(s as State, dt) : undefined
    if (idea) applyWork(s, idea.id, { text })
  })
}

/** Starting focus time on a linked task means the idea is in progress. */
export function markStarted(dayKey: string, taskId: string) {
  const dt = state.days[dayKey]?.tasks.find((x) => x.id === taskId)
  const idea = dt && ideaOfDayTask(state, dt)
  if (idea && idea.status === 'idea') editWork(idea.id, { status: 'doing' })
}
