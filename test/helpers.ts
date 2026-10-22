import fs from 'node:fs'
import { API_LEVEL } from '../src/lib/schema.ts'
import os from 'node:os'
import path from 'node:path'
import { start } from '../server/main.ts'

/** Synthetic planner data in the legacy localStorage shape. No real user content. */
export function fixtureLegacy() {
  return {
    version: 1,
    settings: { ink: 'hand', focusMin: 25, breakMin: 5 },
    months: {
      '2026-10': {
        theme: 'fixture theme',
        goals: [{ text: 'fixture goal one', done: true }, { text: 'fixture goal two', done: false }, { text: '', done: false }],
        cells: { '2026-10-05': 'fixture cell' },
        moods: { '2026-10-01': 3, '2026-10-02': 5 },
        notes: 'fixture month notes',
      },
    },
    weeks: {
      '2026-10-19': {
        goal: 'fixture week goal',
        notes: 'fixture week notes',
        selfCare: 'fixture walk',
        tasks: [
          { id: 'wt1', text: 'fixture task A', q: 'A', done: false },
          { id: 'wt2', text: 'fixture unsorted', q: null, done: false },
        ],
        habits: [{ id: 'h1', name: 'fixture habit', days: [true, false, false, false, false, false, false] }],
        reflection: { checkin: 'fixture checkin', success: '', lesson: '', future: '', more: '', reviewed: false },
      },
    },
    days: {
      '2026-10-19': {
        grateful: 'fixture gratitude',
        notes: 'fixture day notes',
        sentence: 'fixture sentence',
        tasks: [{ id: 'dt1', text: 'fixture day task', estimate: 2, pomos: 1, done: false, weekTaskId: 'wt1' }],
      },
    },
  }
}

export async function startTestServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-test-'))
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-dist-'))
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>duckbook test</title>')
  const srv = await start({ port: 0, dataDir, distDir, quiet: true })
  const base = `http://localhost:${srv.port}`
  let cookie = ''

  async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        'X-Duckbook': '1',
        'X-Duckbook-Api': String(API_LEVEL),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
    const text = await res.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
    return { status: res.status, json }
  }

  return {
    ...srv,
    base,
    call,
    dropCookie: () => (cookie = ''),
    cleanup: async () => {
      await srv.stop()
      fs.rmSync(dataDir, { recursive: true, force: true })
      fs.rmSync(distDir, { recursive: true, force: true })
    },
  }
}
