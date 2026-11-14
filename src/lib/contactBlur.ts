import { useSyncExternalStore } from 'react'

// Whether a person's private sections start blurred. A display choice for this browser, like the
// paper colour and habit marks: kept outside the notebook, so it can differ per computer.
export type BlurSection = 'notes' | 'disc'
const KEYS: Record<BlurSection, string> = { notes: 'duckbook:blur-notes', disc: 'duckbook:blur-disc' }
const listeners = new Set<() => void>()
const current: Partial<Record<BlurSection, boolean>> = {}

export function getBlur(section: BlurSection): boolean {
  try {
    const v = localStorage.getItem(KEYS[section])
    return v === null ? true : v === 'on'
  } catch {
    return current[section] ?? true
  }
}

export function setBlur(section: BlurSection, on: boolean) {
  try {
    localStorage.setItem(KEYS[section], on ? 'on' : 'off')
    delete current[section]
  } catch {
    // Storage off: the choice lasts until reload.
    current[section] = on
  }
  listeners.forEach((l) => l())
}

const read = (section: BlurSection) => current[section] ?? getBlur(section)
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

export function useBlur(section: BlurSection) {
  return useSyncExternalStore(subscribe, () => read(section))
}
