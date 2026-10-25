import { useSyncExternalStore } from 'react'

// Which pages' tours this browser has seen. A display aid like the paper colour: kept outside
// the notebook data, so it never touches page shapes or API_LEVEL.
const KEY = 'duckbook:tour'
const listeners = new Set<() => void>()
let current: string | null = null

function readRaw() {
  try {
    return localStorage.getItem(KEY) ?? '[]'
  } catch {
    return current ?? '[]'
  }
}

function write(v: string[]) {
  const raw = JSON.stringify(v)
  current = raw
  try {
    localStorage.setItem(KEY, raw)
  } catch {
    // Storage off: the tour stays dismissed until reload.
  }
  listeners.forEach((l) => l())
}

const parse = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export const markSeen = (...pages: string[]) => write([...new Set([...parse(readRaw()), ...pages])])
export const resetTour = () => write([])

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export function useTourSeen(page: string) {
  return useSyncExternalStore(subscribe, () => parse(readRaw()).includes(page))
}
