import { useSyncExternalStore } from 'react'
import { creditPomodoro, getState, isUnlocked } from './store'

export type Phase = 'idle' | 'focus' | 'break'

export interface TimerState {
  phase: Phase
  dayKey: string | null
  taskId: string | null
  label: string
  endsAt: number // epoch ms while running
  remaining: number // ms, used while paused
  paused: boolean
}

let timer: TimerState = { phase: 'idle', dayKey: null, taskId: null, label: '', endsAt: 0, remaining: 0, paused: false }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const set = (patch: Partial<TimerState>) => {
  timer = { ...timer, ...patch }
  emit()
}

export const useTimer = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => timer,
  )

export const remainingMs = (t: TimerState) => (t.paused ? t.remaining : Math.max(0, t.endsAt - Date.now()))

export function startFocus(dayKey: string, taskId: string, label: string) {
  const ms = getState().settings.focusMin * 60_000
  set({ phase: 'focus', dayKey, taskId, label, endsAt: Date.now() + ms, remaining: ms, paused: false })
}

export function startBreak() {
  const ms = getState().settings.breakMin * 60_000
  set({ phase: 'break', endsAt: Date.now() + ms, remaining: ms, paused: false })
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
  set({ phase: 'idle', taskId: null, dayKey: null, label: '', paused: false })
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
  const what = timer.phase === 'focus' ? (isUnlocked() ? timer.label : 'focus') : 'break'
  document.title = `${timer.paused ? '❚❚' : timer.phase === 'focus' ? '●' : '○'} ${mm}:${String(ss).padStart(2, '0')} · ${what}`
  if (timer.paused || ms > 0) {
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
