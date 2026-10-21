// HTTP layer: serves the built notebook and a small JSON API, for this machine only.
//
// Browser-side protections (the server itself only listens on loopback):
//  - Host must be localhost/127.0.0.1/[::1] on our port: blocks DNS-rebinding pages.
//  - API calls need the custom X-Duckbook header and a same-origin Origin/Sec-Fetch-Site when present:
//    other websites can't send it without a CORS preflight, which we never approve.
//  - The PIN session cookie is HttpOnly and SameSite=Strict.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { SchemaError, docsToState, normalizeState, summarize } from '../src/lib/schema.ts'
import { ConflictError, RestoreError, type Change, type Store } from './db.ts'
import type { Auth } from './auth.ts'

const MAX_BODY = 20 * 1024 * 1024

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ')

class HttpError extends Error {
  status: number
  body: Record<string, unknown>
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.body = { error: message, ...extra }
  }
}

export interface AppOptions { store: Store; auth: Auth; port: number; distDir: string; log?: (msg: string) => void }

export function createHandler({ store, auth, port, distDir, log = () => {} }: AppOptions) {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`])
  const cookieName = `duckbook_sid_${port}`

  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
    res.end(JSON.stringify(body))
  }

  const readJson = (req: http.IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return reject(new HttpError(415, 'Expected JSON.'))
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) {
          reject(new HttpError(413, 'Too large.'))
          req.destroy()
        } else chunks.push(c)
      })
      req.on('end', () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error()
          resolve(v as Record<string, unknown>)
        } catch {
          reject(new HttpError(400, 'Malformed JSON.'))
        }
      })
      req.on('error', reject)
    })

  const sessionToken = (req: http.IncomingMessage) => {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [k, v] = part.trim().split('=')
      if (k === cookieName) return v
    }
    return undefined
  }

  const sessionCookie = (token: string | null) =>
    token ? `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/` : `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`

  const requireUnlocked = (req: http.IncomingMessage) => {
    if (!auth.allows(sessionToken(req))) throw new HttpError(401, 'Locked.', { locked: true })
  }

  const statusBody = (req: http.IncomingMessage) => {
    const unlocked = auth.allows(sessionToken(req))
    const base = { app: 'duckbook', pinEnabled: auth.enabled, autoLockMin: auth.autoLockMin, locked: !unlocked, retryAfterMs: auth.retryAfterMs() }
    if (!unlocked) return base
    return { ...base, docCount: store.docCount(), quarantineCount: store.quarantined().length, migration: store.getMeta('migration') ?? null, dataDir: store.dataDir, lastBackup: store.getMeta('last_backup') ?? null }
  }

  async function api(req: http.IncomingMessage, res: http.ServerResponse, route: string) {
    const method = req.method ?? 'GET'

    if (route === 'GET /api/health') return send(res, 200, { app: 'duckbook', version: 1, pid: process.pid })
    if (route === 'GET /api/status') return send(res, 200, statusBody(req))

    if (route === 'POST /api/unlock') {
      const body = await readJson(req)
      if (!auth.enabled) return send(res, 200, { ok: true })
      const r = auth.unlock(body.pin)
      if (!r.ok) {
        log('unlock: wrong PIN or waiting')
        return send(res, r.retryAfterMs ? 429 : 403, { error: r.retryAfterMs ? 'Too many tries.' : 'Wrong PIN.', retryAfterMs: r.retryAfterMs })
      }
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(r.token) })
    }

    if (route === 'POST /api/lock') {
      auth.lockAll()
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(null) })
    }

    // Everything below touches private data.
    requireUnlocked(req)

    if (route === 'POST /api/ping') return send(res, 200, { ok: true })

    if (route === 'GET /api/data') return send(res, 200, { docs: store.allDocs() })

    if (route === 'PUT /api/docs') {
      const body = await readJson(req)
      if (!Array.isArray(body.changes) || body.changes.length > 5000) throw new HttpError(400, 'Expected a list of changes.')
      const changes = body.changes.map((c: unknown) => {
        const x = c as Change
        if (typeof x?.key !== 'string' || typeof x.baseRev !== 'number') throw new HttpError(400, 'Malformed change.')
        return { key: x.key, baseRev: x.baseRev, value: x.value }
      })
      return send(res, 200, { revs: store.putDocs(changes, body.force === true) })
    }

    if (route === 'POST /api/import/preview') {
      const body = await readJson(req)
      const r = normalizeState(body.data)
      return send(res, 200, { summary: summarize(r.state), issues: r.issues.slice(0, 20), issueCount: r.issues.length, existingPages: store.docCount() })
    }

    if (route === 'POST /api/import') {
      const body = await readJson(req)
      const r = normalizeState(body.data)
      const source = body.source === 'legacy' ? 'legacy' : 'file'
      if (store.docCount() && body.replace !== true) throw new HttpError(409, 'There are already pages here.', { needsReplace: true })
      const out = store.replaceAll(r.state, { reason: source === 'legacy' ? 'pre-migration' : 'pre-import', quarantine: r.quarantine, source })
      // The "browser copy is safely in the database" marker only holds right after a legacy move.
      if (source === 'legacy') {
        const hash = typeof body.sourceHash === 'string' ? body.sourceHash : null
        store.setMeta('migration', { at: new Date().toISOString(), sourceHash: hash, summary: out.summary })
      } else store.setMeta('migration', null)
      log(`import (${source}): ${out.summary.days} days, ${out.summary.weeks} weeks, ${out.summary.months} months; ${r.issues.length} issues`)
      return send(res, 200, { ...out, issueCount: r.issues.length, docs: store.allDocs() })
    }

    if (route === 'GET /api/export') {
      const state = docsToState(store.allDocs())
      return send(res, 200, { format: 'duckbook-export', formatVersion: 1, exportedAt: new Date().toISOString(), state, quarantine: store.quarantined() })
    }

    if (route === 'GET /api/backups') return send(res, 200, { backups: store.listBackups(), dir: store.backupDir })

    if (route === 'POST /api/backups') {
      const b = store.createBackup('manual')
      log(`backup: ${b.file}`)
      return send(res, 200, { backup: b })
    }

    if (route === 'POST /api/backups/restore') {
      const body = await readJson(req)
      if (typeof body.file !== 'string') throw new HttpError(400, 'Which backup?')
      const out = store.restoreBackup(body.file)
      store.setMeta('migration', null)
      log(`restore: ${body.file}`)
      return send(res, 200, { ...out, docs: store.allDocs() })
    }

    if (route === 'PUT /api/lock-settings') {
      const body = await readJson(req)
      let headers: Record<string, string> = {}
      if (body.pin !== undefined) {
        if (body.pin !== null && typeof body.pin !== 'string') throw new HttpError(400, 'PIN must be 6 digits.')
        const r = auth.setPin(body.currentPin, body.pin as string | null)
        if (!r.ok) return send(res, r.retryAfterMs ? 429 : 403, { error: r.error, retryAfterMs: r.retryAfterMs })
        headers = { 'Set-Cookie': sessionCookie(r.token) }
        log(body.pin === null ? 'PIN removed' : 'PIN set')
      }
      if (typeof body.autoLockMin === 'number') auth.setAutoLock(body.autoLockMin)
      return send(res, 200, statusBody(req), headers)
    }

    throw new HttpError(method === 'GET' ? 404 : 405, 'Not found.')
  }

  function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' })
    let rel: string
    try {
      rel = decodeURIComponent(pathname)
    } catch {
      return send(res, 400, { error: 'Bad path.' })
    }
    if (rel === '/' || !path.extname(rel)) rel = '/index.html'
    const file = path.normalize(path.join(distDir, rel))
    if (!file.startsWith(path.normalize(distDir + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (rel === '/index.html') {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
        return res.end('duckbook is not built yet. Run the launcher again.')
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Not found')
    }
    const hashed = rel.startsWith('/assets/')
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(file).pipe(res)
  }

  return async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
    res.setHeader('Content-Security-Policy', CSP)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')

    if (!hosts.has(req.headers.host ?? '')) return send(res, 421, { error: 'Wrong host.' })

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname)

    const origin = req.headers.origin
    const site = req.headers['sec-fetch-site']
    if (req.headers['x-duckbook'] !== '1') return send(res, 403, { error: 'Missing app header.' })
    if (origin !== undefined && !hosts.has(origin.replace(/^http:\/\//, ''))) return send(res, 403, { error: 'Cross-origin request refused.' })
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return send(res, 403, { error: 'Cross-site request refused.' })

    try {
      await api(req, res, `${req.method} ${url.pathname}`)
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, e.body)
      if (e instanceof SchemaError) return send(res, 400, { error: e.message })
      if (e instanceof ConflictError) return send(res, 409, { error: e.message, conflicts: e.conflicts })
      if (e instanceof RestoreError) return send(res, 422, { error: e.message })
      log(`error: ${(e as Error).message}`)
      return send(res, 500, { error: 'The duckbook server hit an error and this request did not complete.' })
    }
  }
}
