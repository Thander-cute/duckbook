// Desktop updates: check on launch and when asked, download only when asked, install only when asked
// and only after every edit is saved and the notebook server has stopped. Nothing installs on quit.
//
// The feed is the newest GitHub release: latest.yml plus the installer, whose sha512 is checked
// before it runs. Installers are not code-signed. Betas are published as normal releases, since
// GitHub's "latest" skips releases marked as pre-releases.

import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import electronUpdater from 'electron-updater'

export const FEED = 'https://github.com/Thander-cute/duckbook/releases/latest/download'

export type UpdateStatus = 'off' | 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'
export interface UpdateState {
  status: UpdateStatus
  current: string
  version?: string
  notes?: string
  percent?: number
  error?: string
  checkedAt?: string
}

const CHECK_DELAY = 10_000

/** The feed, or a local one for tests (DUCKBOOK_UPDATE_URL: https or http://127.0.0.1 only). */
function feedUrl(): string {
  const local = process.env.DUCKBOOK_UPDATE_URL
  if (!local) return FEED
  const u = new URL(local)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1')) throw new Error('DUCKBOOK_UPDATE_URL must be https or http://127.0.0.1.')
  return local
}

const short = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0]!.slice(0, 200)
/** Release notes as plain text: the page shows them as text, never as HTML. */
const notesText = (n: unknown): string | undefined => {
  const text = typeof n === 'string' ? n : Array.isArray(n) ? n.map((x: { note?: string | null }) => x.note ?? '').join('\n\n') : undefined
  return text?.replace(/<[^>]*>/g, '').replace(/\*\*|`/g, '').trim().slice(0, 2000) || undefined
}

export function setupUpdates(opts: {
  origin: string
  window: () => BrowserWindow | null
  /** Save everything and stop the notebook server. Returns a reason when that couldn't be done. */
  prepareInstall: () => Promise<string | null>
  /** Called when the notebook server was stopped but the installer didn't start. */
  installFailed: (reason: string) => void
}) {
  const updater = electronUpdater.autoUpdater
  updater.setFeedURL({ provider: 'generic', url: feedUrl(), channel: 'latest' })
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  updater.logger = null

  let state: UpdateState = { status: app.isPackaged ? 'idle' : 'off', current: app.getVersion() }
  const set = (patch: Partial<UpdateState>) => {
    state = { ...state, error: undefined, ...patch }
    const w = opts.window()
    if (w && !w.isDestroyed()) w.webContents.send('duckbook:update-state', state)
  }
  updater.on('update-available', (info) => set({ status: 'available', version: info.version, notes: notesText(info.releaseNotes), checkedAt: new Date().toISOString() }))
  updater.on('update-not-available', () => set({ status: 'none', version: undefined, notes: undefined, checkedAt: new Date().toISOString() }))
  updater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.floor(p.percent) }))
  updater.on('update-downloaded', () => set({ status: 'ready', percent: 100 }))

  const check = async () => {
    if (['off', 'checking', 'downloading', 'ready', 'installing'].includes(state.status)) return
    set({ status: 'checking' })
    try {
      const r = await updater.checkForUpdates()
      if (!r) set({ status: 'error', error: 'Updates only work in the installed app.' })
    } catch (e) {
      set({ status: 'error', error: `Couldn’t check for updates: ${short(e)}` })
    }
  }
  const download = async () => {
    if (state.status !== 'available' && !(state.status === 'error' && state.version)) return
    set({ status: 'downloading', percent: 0 })
    try {
      await updater.downloadUpdate()
    } catch (e) {
      set({ status: 'error', error: `Couldn’t download the update: ${short(e)}` })
    }
  }
  const install = async () => {
    if (state.status !== 'ready') return
    set({ status: 'installing' })
    // When the server had already stopped, prepareInstall restarts the app itself.
    const problem = await opts.prepareInstall()
    if (problem) return set({ status: 'ready', error: problem })
    // install() is what quitAndInstall() runs. false means it refused (no download, already called);
    // true only means a launch was attempted: the installer starts asynchronously, so a failure to start
    // or to install shows up after Duckbook has quit, with the old version still installed.
    let started = false
    try {
      started = (updater as unknown as { install(silent: boolean, runAfter: boolean): boolean }).install(true, true)
    } catch {}
    if (!started) return opts.installFailed('The installer could not start. Your pages are saved; Duckbook will restart.')
    opts.window()?.destroy()
    app.quit()
  }

  // Only the app's own page, in its main frame, may drive updates.
  const trusted = (e: IpcMainInvokeEvent) => {
    const w = opts.window()
    const frame = e.senderFrame
    return !!w && e.sender === w.webContents && !!frame && frame === e.sender.mainFrame && new URL(frame.url).origin === opts.origin
  }
  ipcMain.handle('duckbook:update', async (e, action: unknown) => {
    if (!trusted(e)) throw new Error('Not allowed.')
    if (action === 'check') await check()
    else if (action === 'download') void download()
    else if (action === 'install') await install()
    return state
  })

  if (state.status === 'idle') setTimeout(() => void check(), CHECK_DELAY).unref()
}
