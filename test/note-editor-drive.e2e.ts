// A formatted Day note edited on two devices synced through Google Drive (fake Google): one device
// bolds a word while the other writes at the end of the note, and both edits end up on both, with the
// writer's cursor left where it was. Two throwaway servers, temp data dirs, synthetic data only.
// Run: npm run build && node test/note-editor-drive.e2e.ts   (E2E_SHOTS=<folder> saves screenshots)
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { API_LEVEL } from '../src/lib/schema.ts'
import { startFakeGoogle } from './fake-google.ts'

const PORT_A = Number(process.env.DUCKBOOK_TEST_PORT ?? 5444)
const PORT_B = PORT_A + 1
const shots = process.env.E2E_SHOTS ?? ''
if (shots) fs.mkdirSync(shots, { recursive: true })
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p))
if (!browserPath) throw new Error('No Chrome/Edge found for browser checks.')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const DAY = '2026-11-18'
const ED = '.day-page .note-editor'
const NOTE = 'Một ghi chú chung trên hai máy\nDòng hai'

async function server(port: number, env: Record<string, string>) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-note-drive-e2e-'))
  const proc: ChildProcess = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, ...env, DUCKBOOK_DATA_DIR: dataDir, DUCKBOOK_PORT: String(port) }, stdio: 'ignore' })
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/health`, { headers: { 'X-Duckbook': '1' } })).ok) break
    } catch {}
    if (i > 50) throw new Error('test server did not start')
    await sleep(100)
  }
  return { base: `http://localhost:${port}`, dataDir, stop: () => (proc.kill(), sleep(300)) }
}

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
const stored = async (page: Page) => ((await call(page, 'GET', '/api/data')).json.docs as { key: string; value: any }[]).find((d) => d.key === `day:${DAY}`)!.value.notes as string
const storedBecomes = async (page: Page, want: string) => {
  let got = ''
  for (let t = 0; t < 8000; t += 100) {
    if ((got = await stored(page)) === want) return
    await sleep(100)
  }
  assert.equal(got, want, 'the stored note')
}
const syncNow = async (page: Page) => {
  const r = await call(page, 'POST', '/api/sync/now', {})
  assert.equal(r.status, 200, JSON.stringify(r.json))
}
const shot = async (page: Page, name: string) => {
  if (!shots) return
  await sleep(400)
  await (await page.$('.day-page'))!.screenshot({ path: path.join(shots, `${name}.png`) as `${string}.png` })
}
const step = async (name: string, fn: () => Promise<void>) => {
  await fn()
  console.log(`ok - ${name}`)
}

const google = await startFakeGoogle()
const a = await server(PORT_A, google.env)
const b = await server(PORT_B, google.env)
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, defaultViewport: { width: 1500, height: 1000 } })
const errors: string[] = []
try {
  const open = async (base: string) => {
    const page = await browser.newPage()
    await page.evaluateOnNewDocument(() => localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus', 'contacts'])))
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${base}/#/day/${DAY}`)
    await page.waitForSelector('.topbar')
    return page
  }
  const join = async (page: Page, mode: 'start' | 'replace') => {
    const { authUrl } = (await call(page, 'POST', '/api/sync/connect')).json as { authUrl: string }
    assert.equal(await google.approve(authUrl), 200)
    const r = await call(page, 'POST', '/api/sync/join', { mode })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    await page.reload()
    await page.waitForSelector(`${ED}.ProseMirror`)
  }

  const pa = await open(a.base)
  const pb = await open(b.base)
  await step('both devices hold the same note through Drive', async () => {
    const data = { version: 1, settings: { ink: 'serif', focusMin: 25, breakMin: 5 }, days: { [DAY]: { grateful: '', notes: NOTE, sentence: '', tasks: [] } } }
    assert.equal((await call(pa, 'POST', '/api/import', { data, source: 'file', replace: true })).status, 200)
    await join(pa, 'start')
    await join(pb, 'replace')
    assert.equal(await stored(pb), NOTE)
    assert.equal(await pb.$eval(ED, (e) => e.textContent), NOTE.replace('\n', ''))
  })

  await step('A bolds a word while B writes at the end; after syncing both have both, and B’s cursor stays put', async () => {
    // A selects "chung" and bolds it.
    await pa.bringToFront()
    await pa.click(ED)
    await pa.evaluate((sel) => {
      const t = document.querySelector(sel)!.querySelector('p')!.firstChild!
      const at = t.textContent!.indexOf('chung')
      const r = document.createRange()
      r.setStart(t, at)
      r.setEnd(t, at + 5)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(r)
    }, ED)
    await sleep(80)
    await pa.keyboard.down('Control')
    await pa.keyboard.press('b')
    await pa.keyboard.up('Control')
    await storedBecomes(pa, 'Một ghi chú **chung** trên hai máy\nDòng hai')

    // B writes at the end of the second line and keeps writing there.
    await pb.bringToFront()
    await pb.click(ED)
    await pb.keyboard.down('Control')
    await pb.keyboard.press('End')
    await pb.keyboard.up('Control')
    await sleep(50)
    await pb.keyboard.type(' từ B')
    await storedBecomes(pb, 'Một ghi chú chung trên hai máy\nDòng hai từ B')

    await syncNow(pa)
    await syncNow(pb)
    await syncNow(pa)

    // B's open page picks up A's bold without leaving the note.
    await pb.evaluate(() => window.dispatchEvent(new Event('focus')))
    await pb.waitForFunction((sel) => document.querySelector(sel)?.querySelector('strong')?.textContent === 'chung', { timeout: 15_000 }, ED)
    assert.equal(await pb.evaluate((sel) => document.activeElement === document.querySelector(sel), ED), true, 'B is still writing in the note')
    await pb.keyboard.type('!')
    const both = 'Một ghi chú **chung** trên hai máy\nDòng hai từ B!'
    await storedBecomes(pb, both)
    await shot(pb, 'drive-b')

    await syncNow(pb)
    await syncNow(pa)
    await pa.bringToFront()
    await pa.evaluate(() => window.dispatchEvent(new Event('focus')))
    await pa.waitForFunction((sel) => document.querySelector(sel)?.textContent?.endsWith('từ B!'), { timeout: 15_000 }, ED)
    assert.equal(await stored(pa), both)
    assert.deepEqual(await pa.$$eval(`${ED} strong`, (x) => x.map((e) => e.textContent)), ['chung'])
    await shot(pa, 'drive-a')
  })

  assert.deepEqual(errors, [])
  console.log('note editor on two devices: all checks passed')
} finally {
  await browser.close()
  await a.stop()
  await b.stop()
  await google.stop()
  for (const d of [a.dataDir, b.dataDir]) fs.rmSync(d, { recursive: true, force: true })
}
