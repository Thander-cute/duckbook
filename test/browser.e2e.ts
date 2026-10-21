// Browser checks against a throwaway server (port 5399, temp data dir, synthetic data only).
// Run: npm run build && npm run test:browser   (uses the locally installed Chrome or Edge)

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { fixtureLegacy } from './helpers.ts'

const PORT = 5399
const BASE = `http://localhost:${PORT}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-e2e-'))
const shots = process.env.E2E_SHOTS ?? ''
const browserPath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p))
if (!browserPath) throw new Error('No Chrome/Edge found for browser checks.')

let server: ChildProcess
async function startServer() {
  server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, DUCKBOOK_DATA_DIR: dataDir, DUCKBOOK_PORT: String(PORT) }, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`, { headers: { 'X-Duckbook': '1' } })).ok) return
    } catch {}
    await sleep(100)
  }
  throw new Error('test server did not start')
}
const stopServer = async () => {
  server.kill()
  await sleep(300)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const results: string[] = []
async function step(name: string, fn: () => Promise<void>) {
  await fn()
  results.push(`ok - ${name}`)
  console.log(`ok - ${name}`)
}

const textOf = (page: Page) => page.evaluate(() => document.body.innerText + [...document.querySelectorAll('textarea, input')].map((e) => (e as HTMLInputElement).value).join(' '))
const valueOf = (page: Page, sel: string) => page.$eval(sel, (e) => (e as HTMLTextAreaElement).value)
const waitSaved = (page: Page, timeout = 5000) => page.waitForSelector('[data-save="saved"]', { timeout })
async function typeInto(page: Page, sel: string, text: string) {
  await page.click(sel, { count: 3 })
  await page.keyboard.type(text)
}
async function openSettings(page: Page) {
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.settings')
}
const shot = async (page: Page, name: string) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }))

const errors: string[] = []

