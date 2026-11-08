import { app, BrowserWindow, dialog, ipcMain, session, shell, utilityProcess } from 'electron'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultDataDir } from '../server/paths.ts'
import { opensOutside } from './links.ts'
import { setupUpdates } from './updater.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.DUCKBOOK_DESKTOP_PORT ?? 5327)
const origin = `http://127.0.0.1:${port}`
const token = randomBytes(32).toString('hex')
let window: BrowserWindow | null = null
let runtime: Electron.UtilityProcess | null = null
let closing = false
let stopping = false
let stopped = false

if (process.env.DUCKBOOK_DESKTOP_DATA_DIR) app.setPath('userData', path.join(path.resolve(process.env.DUCKBOOK_DESKTOP_DATA_DIR), 'profile'))
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.show()
    window?.focus()
  })
  app.on('before-quit', (event) => {
    if (stopped) return
    event.preventDefault()
    if (window && !window.isDestroyed()) window.close()
    else void shutdown()
  })
  app.on('window-all-closed', () => void shutdown())
  void app.whenReady().then(boot).catch((e: Error) => {
    dialog.showErrorBox('Duckbook could not start', e.message)
    void shutdown()
  })
}

/** Ask the notebook server to close its database and exit; true only if it did so in time. */
async function stopRuntime() {
  if (!runtime) return true
  const r = runtime
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { r.kill(); resolve(false) }, 5000)
    r.once('exit', (code) => { clearTimeout(timer); resolve(code === 0) })
    r.postMessage({ type: 'stop' })
  })
}

async function shutdown() {
  if (stopping) return
  stopping = true
  await stopRuntime()
  stopped = true
  app.quit()
}

