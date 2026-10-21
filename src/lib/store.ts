import { useSyncExternalStore } from 'react'
import { produce, type Draft } from 'immer'
import { weekStart } from './date'

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

const STORAGE_KEY = 'duckbook:v1'

export const uid = () => Math.random().toString(36).slice(2, 10)

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

const initial = (): State => ({
  version: 1,
  months: {},
  weeks: {},
  days: {},
  settings: { ink: 'serif', focusMin: 25, breakMin: 5 },
})

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initial()
    const parsed = JSON.parse(raw) as State
    return { ...initial(), ...parsed, settings: { ...initial().settings, ...parsed.settings } }
  } catch {
    return initial()
  }
}

let state = load()
const listeners = new Set<() => void>()
let saveTimer: number | undefined

function flush() {
  if (saveTimer === undefined) return
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function persist() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flush, 150)
}

// Only write on unload if an edit is still pending, so an idle tab never clobbers newer data.
window.addEventListener('beforeunload', flush)

// Another tab saved: adopt its pages.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY || saveTimer !== undefined) return
  state = load()
  listeners.forEach((l) => l())
})

export function update(recipe: (draft: Draft<State>) => void) {
  state = produce(state, recipe)
  persist()
  listeners.forEach((l) => l())
}

export function replaceState(next: State) {
  state = { ...initial(), ...next, settings: { ...initial().settings, ...next.settings } }
  persist()
  listeners.forEach((l) => l())
}

export const getState = () => state

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

// Read helpers return a stable empty object when nothing has been written yet.
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
