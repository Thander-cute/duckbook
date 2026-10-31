// Google sign-in for sync and the Drive folder it uses. Nothing here runs until the person connects.
//
//  - OAuth installed-app flow, as for the Calendar add-on: the system browser, a one-off loopback
//    listener on 127.0.0.1, PKCE (S256) and state. Scope drive.file: only files this app created.
//  - The token lives in sync-google.json next to the notebook, outside duckbook.sqlite, so backups
//    never contain it. Disconnect revokes it and deletes the file. It is not encrypted.
//  - The OAuth client is the app's own, built in (see readClient).

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Remote, RemoteFile } from './remote.ts'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const FOLDER = 'Duckbook Sync'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const CONNECT_TIMEOUT = 10 * 60_000
const REQUEST_TIMEOUT = 30_000

interface Client { clientId: string; clientSecret?: string }
interface Account { refreshToken: string; accessToken: string; expiresAt: number; connectedAt: string; folderId?: string; needsReconnect?: boolean }

export class GoogleError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Google's endpoints; tests point them at a local fake (only https or loopback http is accepted). */
function endpoints() {
  const pick = (name: string, fallback: string) => {
    const v = process.env[name]
    if (!v) return fallback
    const u = new URL(v)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1')) throw new Error(`${name} must be https or http://127.0.0.1.`)
    return v.replace(/\/$/, '')
  }
  return {
    authUrl: pick('DUCKBOOK_GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
    tokenUrl: pick('DUCKBOOK_GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
    revokeUrl: pick('DUCKBOOK_GOOGLE_REVOKE_URL', 'https://oauth2.googleapis.com/revoke'),
    driveUrl: pick('DUCKBOOK_GOOGLE_DRIVE_URL', 'https://www.googleapis.com/drive/v3'),
    uploadUrl: pick('DUCKBOOK_GOOGLE_UPLOAD_URL', 'https://www.googleapis.com/upload/drive/v3'),
  }
}

declare const BUNDLED_GOOGLE_CLIENT: string | undefined
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const parseClient = (text: string): Client | null => {
  try {
    const raw = JSON.parse(text)
    const c = raw.installed ?? raw
    if (typeof c.client_id === 'string' && c.client_id) return { clientId: c.client_id, clientSecret: typeof c.client_secret === 'string' ? c.client_secret : undefined }
  } catch {}
  return null
}

const readFile = (dir: string) => {
  for (const name of ['google-client.json', 'google_client.json']) {
    try {
      return parseClient(fs.readFileSync(path.join(dir, name), 'utf8'))
    } catch {}
  }
  return null
}

/**
 * The app's OAuth client: env vars (tests), a file in the data folder, or the one built into the app
 * (the desktop bundle embeds it; the local server reads google-client.json at the repo root, not committed).
 * Google treats installed-app clients as public; PKCE protects the sign-in.
 */
export function readClient(dataDir: string): Client | null {
  const id = process.env.DUCKBOOK_GOOGLE_CLIENT_ID
  if (id) return { clientId: id, clientSecret: process.env.DUCKBOOK_GOOGLE_CLIENT_SECRET || undefined }
  return readFile(dataDir) ?? (typeof BUNDLED_GOOGLE_CLIENT !== 'undefined' ? parseClient(BUNDLED_GOOGLE_CLIENT) : readFile(repo))
}

export class GoogleDrive {
  private dataDir: string
  private file: string
  private log: (msg: string) => void
  private pending: { server: http.Server; timer: NodeJS.Timeout } | null = null
  /** Bumped by sign-out: sign-in or token work started before it must not save a token afterwards. */
  private signOuts = 0
  private connectError: string | null = null

  constructor(dataDir: string, log: (msg: string) => void = () => {}) {
    this.dataDir = dataDir
    this.file = path.join(dataDir, 'sync-google.json')
    this.log = log
  }

  private account(): Account | null {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as Account
    } catch {
      return null
    }
  }

  private save(a: Account) {
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(a))
    fs.renameSync(tmp, this.file)
  }

  status() {
    const a = this.account()
    return { configured: !!readClient(this.dataDir), connected: !!a, needsReconnect: !!a?.needsReconnect, connecting: !!this.pending, connectError: this.connectError }
  }

  /** Start signing in: returns Google's page to open. The answer arrives on a one-off loopback listener. */
  async connect(): Promise<{ authUrl: string }> {
    const client = readClient(this.dataDir)
    if (!client) throw new GoogleError(409, 'No Google OAuth client is set up yet (google-client.json in the data folder).')
    this.cancel()
    this.connectError = null
    const ep = endpoints()
    const state = randomBytes(16).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const server = http.createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const timer = setTimeout(() => {
      this.connectError = 'Google sign-in took too long. Try again.'
      this.cancel()
    }, CONNECT_TIMEOUT)
    timer.unref()
    this.pending = { server, timer }
    const signOuts = this.signOuts
    server.on('request', (req, res) => void this.callback(req, res, { client, state, verifier, redirectUri, live: () => this.pending?.server === server && this.signOuts === signOuts }).catch(() => res.destroy()))
    const q = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    })
    return { authUrl: `${ep.authUrl}?${q}` }
  }

  cancel() {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.server.close()
    this.pending = null
  }

  private async callback(req: http.IncomingMessage, res: http.ServerResponse, f: { client: Client; state: string; verifier: string; redirectUri: string; live: () => boolean }) {
    const page = (status: number, text: string) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(`<!doctype html><meta charset="utf-8"><title>duckbook</title><p style="font:16px system-ui;margin:3em">${text}</p>`)
    }
    const url = new URL(req.url ?? '/', f.redirectUri)
    if (req.headers.host !== new URL(f.redirectUri).host || req.method !== 'GET' || url.pathname !== '/') return page(404, 'Not found.')
    if (url.searchParams.get('state') !== f.state) return page(400, 'This sign-in link is out of date. Start again from duckbook.')
    const code = url.searchParams.get('code')
    if (!code) {
      this.connectError = url.searchParams.get('error') === 'access_denied' ? 'Google access was not allowed.' : 'Google sign-in did not finish.'
      this.cancel()
      return page(400, `${this.connectError} You can close this tab.`)
    }
    try {
      const tok = await this.tokenRequest(f.client, { grant_type: 'authorization_code', code, redirect_uri: f.redirectUri, code_verifier: f.verifier })
      if (typeof tok.refresh_token !== 'string' || !tok.refresh_token) throw new GoogleError(502, 'Google sent no refresh token.')
      const granted = String(tok.scope ?? '').split(' ')
      if (!granted.includes(DRIVE_SCOPE)) throw new GoogleError(403, 'Drive access was not granted. Tick the Drive box when Google asks.')
      if (!f.live()) throw new GoogleError(409, 'This sign-in was cancelled in duckbook.')
      this.save({ refreshToken: tok.refresh_token, accessToken: tok.access_token, expiresAt: Date.now() + Number(tok.expires_in ?? 0) * 1000, connectedAt: new Date().toISOString() })
      this.log('sync: Google Drive connected')
      page(200, 'duckbook is connected to Google Drive. You can close this tab.')
    } catch (e) {
      this.connectError = (e as Error).message
      page(400, `${this.connectError} You can close this tab.`)
    } finally {
      this.cancel()
    }
  }

  private async tokenRequest(client: Client, params: Record<string, string>) {
    const body = new URLSearchParams({ client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), ...params })
    const res = await fetch(endpoints().tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT) })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.status === 400 && json.error === 'invalid_grant') {
      const a = this.account()
      if (a) this.save({ ...a, needsReconnect: true })
      throw new GoogleError(409, 'Google access has ended (revoked or expired). Connect again.')
    }
    if (!res.ok || typeof json.access_token !== 'string') throw new GoogleError(502, 'Google refused the sign-in or token refresh.')
    return json as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }
  }

  private async token(force = false) {
    const a = this.account()
    if (!a) throw new GoogleError(409, 'Google Drive is not connected.')
    if (!force && a.expiresAt - Date.now() > 60_000) return a.accessToken
    const client = readClient(this.dataDir)
    if (!client) throw new GoogleError(409, 'The Google OAuth client is missing.')
    const signOuts = this.signOuts
    const tok = await this.tokenRequest(client, { grant_type: 'refresh_token', refresh_token: a.refreshToken })
    if (signOuts !== this.signOuts || !this.account()) throw new GoogleError(409, 'Google Drive is not connected.')
    this.save({ ...a, accessToken: tok.access_token, expiresAt: Date.now() + Number(tok.expires_in ?? 0) * 1000, needsReconnect: false })
    return tok.access_token
  }

  /** A Drive call with a fresh token; one retry after a 401. */
  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(attempt > 0)
      let res: Response
      try {
        res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT) })
      } catch {
        throw new GoogleError(503, 'Google Drive is not reachable (offline?).')
      }
      if (res.status === 401 && attempt === 0) continue
      if (res.status === 403 || res.status === 429) throw new GoogleError(429, 'Google Drive is limiting requests; retrying later.')
      if (!res.ok) throw new GoogleError(502, `Google Drive answered ${res.status}.`)
      return res
    }
  }

  private async folderId(): Promise<string> {
    const a = this.account()
    if (a?.folderId) return a.folderId
    const ep = endpoints()
    const q = `name = '${FOLDER}' and mimeType = '${FOLDER_MIME}' and trashed = false`
    const found = (await (await this.call(`${ep.driveUrl}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`)).json()) as { files?: { id: string }[] }
    let id = found.files?.[0]?.id
    if (!id) {
      const made = await this.call(`${ep.driveUrl}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_MIME }) })
      id = ((await made.json()) as { id: string }).id
    }
    const latest = this.account()
    if (latest) this.save({ ...latest, folderId: id })
    return id
  }

  /** The Drive folder as a sync remote, or null while not connected. */
  remote(): Remote | null {
    if (!this.account()) return null
    const ep = endpoints()
    return {
      list: async (since?: string) => {
        const folder = await this.folderId()
        const out: RemoteFile[] = []
        let pageToken: string | undefined
        do {
          const q = `'${folder}' in parents and trashed = false${since ? ` and modifiedTime > '${since}'` : ''}`
          const params = new URLSearchParams({ q, fields: 'nextPageToken,files(id,name,modifiedTime)', pageSize: '1000', spaces: 'drive', ...(pageToken ? { pageToken } : {}) })
          const page = (await (await this.call(`${ep.driveUrl}/files?${params}`)).json()) as { files?: RemoteFile[]; nextPageToken?: string }
          out.push(...(page.files ?? []).map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })))
          pageToken = page.nextPageToken
        } while (pageToken)
        return out
      },
      read: async (file: RemoteFile) => Buffer.from(await (await this.call(`${ep.driveUrl}/files/${encodeURIComponent(file.id)}?alt=media`)).arrayBuffer()),
      create: async (name: string, data: Buffer, mime: string) => {
        const folder = await this.folderId()
        const boundary = `duckbook${randomBytes(8).toString('hex')}`
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
          data,
          Buffer.from(`\r\n--${boundary}--`),
        ])
        await this.call(`${ep.uploadUrl}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
      },
    }
  }

  /** Sign out: revoke the token at Google and forget it here. Files in Drive stay. */
  async disconnect() {
    this.signOuts++
    this.cancel()
    const a = this.account()
    if (!a) return
    try {
      await fetch(endpoints().revokeUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: a.refreshToken }), signal: AbortSignal.timeout(REQUEST_TIMEOUT) })
    } catch {
      this.log('sync: could not reach Google to revoke the token; forgotten here anyway')
    }
    fs.rmSync(this.file, { force: true })
  }
}
