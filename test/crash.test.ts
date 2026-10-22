import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { API_LEVEL } from '../src/lib/schema.ts'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port
      s.close(() => resolve(p))
    })
  })

async function boot(dataDir: string, port: number) {
  const child = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, DUCKBOOK_DATA_DIR: dataDir, DUCKBOOK_PORT: String(port) }, stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`, { headers: { 'X-Duckbook': '1' } })
      if (r.ok) return child
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  child.kill('SIGKILL')
  throw new Error('server did not start')
}

test('server killed mid-write: database stays intact and holds the last acknowledged save', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-crash-'))
  const port = await freePort()
  try {
    let child = await boot(dataDir, port)
    const url = `http://localhost:${port}/api/docs`
    let rev = 0
    let acked = -1
    let stop = false
    const writer = (async () => {
      for (let i = 0; !stop; i++) {
        try {
          const r = await fetch(url, {
            method: 'PUT',
            headers: { 'X-Duckbook': '1', 'X-Duckbook-Api': String(API_LEVEL), 'Content-Type': 'application/json' },
            body: JSON.stringify({ changes: [{ key: 'day:2026-10-19', baseRev: rev, value: { grateful: '', tasks: [], notes: `n=${i} ${'x'.repeat(2000)}`, sentence: '' } }] }),
          })
          if (!r.ok) break
          rev = ((await r.json()) as any).revs['day:2026-10-19']
          acked = i
        } catch {
          break
        }
      }
    })()
    await new Promise((r) => setTimeout(r, 700))
    child.kill('SIGKILL')
    stop = true
    await writer
    assert.ok(acked > 5, `made progress before the kill (${acked} writes)`)

    const db = new DatabaseSync(path.join(dataDir, 'duckbook.sqlite'))
    assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok')
    db.close()

    child = await boot(dataDir, port)
    const docs = ((await (await fetch(`http://localhost:${port}/api/data`, { headers: { "X-Duckbook": "1" } })).json()) as any).docs
    const n = Number(/^n=(\d+)/.exec(docs[0].value.notes)![1])
    assert.ok(n === acked || n === acked + 1, `saved value n=${n} is the last acknowledged (${acked}) or the one in flight`)
    child.kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 200))
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
