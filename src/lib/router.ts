import { useSyncExternalStore } from 'react'
import { todayKey } from './date'

export type View = 'month' | 'week' | 'day' | 'reflect'
export interface Route { view: View; date: string }

const VIEWS: View[] = ['month', 'week', 'day', 'reflect']

function parse(hash: string): Route {
  const [, view, date] = hash.replace(/^#/, '').split('/')
  const valid = VIEWS.includes(view as View) && /^\d{4}-\d{2}-\d{2}$/.test(date ?? '')
  return valid ? { view: view as View, date } : { view: 'day', date: todayKey() }
}

let current = parse(location.hash)
const listeners = new Set<() => void>()

window.addEventListener('hashchange', () => {
  current = parse(location.hash)
  listeners.forEach((l) => l())
})

export const href = (view: View, date: string) => `#/${view}/${date}`

export const go = (view: View, date: string) => {
  location.hash = href(view, date)
}

export const useRoute = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
