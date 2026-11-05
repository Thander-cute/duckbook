// Takes the README screenshots from a throwaway server filled with made-up pages.
// Never points at a real notebook: the server runs in this process on a fresh temp folder and a
// free port it bound itself, so no request can reach another Duckbook server.
//
//   npm run build && node scripts/screenshots.ts
//
// Output: docs/images/{month,week,day,focus}.png

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Browser } from 'puppeteer-core'
import { API_LEVEL } from '../src/lib/schema.ts'
import { start } from '../server/main.ts'

const OUT = 'docs/images'
const browserPath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p))
if (!browserPath) throw new Error('No Chrome/Edge found.')

const reflection = (checkin = '') => ({ checkin, success: '', lesson: '', future: '', more: '', reviewed: false })
const week = { mon: '2026-10-19', days: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'] }

const sample = {
  version: 1,
  settings: { ink: 'hand', focusMin: 25, breakMin: 5, modules: { focusMap: true } },
  months: {
    '2026-10': {
      theme: 'Slow mornings, steady work',
      goals: [
        { text: 'Finish the garden bench', done: true },
        { text: 'Read two novels', done: false },
        { text: 'Cook something new each week', done: false },
      ],
      cells: {
        '2026-10-03': 'Market with Lan',
        '2026-10-09': 'Dentist 9:30',
        '2026-10-14': 'Piano lesson',
        '2026-10-21': 'Call grandma',
        '2026-10-28': 'Pay rent',
        '2026-10-31': 'Pumpkin soup night',
      },
      moods: { '2026-10-01': 4, '2026-10-02': 3, '2026-10-05': 5, '2026-10-06': 4, '2026-10-12': 2, '2026-10-19': 4, '2026-10-20': 5 },
      notes: 'Leaves are turning. Walk the long way home.',
    },
  },
  weeks: {
    [week.mon]: {
      goal: 'Ship the bench, rest on Sunday',
      notes: 'Buy wood oil before Thursday.',
      selfCare: 'An evening walk by the river',
      tasks: [
        { id: 'w1', text: 'Sand and oil the bench', q: 'A', done: false },
        { id: 'w2', text: 'Plan next month', q: 'B', done: false },
        { id: 'w3', text: 'Read 50 pages', q: 'B', done: true },
        { id: 'w4', text: 'Reply to the book club', q: 'C', done: false },
        { id: 'w5', text: 'Sort old photos', q: 'D', done: false },
      ],
      habits: [
        { id: 'h1', name: 'Stretch', days: [true, true, false, true, true, false, false] },
        { id: 'h2', name: 'No phone after 10', days: [true, false, true, true, false, false, false] },
        { id: 'h3', name: 'Water the plants', days: [true, false, false, true, false, false, false] },
      ],
      reflection: reflection('A calm week with one long evening of sanding.'),
    },
  },
  days: {
    [week.days[1]]: {
      grateful: 'Warm tea and a quiet street',
      notes: 'The oil needs two coats. Second coat tomorrow evening.',
      sentence: 'Sawdust everywhere, and a bench that finally stands straight.',
      tasks: [
        { id: 'd1', text: 'Sand and oil the bench', estimate: 3, pomos: 2, done: false, weekTaskId: 'w1' },
        { id: 'd2', text: 'Read 50 pages', estimate: 2, pomos: 2, done: true, weekTaskId: 'w3' },
        { id: 'd3', text: 'Buy wood oil', estimate: 1, pomos: 1, done: true },
      ],
    },
  },
  focus: {
    ideas: [
      { id: 'i1', text: 'Learn to bake bread', x: 0.3, y: 0.75, status: 'idea', date: null, createdAt: '2026-10-01T08:00:00.000Z' },
      { id: 'i2', text: 'Weekly long walk', x: 0.8, y: 0.8, status: 'doing', date: null, createdAt: '2026-10-02T08:00:00.000Z' },
      { id: 'i3', text: 'Fix the bike light', x: 0.85, y: 0.3, status: 'idea', date: null, createdAt: '2026-10-03T08:00:00.000Z' },
      { id: 'i4', text: 'Write letters to friends', x: 0.55, y: 0.6, status: 'idea', date: null, createdAt: '2026-10-04T08:00:00.000Z' },
      { id: 'i5', text: 'Repaint the hallway', x: 0.15, y: 0.35, status: 'idea', date: null, createdAt: '2026-10-05T08:00:00.000Z' },
      { id: 'i6', text: 'Try a pottery class', x: null, y: null, status: 'idea', date: null, createdAt: '2026-10-06T08:00:00.000Z' },
    ],
  },
  spans: { spans: [{ id: 's1', start: '2026-10-12', end: '2026-10-16', text: 'Visit to Da Lat', at: '2026-10-13' }] },
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-shots-'))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const headers = { 'X-Duckbook': '1', 'X-Duckbook-Api': String(API_LEVEL), 'Content-Type': 'application/json' }
let server: Awaited<ReturnType<typeof start>> | undefined
let browser: Browser | undefined

try {
  // Throws if it can't bind, so there is nothing else to fall back to.
  server = await start({ port: 0, dataDir, quiet: true })
  const BASE = `http://localhost:${server.port}`
  const health = await (await fetch(`${BASE}/api/health`, { headers })).json()
  if (health.pid !== process.pid) throw new Error('health check answered by another process')
  // No `replace`: the import refuses if the notebook already has pages.
  const res = await fetch(`${BASE}/api/import`, { method: 'POST', headers, body: JSON.stringify({ data: sample, source: 'file' }) })
  if (!res.ok) throw new Error(`import failed: ${res.status} ${await res.text()}`)

  browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-first-run'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 })
  await page.goto(BASE)
  await page.evaluate(() => localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus'])))
  fs.mkdirSync(OUT, { recursive: true })
  for (const [view, date] of [['month', week.mon], ['week', week.mon], ['day', week.days[1]], ['focus', week.mon]]) {
    await page.goto(`${BASE}/#/${view}/${date}`)
    await page.reload()
    await page.waitForSelector('[data-save]')
    await page.evaluate(() => document.fonts.ready)
    await sleep(400)
    await page.screenshot({ path: path.join(OUT, `${view}.png`) as `${string}.png` })
    console.log(`${OUT}/${view}.png`)
  }
} finally {
  await browser?.close().catch(() => {})
  await server?.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
}