async function main() {
  await startServer()
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    page.on('console', (m) => m.type() === 'error' && !/401|409|Failed to load resource/.test(m.text()) && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))

    await step('legacy pages are offered for moving, not hidden behind an empty notebook', async () => {
      await page.goto(`${BASE}/#/day/2026-10-19`)
      await page.evaluate((raw) => localStorage.setItem('duckbook:v1', raw), JSON.stringify(fixtureLegacy()))
      await page.reload()
      await page.waitForSelector('.lock-card.wide')
      const t = await textOf(page)
      assert.match(t, /1 day, 1 week, 1 month/)
      assert.doesNotMatch(t, /fixture gratitude/, 'no journal content shown before moving')
      await shot(page, '01-migration')
    })

    await step('move: verified copy, old browser key kept', async () => {
      const [btn] = await page.$$('xpath/.//button[contains(., "Move my pages")]')
      await btn.click()
      await page.waitForFunction(() => document.body.innerText.includes('Moved and verified'))
      await shot(page, '02-migrated')
      const [open] = await page.$$('xpath/.//button[contains(., "Open my notebook")]')
      await open.click()
      await page.waitForSelector('.day-page')
      assert.equal(await valueOf(page, '.day-page .line textarea'), 'fixture gratitude')
      assert.ok(await page.evaluate(() => localStorage.getItem('duckbook:v1') !== null), 'legacy key retained')
    })

    await step('edits save to the database and survive reload', async () => {
      await typeInto(page, '.day-page .line textarea', 'saved through the server')
      await waitSaved(page)
      await page.reload()
      await page.waitForSelector('.day-page')
      assert.equal(await valueOf(page, '.day-page .line textarea'), 'saved through the server')
    })

    await step('server down: visible "Not saved", then saves once it is back', async () => {
      await stopServer()
      await typeInto(page, '.page-foot textarea', 'written while offline')
      await page.waitForSelector('.save-status.is-error', { timeout: 5000 })
      await page.waitForSelector('.banner.is-warn')
      await shot(page, '03-offline')
      await startServer()
      await waitSaved(page, 40_000)
      const r = await fetch(`${BASE}/api/data`, { headers: { 'X-Duckbook': '1' } })
      const docs = ((await r.json()) as { docs: { key: string; value: { sentence: string } }[] }).docs
      assert.equal(docs.find((d) => d.key === 'day:2026-10-19')!.value.sentence, 'written while offline')
    })

    await step('another writer changed the page: conflict banner, nothing overwritten', async () => {
      await page.evaluate(async () => {
        const data = (await (await fetch('/api/data', { headers: { 'X-Duckbook': '1' } })).json()) as { docs: { key: string; rev: number; value: object }[] }
        const d = data.docs.find((x) => x.key === 'day:2026-10-19')!
        await fetch('/api/docs', {
          method: 'PUT',
          headers: { 'X-Duckbook': '1', 'Content-Type': 'application/json' },
          body: JSON.stringify({ changes: [{ key: d.key, baseRev: d.rev, value: { ...d.value, notes: 'from elsewhere' } }] }),
        })
      })
      await typeInto(page, '.page-foot textarea', 'this tab edit')
      await page.waitForSelector('.save-status.is-conflict', { timeout: 5000 })
      await shot(page, '04-conflict')
      const [use] = await page.$$('xpath/.//button[contains(., "Use the saved version")]')
      await use.click()
      await page.waitForFunction(() => (document.querySelector('.day-page textarea.notes') as HTMLTextAreaElement)?.value === 'from elsewhere')
      await waitSaved(page)
    })

    await step('second tab sees saves from the first', async () => {
      const page2 = await browser.newPage()
      await page2.setViewport({ width: 1440, height: 900 })
      await page2.goto(`${BASE}/#/day/2026-10-19`)
      await page2.waitForSelector('.day-page')
      await page.bringToFront()
      await typeInto(page, '.day-page .line textarea', 'typed in tab one')
      await waitSaved(page)
      await page2.waitForFunction(() => (document.querySelector('.day-page .line textarea') as HTMLTextAreaElement).value === 'typed in tab one', { timeout: 5000 })
      await page2.close()
      await page.bringToFront()
    })

    await step('backup, change, restore from Settings: pages come back exactly', async () => {
      await openSettings(page)
      const [now] = await page.$$('xpath/.//button[contains(., "Back up now")]')
      await now.click()
      await page.waitForFunction(() => document.body.innerText.includes('Backup saved and verified'))
      await page.click('button[aria-label="Close"]')
      await typeInto(page, '.day-page .line textarea', 'changed after backup')
      await waitSaved(page)
      await openSettings(page)
      await page.waitForSelector('.backup-list li:first-child .text-link')
      await page.click('.backup-list li:first-child .text-link')
      const [restore] = await page.$$('xpath/.//li//button[normalize-space(.)="Restore"]')
      await restore.click()
      await page.waitForFunction(() => document.body.innerText.includes('Restored and verified'))
      await shot(page, '05-restored')
      await page.click('button[aria-label="Close"]')
      assert.equal(await valueOf(page, '.day-page .line textarea'), 'typed in tab one')
    })

    await step('import rejects a non-duckbook file without touching pages', async () => {
      const bad = path.join(dataDir, 'not-duckbook.json')
      fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }))
      await openSettings(page)
      const input = await page.$('.settings input[type=file]')
      await input!.uploadFile(bad)
      await page.waitForFunction(() => /not duckbook data|No months/.test(document.querySelector('.settings')!.textContent!))
      await page.click('button[aria-label="Close"]')
      assert.equal(await valueOf(page, '.day-page .line textarea'), 'typed in tab one')
    })

    await step('PIN lock: blank shell, no journal in the DOM, API refuses', async () => {
      await openSettings(page)
      const [set] = await page.$$('xpath/.//button[contains(., "Set a 6-digit PIN")]')
      await set.click()
      const fields = await page.$$('.pin-field input')
      await fields[0].type('246810')
      await fields[1].type('246810')
      const [save] = await page.$$('xpath/.//button[contains(., "Save PIN")]')
      await save.click()
      await page.waitForFunction(() => document.body.innerText.includes('PIN saved'))
      await page.click('button[aria-label="Close"]')
      await page.click('button[aria-label="Lock"]')
      await page.waitForSelector('.lock-shell .pin-dots')
      await shot(page, '06-locked')
      const t = await textOf(page)
      assert.doesNotMatch(t, /typed in tab one|fixture|from elsewhere/)
      assert.equal(await page.$$eval('textarea', (x) => x.length), 0)
      assert.equal(await page.title(), 'duckbook')
      const status = await page.evaluate(async () => (await fetch('/api/data', { headers: { 'X-Duckbook': '1' } })).status)
      assert.equal(status, 401)
      await page.reload()
      await page.waitForSelector('.lock-shell .pin-dots')
      assert.doesNotMatch(await textOf(page), /typed in tab one/, 'still locked after reload')
    })

    await step('wrong PIN is refused; right PIN opens the notebook', async () => {
      await page.keyboard.type('111111')
      await page.waitForFunction(() => document.querySelector('.lock-error')!.textContent!.includes('Wrong PIN'))
      await page.keyboard.type('246810')
      await page.waitForSelector('.day-page')
      assert.equal(await valueOf(page, '.day-page .line textarea'), 'typed in tab one')
    })

    await step('old browser copy can be removed after the verified move', async () => {
      await openSettings(page)
      const [rm] = await page.$$('xpath/.//button[contains(., "Remove old copy")]')
      await rm.click()
      const [yes] = await page.$$('xpath/.//div[contains(@class,"confirm-box")]//button[normalize-space(.)="Remove"]')
      await yes.click()
      assert.equal(await page.evaluate(() => localStorage.getItem('duckbook:v1')), null)
      await page.click('button[aria-label="Close"]')
    })

    assert.deepEqual(errors, [], 'no console errors (including CSP)')
    console.log(`\n${results.length} browser checks passed`)
  } finally {
    await browser.close()
    await stopServer()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

main().catch(async (e) => {
  console.error('FAILED:', e)
  try {
    server?.kill()
  } catch {}
  process.exit(1)
})
