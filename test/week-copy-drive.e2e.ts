// The automatic week copy with Google Drive on (fake Drive): a new week waits for a sync that succeeded,
// and copies after one. Throwaway server with the fake Google, temp data dir, synthetic data only.
// Run: npm run build && node test/week-copy-drive.e2e.ts   (E2E_SHOTS=<folder> saves screenshots)
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { API_LEVEL } from '../src/lib/schema.ts'
import { startFakeGoogle } from './fake-google.ts'

const PORT = Number(process.env.DUCKBOOK_TEST_PORT ?? 5439)
const BASE = `http://localhost:${PORT}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-weekcopy-drive-e2e-'))
const shots = process.env.E2E_SHOTS ?? ''
if (shots) fs.mkdirSync(shots, { recursive: true })
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p))
if (!browserPath) throw new Error('No Chrome/Edge found for browser checks.')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const W2 = '2026-11-09'
const W3 = '2026-11-16'
const W4 = '2026-11-23'
const W5 = '2026-11-30'
const COPIED = ['synthetic A', 'synthetic B', 'synthetic C', 'synthetic D', 'synthetic work in a box', 'synthetic work unsorted']

const google = await startFakeGoogle()
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, ...google.env, DUCKBOOK_DATA_DIR: dataDir, DUCKBOOK_PORT: String(PORT) }, stdio: 'ignore' })
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`, { headers: { 'X-Duckbook': '1' } })).ok) break
  } catch {}
  if (i > 50) throw new Error('test server did not start')
  await sleep(100)
}
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, defaultViewport: { width: 1500, height: 1000 } })

const fixture = () => ({
  version: 1,
  settings: { ink: 'serif', focusMin: 25, breakMin: 5, modules: { focusMap: true, contacts: false, holidays: false, disc: false } },
  focus: {
    ideas: [
      { id: 'i-box', text: 'synthetic work in a box', x: 0.5, y: 0.5, status: 'doing', date: null, createdAt: '' },
      { id: 'i-loose', text: 'synthetic work unsorted', x: 0.2, y: 0.5, status: 'idea', date: null, createdAt: '' },
    ],
  },
  weeks: {
    [W2]: {
      goal: 'synthetic goal',
      notes: '',
      selfCare: 'synthetic walk',
      reflection: { checkin: '', success: '', lesson: '', future: '', more: '', reviewed: false },
      habits: [{ id: 'h1', name: 'synthetic habit', days: [true, false, false, false, false, false, false] }],
      tasks: [
        { id: 'a', text: 'synthetic A', q: 'A', done: false },
        { id: 'b', text: 'synthetic B', q: 'B', done: false },
        { id: 'c', text: 'synthetic C', q: 'C', done: false },
        { id: 'd', text: 'synthetic D', q: 'D', done: false },
        { id: 'wb', text: 'synthetic work in a box', q: 'B', done: false, ideaId: 'i-box' },
        { id: 'wl', text: 'synthetic work unsorted', q: null, done: false, ideaId: 'i-loose' },
      ],
    },
  },
})

const headers = { 'X-Duckbook': '1', 'X-Duckbook-Api': String(API_LEVEL), 'Content-Type': 'application/json' }
const call = (page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(
    async (method, url, body, headers) => {
      const r = await fetch(url, { method, headers, body })
      return { status: r.status, json: await r.json().catch(() => null) }
    },
    method,
    url,
    body === undefined ? undefined : JSON.stringify(body),
    headers,
  )
const doc = async (page: Page, key: string) => ((await call(page, 'GET', '/api/data')).json.docs as { key: string; value: any }[]).find((d) => d.key === key)?.value
const weekDoc = (page: Page, monday: string) => doc(page, `week:${monday}`)
const texts = (w: any) => (w ? w.tasks.map((t: any) => t.text).sort() : undefined)
const setToday = (page: Page, day: string) => page.evaluate((d) => localStorage.setItem('test:today', d), day)
const saved = async (page: Page) => {
  await sleep(50)
  await page.waitForSelector('[data-save="saved"]', { timeout: 5000 })
}
const open = async (page: Page, route: string, sel = '.topbar') => {
  await page.goto(`${BASE}/#/${route}`)
  await page.reload()
  await page.waitForSelector(sel)
}
const keepAll = async (page: Page) => {
  await page.click('.pencil-all')
  await saved(page)
}
const until = async (what: string, check: () => Promise<boolean>, ms = 8000) => {
  for (let t = 0; t < ms; t += 200) {
    if (await check()) return
    await sleep(200)
  }
  throw new Error(`timed out waiting for: ${what}`)
}
const newPage = async () => {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus', 'contacts']))
      const Real = Date
      const now = () => {
        const t = localStorage.getItem('test:today')
        return t ? new Real(`${t}T10:00:00`).getTime() : Real.now()
      }
      window.Date = class extends Real {
        constructor(...a: unknown[]) {
          if (a.length) super(...(a as [number]))
          else super(now())
        }
        static now() {
          return now()
        }
      } as DateConstructor
      const every = window.setInterval
      window.setInterval = ((f: () => void, ms: number) => every(f, ms === 60_000 ? 150 : ms)) as typeof window.setInterval
    } catch {}
  })
  return page
}
/** Settings → Planning. The copy switch is set to `want`; returns the note the row shows, if any. */
async function planning(page: Page, want?: boolean, shot?: string) {
  await page.click('button[aria-label="Settings"]')
  await (await page.waitForSelector('xpath/.//button[contains(@class,"sd-tab") and normalize-space(.)="Planning"]'))!.click()
  const sw = 'input[role="switch"][aria-label="Copy the plan into each new week"]'
  await page.waitForSelector(sw)
  if (want !== undefined && (await page.$eval(sw, (e) => (e as HTMLInputElement).checked)) !== want) {
    await page.click(sw)
    await saved(page)
  }
  const note = await page.$eval('.copy-waiting', (e) => e.textContent).catch(() => null)
  if (shots && shot) {
    await sleep(400)
    await page.screenshot({ path: path.join(shots, `${shot}.png`) as `${string}.png` })
  }
  await page.click('.sd-close')
  await page.waitForSelector('.settings', { hidden: true })
  return note
}