async function boot() {
  if (!app.isPackaged && (!process.env.DUCKBOOK_DESKTOP_DATA_DIR || !process.env.DUCKBOOK_WEB_DATA_DIR || !process.env.DUCKBOOK_WEB_PORT)) throw new Error('Desktop development requires synthetic DUCKBOOK_DESKTOP_DATA_DIR, DUCKBOOK_WEB_DATA_DIR and DUCKBOOK_WEB_PORT.')
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 5317) throw new Error('Choose a desktop port other than 5317.')
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${origin}/`) && !details.url.startsWith('blob:') && !details.url.startsWith('data:') && details.url !== 'about:blank' })
  })
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (new URL(details.url).origin === origin) details.requestHeaders['X-Duckbook-Token'] = token
    callback({ requestHeaders: details.requestHeaders })
  })
  runtime = utilityProcess.fork(path.join(here, 'runtime.js'), [], { serviceName: 'Duckbook notebook', stdio: 'pipe' })
  runtime.stderr?.on('data', (chunk) => process.stderr.write(chunk))
  runtime.on('exit', () => {
    runtime = null
    if (window && !stopping) {
      dialog.showErrorBox('Duckbook notebook stopped', 'The local notebook server stopped unexpectedly. Saved pages are safe. Restart Duckbook to continue. Unsaved edits may still be visible in the window.')
    }
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The notebook server did not start in time.')), 15000)
    runtime!.once('exit', () => { clearTimeout(timer); reject(new Error('The notebook server exited during startup.')) })
    runtime!.on('message', (message) => {
      clearTimeout(timer)
      if (message.type === 'ready') resolve()
      else reject(new Error(message.error))
    })
    runtime!.postMessage({ type: 'start', options: {
      port, token, dataDir: process.env.DUCKBOOK_DESKTOP_DATA_DIR ?? path.join(app.getPath('userData'), 'notebook'),
      distDir: path.resolve(here, '../dist'), webDataDir: process.env.DUCKBOOK_WEB_DATA_DIR ?? defaultDataDir(), webPort: Number(process.env.DUCKBOOK_WEB_PORT ?? 5317),
    } })
  })
  const boundsFile = path.join(app.getPath('userData'), 'window.json')
  let bounds = { width: 1440, height: 940 }
  try { bounds = { ...bounds, ...JSON.parse(fs.readFileSync(boundsFile, 'utf8')) } } catch {}
  window = new BrowserWindow({ ...bounds, minWidth: 900, minHeight: 650, title: 'Duckbook', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(here, 'preload.cjs') } })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (opensOutside(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault() })
  window.webContents.on('will-prevent-unload', () => {
    if (closing) return
    closing = true
    void closeWindow()
  })
  window.on('close', (event) => {
    event.preventDefault()
    if (closing) return
    closing = true
    void closeWindow()
  })
  window.on('closed', () => { window = null })
  setupTextSize(window)
  setupUpdates({ origin, window: () => window, prepareInstall, installFailed })
  await window.loadURL(origin)

  async function flushPage() {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        window!.webContents.executeJavaScript('window.duckbookFlush ? window.duckbookFlush() : false') as Promise<boolean>,
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 8000) }),
      ])
    } catch {
      return false
    } finally { clearTimeout(timer) }
  }

  function keepWindowState() {
    try { fs.writeFileSync(boundsFile, JSON.stringify(window!.getNormalBounds())) } catch {}
    session.defaultSession.flushStorageData()
  }

  // Installing an update never offers "Close anyway": every edit must be saved and the server stopped.
  async function prepareInstall() {
    if (!window || closing || stopping) return 'Duckbook is closing.'
    closing = true
    // No typing from here on, so nothing new appears after the last save.
    window.setEnabled(false)
    if (!(await flushPage())) {
      window.setEnabled(true)
      closing = false
      return 'Some edits aren’t saved yet. Wait until nothing says “Not saved”, then try again.'
    }
    keepWindowState()
    stopping = true
    const clean = await stopRuntime()
    stopped = true
    if (!clean) {
      const reason = 'The notebook could not be closed cleanly, so the update was not installed. Your saved pages are safe; Duckbook will restart.'
      installFailed(reason)
      return reason
    }
    return null
  }

  /** The server is already stopped: start Duckbook again rather than leave a window with no notebook. */
  function installFailed(reason: string) {
    if (window && !window.isDestroyed()) {
      dialog.showMessageBoxSync(window, { type: 'warning', message: 'The update was not installed.', detail: reason })
      window.destroy()
    }
    app.relaunch()
    app.quit()
  }

  async function closeWindow() {
    const saved = await flushPage()
    if (!saved) {
      const answer = await dialog.showMessageBox(window!, { type: 'warning', message: "Some edits aren't saved yet.", detail: 'Keep Duckbook open to finish saving, or close anyway and lose unsaved changes.', buttons: ['Keep open', 'Close anyway'], defaultId: 0, cancelId: 0 })
      if (answer.response === 0) { closing = false; return }
    }
    keepWindowState()
    window!.destroy()
  }
}

/**
 * Size is chosen in Settings, not with the browser's zoom keys: Chromium keeps a key zoom per site,
 * so a stray Ctrl − used to stay for good. The page asks for one of a few sizes on every load.
 */
const TEXT_SIZES = [0.9, 1, 1.15, 1.3]
function setupTextSize(w: BrowserWindow) {
  const contents = w.webContents
  void contents.setVisualZoomLevelLimits(1, 1)
  let factor = 1
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && ['+', '-', '=', '_', '0'].includes(input.key)) event.preventDefault()
  })
  // Ctrl + wheel, or anything else that zooms, goes back to the chosen size.
  contents.on('zoom-changed', () => contents.setZoomFactor(factor))
  contents.on('did-finish-load', () => contents.setZoomFactor(factor))
  ipcMain.handle('duckbook:text-size', (e, value: unknown) => {
    const frame = e.senderFrame
    if (e.sender !== contents || !frame || frame !== contents.mainFrame || new URL(frame.url).origin !== origin) return false
    if (typeof value !== 'number' || !TEXT_SIZES.includes(value)) return false
    factor = value
    contents.setZoomFactor(factor)
    return true
  })
}
