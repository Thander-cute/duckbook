// The only bridge from the page to the desktop shell: app updates. No Node, no other IPC.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('duckbookUpdates', {
  run: (action: 'get' | 'check' | 'download' | 'install') => ipcRenderer.invoke('duckbook:update', action),
  subscribe: (listener: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => listener(state)
    ipcRenderer.on('duckbook:update-state', handler)
    return () => void ipcRenderer.removeListener('duckbook:update-state', handler)
  },
})
