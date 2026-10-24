import { app, BrowserWindow, dialog, session, utilityProcess } from 'electron'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultDataDir } from '../server/paths.ts'

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

async function shutdown() {
  if (stopping) return
  stopping = true
  if (runtime) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { runtime?.kill(); resolve() }, 5000)
      runtime!.once('exit', () => { clearTimeout(timer); resolve() })
      runtime!.postMessage({ type: 'stop' })
    })
  }
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
  window = new BrowserWindow({ ...bounds, minWidth: 900, minHeight: 650, title: 'Duckbook', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
  await window.loadURL(origin)

  async function closeWindow() {
    let saved = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      saved = await Promise.race([
        window!.webContents.executeJavaScript('window.duckbookFlush ? window.duckbookFlush() : false') as Promise<boolean>,
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 8000) }),
      ])
    } catch {} finally { clearTimeout(timer) }
    if (!saved) {
      const answer = await dialog.showMessageBox(window!, { type: 'warning', message: "Some edits aren't saved yet.", detail: 'Keep Duckbook open to finish saving, or close anyway and lose unsaved changes.', buttons: ['Keep open', 'Close anyway'], defaultId: 0, cancelId: 0 })
      if (answer.response === 0) { closing = false; return }
    }
    try { fs.writeFileSync(boundsFile, JSON.stringify(window!.getNormalBounds())) } catch {}
    session.defaultSession.flushStorageData()
    window!.destroy()
  }
}
