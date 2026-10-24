// Entry point: `node server/main.ts`. Listens on loopback only (127.0.0.1 and ::1) at port 5317.
// Data lives outside the browser and the repo: %LOCALAPPDATA%\Duckbook on Windows (override with DUCKBOOK_DATA_DIR).

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store } from './db.ts'
import { Auth } from './auth.ts'
import { createHandler } from './app.ts'
import { defaultDataDir } from './paths.ts'
export { defaultDataDir } from './paths.ts'

export const DEFAULT_PORT = 5317

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = http.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port
      s.close(() => resolve(p))
    })
  })
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function start(opts: { port?: number; dataDir?: string; distDir?: string; quiet?: boolean; token?: string; webDataDir?: string; webPort?: number } = {}) {
  let port = opts.port ?? Number(process.env.DUCKBOOK_PORT ?? DEFAULT_PORT)
  if (port === 0) port = await freePort()
  const dataDir = opts.dataDir ?? defaultDataDir()
  fs.mkdirSync(dataDir, { recursive: true })
  const log = (msg: string) => opts.quiet || console.log(`${new Date().toISOString()} ${msg}`)

  const store = new Store(dataDir)
  const auth = new Auth(store)
  const handler = createHandler({ store, auth, port, distDir: opts.distDir ?? path.join(repoRoot, 'dist'), log, token: opts.token, webDataDir: opts.webDataDir, webPort: opts.webPort })

  // Both loopback addresses, or neither: a half-bound port would let "localhost" reach another server.
  const servers: http.Server[] = []
  const listen = (host: string) =>
    new Promise<void>((resolve, reject) => {
      const s = http.createServer((req, res) =>
        handler(req, res).catch((e: Error) => {
          log(`request failed: ${e.message}`)
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end()
        }),
      )
      s.once('error', reject)
      s.listen(port, host, () => {
        servers.push(s)
        resolve()
      })
    })
  try {
    await listen('127.0.0.1')
    try {
      await listen('::1')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRNOTAVAIL' && (e as NodeJS.ErrnoException).code !== 'EAFNOSUPPORT') throw e
    }
  } catch (e) {
    servers.forEach((s) => s.close())
    store.close()
    throw e
  }

  const cleanPhotos = () => {
    try {
      const n = store.cleanPhotos()
      if (n) log(`removed ${n} photo files no page or backup refers to`)
    } catch (e) {
      log(`photo cleanup failed: ${(e as Error).message}`)
    }
  }
  const backupTimer = setInterval(() => {
    try {
      const b = store.autoBackup(4)
      if (b) log(`auto backup: ${b.file}`)
      if (b) cleanPhotos()
    } catch (e) {
      log(`auto backup failed: ${(e as Error).message}`)
    }
  }, 15 * 60_000)
  backupTimer.unref()
  try {
    const b = store.autoBackup(0)
    if (b) log(`startup backup: ${b.file}`)
  } catch (e) {
    log(`startup backup failed: ${(e as Error).message}`)
  }

  cleanPhotos()

  log(`duckbook on http://localhost:${port}  data: ${dataDir}`)

  const stop = async () => {
    clearInterval(backupTimer)
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))))
    store.close()
  }
  return { port, dataDir, store, auth, stop }
}

declare const DESKTOP_CODE: string | undefined
if (typeof DESKTOP_CODE === 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start()
    .then(({ dataDir, stop }) => {
      const pidFile = path.join(dataDir, 'server.pid')
      fs.writeFileSync(pidFile, String(process.pid))
      const quit = () => {
        try {
          if (fs.readFileSync(pidFile, 'utf8') === String(process.pid)) fs.rmSync(pidFile)
        } catch {}
        void stop().then(() => process.exit(0))
      }
      process.on('SIGINT', quit)
      process.on('SIGTERM', quit)
    })
    .catch((e: NodeJS.ErrnoException) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${process.env.DUCKBOOK_PORT ?? DEFAULT_PORT} is already in use by another program.` : e.message)
      process.exit(e.code === 'EADDRINUSE' ? 2 : 1)
    })
}
