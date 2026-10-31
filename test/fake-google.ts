// A stand-in for Google's OAuth and Drive endpoints, enough for sync tests. In memory, loopback only.

import http from 'node:http'

interface File { id: string; name: string; mimeType: string; parents: string[]; data: Buffer; modifiedTime: string }

export async function startFakeGoogle() {
  const files = new Map<string, File>()
  let next = 1
  let tokens = 0
  const live = new Set<string>()
  let requests = 0

  const server = http.createServer(async (req, res) => {
    requests++
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks)
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(v))
    }
    if (url.pathname === '/token') {
      const p = new URLSearchParams(body.toString())
      if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'good-code' && p.get('code_verifier')) {
        const at = `at${++tokens}`
        live.add(at)
        return json(200, { access_token: at, refresh_token: 'rt-fixture', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' })
      }
      if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'rt-fixture') {
        const at = `at${++tokens}`
        live.add(at)
        return json(200, { access_token: at, expires_in: 3600 })
      }
      return json(400, { error: 'invalid_grant' })
    }
    if (url.pathname === '/revoke') return json(200, {})
    const auth = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    if (!live.has(auth)) return json(401, { error: 'unauthenticated' })

    if (req.method === 'GET' && url.pathname === '/drive/files') {
      const q = url.searchParams.get('q') ?? ''
      let list = [...files.values()]
      const byName = /name = '([^']+)' and mimeType = '([^']+)'/.exec(q)
      if (byName) list = list.filter((f) => f.name === byName[1] && f.mimeType === byName[2])
      const parent = /'([^']+)' in parents/.exec(q)
      if (parent) list = list.filter((f) => f.parents.includes(parent[1]))
      const since = /modifiedTime > '([^']+)'/.exec(q)
      if (since) list = list.filter((f) => f.modifiedTime > since[1])
      // Two files per page, to exercise paging.
      const start = Number(url.searchParams.get('pageToken') ?? 0)
      const page = list.slice(start, start + 2)
      return json(200, { files: page.map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })), ...(start + 2 < list.length ? { nextPageToken: String(start + 2) } : {}) })
    }
    if (req.method === 'POST' && url.pathname === '/drive/files') {
      const meta = JSON.parse(body.toString())
      const f: File = { id: `f${next++}`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? [], data: Buffer.alloc(0), modifiedTime: new Date().toISOString() }
      files.set(f.id, f)
      return json(200, { id: f.id })
    }
    const media = /^\/drive\/files\/([^/]+)$/.exec(url.pathname)
    if (req.method === 'GET' && media && url.searchParams.get('alt') === 'media') {
      const f = files.get(decodeURIComponent(media[1]))
      if (!f) return json(404, {})
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      return res.end(f.data)
    }
    if (req.method === 'POST' && url.pathname === '/upload/files' && url.searchParams.get('uploadType') === 'multipart') {
      const boundary = /boundary=(\S+)/.exec(req.headers['content-type'] ?? '')![1]
      const text = body.toString('latin1')
      const parts = text.split(`--${boundary}`).slice(1, -1)
      const content = (part: string) => part.slice(part.indexOf('\r\n\r\n') + 4, part.length - 2)
      const meta = JSON.parse(Buffer.from(content(parts[0]), 'latin1').toString('utf8'))
      const f: File = { id: `f${next++}`, name: meta.name, mimeType: 'file', parents: meta.parents ?? [], data: Buffer.from(content(parts[1]), 'latin1'), modifiedTime: new Date().toISOString() }
      files.set(f.id, f)
      return json(200, { id: f.id })
    }
    json(404, { error: 'not found' })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return {
    base,
    files,
    requests: () => requests,
    env: {
      DUCKBOOK_GOOGLE_CLIENT_ID: 'fixture-client',
      DUCKBOOK_GOOGLE_AUTH_URL: `${base}/auth`,
      DUCKBOOK_GOOGLE_TOKEN_URL: `${base}/token`,
      DUCKBOOK_GOOGLE_REVOKE_URL: `${base}/revoke`,
      DUCKBOOK_GOOGLE_DRIVE_URL: `${base}/drive`,
      DUCKBOOK_GOOGLE_UPLOAD_URL: `${base}/upload`,
    },
    /** Act as the person approving access in their browser. */
    async approve(authUrl: string) {
      const u = new URL(authUrl)
      const back = new URL(u.searchParams.get('redirect_uri')!)
      back.searchParams.set('code', 'good-code')
      back.searchParams.set('state', u.searchParams.get('state')!)
      return (await fetch(back)).status
    },
    stop: () => new Promise((r) => (server.close(r), server.closeAllConnections())),
  }
}
