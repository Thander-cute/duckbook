import { useSyncExternalStore } from 'react'
import { creditPomodoro, getState, isUnlocked } from './store'

export type Phase = 'idle' | 'focus' | 'break'
/** How the running timer shows: over the notebook, as a small corner card, or full screen. */
export type TimerView = 'overlay' | 'mini' | 'full'
type TaskRef = { dayKey: string; taskId: string; label: string }

export interface TimerState {
  phase: Phase
  dayKey: string | null
  taskId: string | null
  label: string
  endsAt: number // epoch ms while running
  remaining: number // ms, used while paused
  total: number // ms, the block's full length, for the ring
  paused: boolean
  view: TimerView
  /** Another task asked to start while this one runs; waits for a yes. */
  switchTo: TaskRef | null
}

const IDLE: TimerState = { phase: 'idle', dayKey: null, taskId: null, label: '', endsAt: 0, remaining: 0, total: 0, paused: false, view: 'overlay', switchTo: null }

// The running block is kept in this browser so a reload or restart doesn't lose it. Task text
// stays out of it: the name is read from the notebook once it's unlocked.
const KEY = 'duckbook:timer'
const VIEW_KEY = 'duckbook:timer-view'

let timer: TimerState = restore()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const set = (patch: Partial<TimerState>) => {
  timer = { ...timer, ...patch }
  save()
  emit()
}

function save() {
  try {
    const { phase, dayKey, taskId, endsAt, remaining, total, paused, view } = timer
    if (phase === 'idle' && !taskId) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify({ phase, dayKey, taskId, endsAt, remaining, total, paused, view }))
  } catch {
    // Storage off: the timer still runs for this visit.
  }
}

function restore(): TimerState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!v || !['idle', 'focus', 'break'].includes(v.phase) || typeof v.endsAt !== 'number') return IDLE
    const t: TimerState = { ...IDLE, ...v, label: '', switchTo: null }
    if (t.paused || t.phase === 'idle') return t
    // Catch up on what ended while the app was closed, quietly.
    const now = Date.now()
    if (t.phase === 'focus' && t.endsAt <= now) {
      if (t.dayKey && t.taskId) creditPomodoro(t.dayKey, t.taskId)
      const total = getState().settings.breakMin * 60_000
      const breakEnds = t.endsAt + total
      return breakEnds > now ? { ...t, phase: 'break', endsAt: breakEnds, total } : { ...t, phase: 'idle' }
    }
    if (t.phase === 'break' && t.endsAt <= now) return { ...t, phase: 'idle' }
    return t
  } catch {
    return IDLE
  }
}

export const useTimer = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => timer,
  )

const viewListeners = new Set<() => void>()
export function getDefaultView(): TimerView {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'mini' || v === 'full' ? v : 'overlay'
  } catch {
    return 'overlay'
  }
}
export function setDefaultView(v: TimerView) {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    // Storage off: the choice lasts until reload.
  }
  viewListeners.forEach((l) => l())
}
export const useDefaultView = () =>
  useSyncExternalStore(
    (l) => (viewListeners.add(l), () => void viewListeners.delete(l)),
    getDefaultView,
  )

export const remainingMs = (t: TimerState) => (t.paused ? t.remaining : Math.max(0, t.endsAt - Date.now()))

/** Start a focus block on a task. If another task's block is running, ask first. */
export function startFocus(dayKey: string, taskId: string, label: string) {
  if (timer.phase === 'focus' && timer.taskId === taskId && timer.dayKey === dayKey) return set({ view: timer.view === 'mini' ? getDefaultView() : timer.view })
  if (timer.phase === 'focus') return set({ switchTo: { dayKey, taskId, label } })
  const ms = getState().settings.focusMin * 60_000
  set({ phase: 'focus', dayKey, taskId, label, endsAt: Date.now() + ms, remaining: ms, total: ms, paused: false, view: getDefaultView(), switchTo: null })
}

export function confirmSwitch() {
  const next = timer.switchTo
  if (!next) return
  set({ phase: 'idle', switchTo: null })
  startFocus(next.dayKey, next.taskId, next.label)
}

export const cancelSwitch = () => set({ switchTo: null })
export const setView = (view: TimerView) => set({ view })

export function startBreak() {
  const ms = getState().settings.breakMin * 60_000
  set({ phase: 'break', endsAt: Date.now() + ms, remaining: ms, total: ms, paused: false })
}

export function togglePause() {
  if (timer.phase === 'idle') return
  if (timer.paused) set({ paused: false, endsAt: Date.now() + timer.remaining })
  else set({ paused: true, remaining: remainingMs(timer) })
}

export function endBreak() {
  set({ phase: 'idle', paused: false })
}

export function stop() {
  set({ phase: 'idle', taskId: null, dayKey: null, label: '', paused: false, switchTo: null })
}

function chime() {
  try {
    const ctx = new AudioContext()
    ;[523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const t0 = ctx.currentTime + i * 0.18
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.2)
      o.connect(g).connect(ctx.destination)
      o.start(t0)
      o.stop(t0 + 1.3)
    })
  } catch {
    /* audio is a nicety */
  }
}

// One shared tick drives the countdown, the tab title, and phase transitions.
const baseTitle = document.title
setInterval(() => {
  if (timer.phase === 'idle') {
    if (document.title !== baseTitle) document.title = baseTitle
    return
  }
  const ms = remainingMs(timer)
  const mm = Math.floor(ms / 60000)
  const ss = Math.floor((ms % 60000) / 1000)
  // Task names stay out of the tab title while the notebook is locked.
  const what = timer.phase === 'focus' ? (isUnlocked() && timer.label) || 'focus' : 'break'
  document.title = `${timer.paused ? '❚❚' : timer.phase === 'focus' ? '●' : '○'} ${mm}:${String(ss).padStart(2, '0')} · ${what}`
  if (timer.paused || ms > 0) {
    // A fresh snapshot each tick, or React sees the same object and the clock on screen stands still.
    timer = { ...timer }
    emit()
    return
  }
  chime()
  if (timer.phase === 'focus') {
    const { dayKey, taskId } = timer
    if (dayKey && taskId) creditPomodoro(dayKey, taskId)
    startBreak()
  } else {
    endBreak()
  }
}, 500)