const page = await newPage()
try {
  await page.goto(`${BASE}/#/week/${W2}`)
  await page.reload()
  await page.waitForSelector('.topbar')
  // The notebook joins a fresh fake Drive, the way the Data settings do it.
  const { authUrl } = (await call(page, 'POST', '/api/sync/connect')).json as { authUrl: string }
  assert.equal(await google.approve(authUrl), 200)
  assert.equal((await call(page, 'POST', '/api/import', { data: fixture(), source: 'file', replace: true })).status, 200)
  const join = await call(page, 'POST', '/api/sync/join', { mode: 'start' })
  assert.equal(join.status, 200, JSON.stringify(join.json))
  assert.equal(join.json.joined !== null, true)
  await setToday(page, W2)
  await open(page, `week/${W2}`, '.week-plan')
  await planning(page, true)
  assert.equal((await doc(page, 'settings')).autoCopiedWeek, W2)
  console.log('ok - joined Drive, switch on')

  await step('Drive down: a new week waits for a sync, copies nothing, and the Planning settings say so', async () => {
    google.setDown(true)
    const r = await call(page, 'POST', '/api/sync/now', {})
    assert.equal(r.status, 503, 'a failed sync is not a success')
    assert.equal(r.json.synced, false)
    await setToday(page, W3)
    await open(page, `week/${W3}`, '.week-plan')
    await sleep(800)
    assert.equal(await weekDoc(page, W3), undefined, 'nothing copied while the sync fails')
    assert.equal((await doc(page, 'settings')).autoCopiedWeek, W2, 'not marked done')
    assert.equal(await page.$('.banner.is-warn'), null, 'waiting is not a failure banner')
    const note = await planning(page, undefined, 'drive-1-settings-waiting')
    assert.match(note!, /waiting for a sync with Drive/)
  })

  await step('Drive back: the next focus runs one sync that succeeds, then copies once', async () => {
    google.setDown(false)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await until('the copy of the new week', async () => (texts(await weekDoc(page, W3)) ?? []).length > 0)
    await saved(page)
    assert.deepEqual(texts(await weekDoc(page, W3)), COPIED)
    assert.equal((await doc(page, 'settings')).autoCopiedWeek, W3)
    assert.equal(await planning(page), null, 'the waiting note is gone')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await sleep(800)
    assert.deepEqual(texts(await weekDoc(page, W3)), COPIED, 'a second focus adds nothing')
  })

  await step('Drive down on the week page: the week says the automatic copy waits, and keep all still works by hand', async () => {
    google.setDown(true)
    await setToday(page, W4)
    await open(page, `week/${W4}`, '.week-plan')
    await until('the week says it waits', async () => (await page.$('.pencil-wait')) !== null)
    assert.equal(await page.$eval('.pencil-wait', (e) => e.textContent), 'Automatic copy is waiting for a Drive sync')
    assert.equal(await weekDoc(page, W4), undefined, 'waiting copies nothing')
    if (shots) {
      await sleep(400)
      await page.screenshot({ path: path.join(shots, 'drive-2-week-waiting.png') })
    }
    await keepAll(page)
    assert.deepEqual(texts(await weekDoc(page, W4)), COPIED, 'by hand, Drive down: the lines are kept')
    assert.equal((await doc(page, 'settings')).autoCopiedWeek, W3, 'keeping by hand does not end the automatic copy')
    assert.notEqual(await page.$('.pencil-wait'), null, 'still waiting: the automatic copy has not run yet')
    google.setDown(false)
  })

  await step('switching the copy off clears the waiting note, even while Drive is still down', async () => {
    google.setDown(true)
    await setToday(page, W5)
    await open(page, `week/${W5}`, '.week-plan')
    await sleep(800)
    assert.match((await planning(page))!, /waiting/)
    assert.equal(await planning(page, false), null, 'switched off: no note')
    assert.equal(await weekDoc(page, W5), undefined)
    google.setDown(false)
  })

  console.log('all passed')
} catch (e) {
  console.log(`FAIL: ${(e as Error).stack}`)
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
  await google.stop()
  await sleep(300)
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

async function step(name: string, fn: () => Promise<void>) {
  await fn()
  console.log(`ok - ${name}`)
}
