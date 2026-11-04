// Desktop app updates, driven by the desktop shell (desktop/updater.ts). Absent in the browser version.
import { useSyncExternalStore } from 'react'

export interface UpdateState {
  status: 'off' | 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'
  current: string
  version?: string
  notes?: string
  percent?: number
  error?: string
  checkedAt?: string
}
type Action = 'get' | 'check' | 'download' | 'install'
interface Bridge {
  run(action: Action): Promise<UpdateState>
  subscribe(listener: (state: UpdateState) => void): () => void
}

const bridge = (window as unknown as { duckbookUpdates?: Bridge }).duckbookUpdates
let state: UpdateState | null = null
const listeners = new Set<() => void>()
const take = (next: UpdateState) => {
  state = next
  listeners.forEach((l) => l())
}
if (bridge) {
  bridge.subscribe(take)
  void bridge.run('get').then(take, () => {})
}

export const updateAction = async (action: Action) => {
  if (bridge) take(await bridge.run(action))
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const useUpdates = () => useSyncExternalStore(subscribe, () => state)
