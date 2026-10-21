import { useSyncExternalStore } from 'react'
import { produce, type Draft } from 'immer'
import { weekStart } from './date'
import { api, ApiError, OfflineError, setLockedHandler } from './api'
import { docsToState, emptyDay, emptyMonth, emptyState, emptyWeek, type DayData, type Habit, type MonthData, type State, type WeekData } from './schema'

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
  pinEnabled: boolean
  autoLockMin: number
  locked: boolean
  retryAfterMs: number
  docCount?: number
  dataDir?: string
  migration?: { at: string; sourceHash: string | null; summary: { days: number; weeks: number; months: number } } | null
  lastBackup?: { at: string } | null
}

export type Phase = 'loading' | 'offline' | 'locked' | 'unlocked'
export interface Session { phase: Phase; status: Status | null }

const session = observable<Session>({ phase: 'loading', status: null })
export const useSession = () => useSyncExternalStore(session.subscribe, session.get)
export const getSession = () => session.get()

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
let savedRefs = new Map<string, unknown>()
/** Edits that could not be sent before a lock; resent (with their original base revision) after unlock. */
let parked: { key: string; baseRev: number; value: unknown }[] = []

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('duckbook') : null

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

function docRef(s: State, key: string): unknown {
  if (key === 'settings') return s.settings
  const [kind, id] = key.split(':')
  return kind === 'month' ? s.months[id] : kind === 'week' ? s.weeks[id] : s.days[id]
}

