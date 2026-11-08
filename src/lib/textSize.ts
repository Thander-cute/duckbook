import { useSyncExternalStore } from 'react'

// How big the whole notebook is drawn in the desktop app. A display choice for this app, like the
// paper colour; the browser has its own zoom, so the setting only exists where the bridge does.
export const TEXT_SIZES = [
  { factor: 0.9, label: 'Small' },
  { factor: 1, label: 'Normal' },
  { factor: 1.15, label: 'Large' },
  { factor: 1.3, label: 'Larger' },
] as const

const KEY = 'duckbook:text-size'
const bridge = (window as unknown as { duckbookView?: { setTextSize: (f: number) => Promise<boolean> } }).duckbookView
const listeners = new Set<() => void>()
let current: number | null = null

export const canSetTextSize = !!bridge

export function getTextSize(): number {
  if (current !== null) return current
  try {
    const v = Number(localStorage.getItem(KEY))
    return TEXT_SIZES.some((s) => s.factor === v) ? v : 1
  } catch {
    return 1
  }
}

export function applyTextSize(f = getTextSize()) {
  void bridge?.setTextSize(f).catch(() => {})
}

export function setTextSize(f: number) {
  current = f
  try {
    localStorage.setItem(KEY, String(f))
  } catch {
    // Storage off: the choice lasts until the app closes.
  }
  applyTextSize(f)
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export const useTextSize = () => useSyncExternalStore(subscribe, getTextSize)
