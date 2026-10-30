// Google Drive sync as the page sees it. The server does the syncing; the page shows its state,
// asks for a sync when the person comes back to the window, and picks up pages that changed.

import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import { refresh } from './store'

export interface SyncStatus {
  google: { configured: boolean; connected: boolean; needsReconnect: boolean; connecting: boolean; connectError: string | null }
  joined: { notebookId: string; joinedAt: string } | null
  lastSync: string | null
  error: string | null
  running: boolean
  dataVersion: number
}

let status: SyncStatus | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

function take(next: SyncStatus) {
  const changed = status && next.dataVersion !== status.dataVersion
  status = next
  listeners.forEach((l) => l())
  // Pages arrived from another device: take them (unsaved edits here are kept and merged on save).
  if (changed) void refresh()
  return next
}

export const loadSync = async () => take(await api<SyncStatus>('GET', '/api/sync'))
export const syncNow = async () => take(await api<SyncStatus>('POST', '/api/sync/now'))
export const useSync = () => useSyncExternalStore(subscribe, () => status)

export async function syncAction<T = Record<string, unknown>>(path: string, body: unknown = {}) {
  const r = await api<T>('POST', path, body)
  if (typeof (r as { dataVersion?: unknown }).dataVersion === 'number') take(r as unknown as SyncStatus)
  else await loadSync()
  return r
}

/** While unlocked: check every 20 s, and sync when the window comes back into view. */
export function useSyncWatch(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let lastNow = 0
    const check = () => void loadSync().catch(() => {})
    const back = () => {
      if (document.visibilityState !== 'visible' || !status?.joined || Date.now() - lastNow < 30_000) return check()
      lastNow = Date.now()
      void syncNow().catch(() => {})
    }
    check()
    const t = window.setInterval(() => document.visibilityState === 'visible' && check(), 20_000)
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
    }
  }, [enabled])
}
