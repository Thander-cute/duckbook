// Browser check of Google Drive sync: two throwaway servers (ports 5397/5398, temp data dirs,
// synthetic text) and a fake Google. Run: npm run build && node test/sync.e2e.ts

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { startFakeGoogle } from './fake-google.ts'

const shots = process.env.E2E_SHOTS ?? ''
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p))
if (!browserPath) throw new Error('No Chrome/Edge found for browser checks.')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function server(port: number, env: Record<string, string>) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-sync-e2e-'))
  const proc: ChildProcess = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, ...env, DUCKBOOK_DATA_DIR: dataDir, DUCKBOOK_PORT: String(port) }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/health`, { headers: { 'X-Duckbook': '1' } })).ok) break
    } catch {}
    await sleep(100)
  }
  return { base: `http://localhost:${port}`, dataDir, stop: () => (proc.kill(), sleep(300)) }
}

const shot = async (page: Page, name: string) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }))
const button = async (page: Page, text: string) => {
  const b = await page.waitForSelector(`xpath/.//button[contains(., "${text}")]`)
  await b!.click()
}
async function openData(page: Page) {
  await page.click('button[aria-label="Settings"]')
  const tab = await page.waitForSelector('xpath/.//button[contains(@class,"sd-tab") and normalize-space(.)="Data"]')
  await tab!.click()
  await page.waitForSelector('.sync-setting')
}

async function main() {
  const google = await startFakeGoogle()
  const a = await server(5397, google.env)
  const b = await server(5398, google.env)
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true })
  const errors: string[] = []
  try {
    const open = async (base: string) => {
      const page = await browser.newPage()
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus']))
        // Google's page would open in a new window; the test approves it instead.
        window.open = ((url: string) => void ((window as unknown as { authUrl: string }).authUrl = url)) as unknown as typeof window.open
      })
      await page.setViewport({ width: 1440, height: 900 })
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(`${base}/#/day/2026-10-28`)
      await page.waitForSelector('.day-page')
      return page
    }
    const connect = async (page: Page) => {
      await openData(page)
      await shot(page, `sync-00-${page.url().includes('5397') ? 'a' : 'b'}-off`)
      const links = await page.$$eval('.sync-links a', (as) => as.map((a) => [a.textContent, (a as HTMLAnchorElement).href, (a as HTMLAnchorElement).target]))
      assert.deepEqual(links, [['Privacy policy', 'https://duckbook.khoadev.id.vn/privacy', '_blank'], ['Terms', 'https://duckbook.khoadev.id.vn/terms', '_blank']])
      await button(page, 'Connect')
      const url = await page.waitForFunction(() => (window as unknown as { authUrl?: string }).authUrl).then((h) => h.jsonValue() as Promise<string>)
      await page.waitForSelector('xpath/.//p[contains(., "Finish signing in")]')
      await shot(page, 'sync-01-waiting')
      assert.equal(await google.approve(url), 200)
      await page.waitForSelector('xpath/.//div[@class="sd-row-title" and .="Google account"]', { timeout: 10_000 })
    }

    const pa = await open(a.base)
    await pa.click('.day-page .line textarea', { count: 3 })
    await pa.keyboard.type('synthetic gratitude from A')
    await pa.waitForSelector('[data-save="saved"]')
    await connect(pa)
    await shot(pa, 'sync-02-connected')
    await button(pa, 'Start syncing')
    await pa.waitForSelector('xpath/.//p[contains(., "Synced")]', { timeout: 10_000 })
    await shot(pa, 'sync-03-on')
    console.log('ok - A connects Google and starts syncing')

    const pb = await open(b.base)
    await pb.click('.day-page .page-foot textarea')
    await pb.keyboard.type('synthetic sentence only on B')
    await pb.waitForSelector('[data-save="saved"]')
    await connect(pb)
    await shot(pb, 'sync-04-drive-has-notebook')
    await button(pb, 'Merge both instead')
    await shot(pb, 'sync-05-merge')
    await button(pb, 'Cancel')
    await button(pb, 'Use Drive’s notebook')
    await pb.waitForSelector('xpath/.//p[contains(., "Synced")]', { timeout: 10_000 })
    await pb.click('button[aria-label="Close settings"]')
    await pb.waitForFunction(() => (document.querySelector('.day-page .line textarea') as HTMLTextAreaElement)?.value === 'synthetic gratitude from A')
    console.log('ok - B takes the notebook from Drive and shows A’s page')

    await pb.click('.day-page .line textarea')
    await pb.keyboard.press('End')
    await pb.keyboard.type(', and B')
    await pb.waitForSelector('[data-save="saved"]')
    await sleep(6000) // B pushes a few seconds after saving
    await pa.bringToFront()
    await pa.click('button[aria-label="Close settings"]')
    // Coming back to A's window asks for a sync; A then picks up the page.
    await pa.evaluate(() => window.dispatchEvent(new Event('focus')))
    await pa.waitForFunction(() => (document.querySelector('.day-page .line textarea') as HTMLTextAreaElement)?.value === 'synthetic gratitude from A, and B', { timeout: 30_000 })
    await shot(pa, 'sync-06-from-b')
    console.log('ok - an edit on B reaches A’s open page')
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await a.stop()
    await b.stop()
    await google.stop()
    for (const d of [a.dataDir, b.dataDir]) fs.rmSync(d, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