function allKeys(s: State) {
  return [
    ...Object.keys(s.months).map((k) => `month:${k}`),
    ...Object.keys(s.weeks).map((k) => `week:${k}`),
    ...Object.keys(s.days).map((k) => `day:${k}`),
    'settings',
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

function adoptDocs(docs: { key: string; rev: number; value: unknown }[], onlyClean: boolean) {
  const dirty = new Set(onlyClean ? dirtyKeys() : [])
  const fresh = docsToState(docs)
  const next = produce(state, (d) => {
    if (!onlyClean) Object.assign(d, emptyState())
    for (const doc of docs) {
      if (dirty.has(doc.key)) continue
      const [kind, id] = doc.key === 'settings' ? ['settings', ''] : doc.key.split(':')
      if (kind === 'month') d.months[id] = fresh.months[id] as Draft<MonthData>
      else if (kind === 'week') d.weeks[id] = fresh.weeks[id] as Draft<WeekData>
      else if (kind === 'day') d.days[id] = fresh.days[id] as Draft<DayData>
      else if (kind === 'settings') d.settings = fresh.settings
    }
  })
  if (!onlyClean) {
    revs = new Map()
    // Default settings count as saved until changed.
    savedRefs = new Map([['settings', next.settings]])
  }
  state = next
  for (const doc of docs) {
    if (dirty.has(doc.key)) continue
    revs.set(doc.key, doc.rev)
    savedRefs.set(doc.key, docRef(state, doc.key))
  }
  emit()
}

async function loadAll() {
  const { docs } = await api<{ docs: { key: string; rev: number; value: unknown }[] }>('GET', '/api/data')
  adoptDocs(docs, false)
}

/** Pull pages changed elsewhere (another tab, a restore) without touching unsaved local edits. */
export async function refresh() {
  if (!isUnlocked()) return
  try {
    const { docs } = await api<{ docs: { key: string; rev: number; value: unknown }[] }>('GET', '/api/data')
    adoptDocs(docs, true)
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

export async function flush(force = false): Promise<void> {
  window.clearTimeout(saveTimer)
  if (inflight) {
    await inflight
    if (dirtyKeys().length) return flush(force)
    return
  }
  const st = saveStatus.get()
  if (st.kind === 'conflict' && !force) return
  const keys = dirtyKeys()
  if (!keys.length) {
    if (st.kind !== 'saved') saveStatus.set({ kind: 'saved' })
    return
  }
  const sent = keys.map((key) => ({ key, baseRev: revs.get(key) ?? 0, value: docRef(state, key) }))
  saveStatus.set({ kind: 'saving' })
  inflight = (async () => {
    try {
      const { revs: next } = await api<{ revs: Record<string, number> }>('PUT', '/api/docs', { changes: sent, force })
      for (const c of sent) {
        revs.set(c.key, next[c.key])
        savedRefs.set(c.key, c.value)
      }
      retryMs = 2000
      channel?.postMessage({ type: 'saved', keys: sent.map((c) => c.key) })
      saveStatus.set(dirtyKeys().length ? { kind: 'saving' } : { kind: 'saved' })
      if (dirtyKeys().length) scheduleSave(50)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
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
}

/** Resolve a conflict: take the saved version from the server, or overwrite it with this tab's. */
export async function resolveConflict(choice: 'theirs' | 'mine') {
  if (choice === 'mine') {
    await flush(true)
    return
  }
  const { docs } = await api<{ docs: { key: string; rev: number; value: unknown }[] }>('GET', '/api/data')
  const conflictKeys = new Set(saveStatus.get().kind === 'conflict' ? (saveStatus.get() as { keys: string[] }).keys : [])
  for (const k of conflictKeys) savedRefs.delete(k)
  // Drop local versions of the conflicting pages, then adopt everything clean from the server.
  state = produce(state, (d) => {
    for (const k of conflictKeys) {
      const [kind, id] = k.split(':')
      if (kind === 'month') delete d.months[id]
      else if (kind === 'week') delete d.weeks[id]
      else if (kind === 'day') delete d.days[id]
    }
  })
  for (const k of conflictKeys) savedRefs.set(k, docRef(state, k))
  saveStatus.set({ kind: 'saved' })
  adoptDocs(docs, true)
  if (dirtyKeys().length) scheduleSave()
}

window.addEventListener('beforeunload', (e) => {
  if (isUnlocked() && (dirtyKeys().length || inflight)) {
    void flush()
    e.preventDefault()
  }
})

// ───────── lock / unlock / boot ─────────

function clearPrivate() {
  window.clearTimeout(saveTimer)
  state = emptyState()
  revs = new Map()
  savedRefs = new Map()
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
        const [kind, id] = p.key === 'settings' ? ['settings', ''] : p.key.split(':')
        if (kind === 'month') d.months[id] = p.value as Draft<MonthData>
        else if (kind === 'week') d.weeks[id] = p.value as Draft<WeekData>
        else if (kind === 'day') d.days[id] = p.value as Draft<DayData>
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
    if (status.locked) session.set({ phase: 'locked', status })
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
  if (status.locked) goLocked(status)
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
  else if (t === 'replaced' && isUnlocked()) void loadAll()
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
export const useWeek = (mondayKey: string) => useStore((s) => s.weeks[mondayKey] ?? EMPTY_WEEK)
export const useDay = (dayKey: string) => useStore((s) => s.days[dayKey] ?? EMPTY_DAY)
export const useSettings = () => useStore((s) => s.settings)

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
export function setWeekTaskDone(mondayKey: string, taskId: string, done: boolean) {
  update((s) => {
    const t = s.weeks[mondayKey]?.tasks.find((x) => x.id === taskId)
    if (t) t.done = done
    for (const [k, d] of Object.entries(s.days)) {
      if (weekStart(k) !== mondayKey) continue
      d.tasks.forEach((dt) => {
        if (dt.weekTaskId === taskId) dt.done = done
      })
    }
  })
}

export function setDayTaskDone(dayKey: string, taskId: string, done: boolean) {
  update((s) => {
    const dt = s.days[dayKey]?.tasks.find((x) => x.id === taskId)
    if (!dt) return
    dt.done = done
    if (dt.weekTaskId) {
      const wt = s.weeks[weekStart(dayKey)]?.tasks.find((x) => x.id === dt.weekTaskId)
      if (wt) wt.done = done
    }
  })
}
