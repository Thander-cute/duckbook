// Browser checks against a throwaway server (port 5399, temp data dir, synthetic data only).
// Run: npm run build && npm run test:browser   (uses the locally installed Chrome or Edge)

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { fixtureLegacy } from './helpers.ts'
import { API_LEVEL } from '../src/lib/schema.ts'

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
const waitSaved = async (page: Page, timeout = 5000) => {
  try {
    await page.waitForSelector('[data-save="saved"]', { timeout })
  } catch (e) {
    console.log("save state:", await page.evaluate(() => document.querySelector("[data-save]")?.getAttribute("data-save") + " / " + (document.querySelector(".banner")?.textContent ?? "")))
    throw e
  }
}
async function typeInto(page: Page, sel: string, text: string) {
  await page.click(sel, { count: 3 })
  await page.keyboard.type(text)
}
async function openSettings(page: Page, section: 'Notebook' | 'Focus timer' | 'Privacy' | 'Data' | 'Add-ons') {
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.settings')
  const tab = await page.waitForSelector(`xpath/.//button[contains(@class,"paper-tab") and normalize-space(.)="${section}"]`)
  await tab!.click()
  await page.waitForFunction((s) => document.querySelector('.paper-tab.is-on')?.textContent === s, {}, section)
}
async function closeSettings(page: Page) {
  await page.click('button[aria-label="Back to notebook"]')
  await page.waitForFunction(() => !document.querySelector('.settings'))
}
/** Set a native date input the way picking a date does (React sees an input event). */
async function pickDate(page: Page, sel: string, value: string) {
  await page.$eval(
    sel,
    (el, v) => {
      const input = el as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    value,
  )
}
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12)
  await page.mouse.up()
}
const apiDocs = (page: Page) =>
  page.evaluate(async () => ((await (await fetch('/api/data', { headers: { 'X-Duckbook': '1' } })).json()) as { docs: { key: string; value: any }[] }).docs)
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
      await page.evaluate(async (apiLevel: string) => {
        const data = (await (await fetch('/api/data', { headers: { 'X-Duckbook': '1' } })).json()) as { docs: { key: string; rev: number; value: object }[] }
        const d = data.docs.find((x) => x.key === 'day:2026-10-19')!
        await fetch('/api/docs', {
          method: 'PUT',
          headers: { 'X-Duckbook': '1', 'X-Duckbook-Api': apiLevel, 'Content-Type': 'application/json' },
          body: JSON.stringify({ changes: [{ key: d.key, baseRev: d.rev, value: { ...d.value, notes: 'from elsewhere' } }] }),
        })
      }, String(API_LEVEL))
      await typeInto(page, '.page-foot textarea', 'this tab edit')
      await page.waitForSelector('.save-status.is-conflict', { timeout: 5000 })
      await shot(page, '04-conflict')
      const [use] = await page.$$('xpath/.//button[contains(., "Use the saved version")]')
      await use.click()
      await page.waitForFunction(() => (document.querySelector('.day-page textarea.notes') as HTMLTextAreaElement)?.value === 'from elsewhere')
      await waitSaved(page)
    })

    await step('restore is refused while an edit is unsaved; the edit survives', async () => {
      await page.evaluate(async (apiLevel: string) => {
        const data = (await (await fetch('/api/data', { headers: { 'X-Duckbook': '1' } })).json()) as { docs: { key: string; rev: number; value: object }[] }
        const d = data.docs.find((x) => x.key === 'day:2026-10-19')!
        await fetch('/api/docs', {
          method: 'PUT',
          headers: { 'X-Duckbook': '1', 'X-Duckbook-Api': apiLevel, 'Content-Type': 'application/json' },
          body: JSON.stringify({ changes: [{ key: d.key, baseRev: d.rev, value: { ...d.value, notes: 'second outside edit' } }] }),
        })
        await fetch('/api/backups', { method: 'POST', headers: { 'X-Duckbook': '1', 'X-Duckbook-Api': apiLevel } })
      }, String(API_LEVEL))
      await typeInto(page, '.page-foot textarea', 'unsaved precious words')
      await page.waitForSelector('.save-status.is-conflict', { timeout: 5000 })
      await openSettings(page, 'Data')
      await page.waitForSelector('.backup-list li:first-child .text-link')
      await page.click('.backup-list li:first-child .text-link')
      const [restore] = await page.$$('xpath/.//li//button[normalize-space(.)="Restore"]')
      await restore.click()
      await page.waitForFunction(() => document.querySelector('.settings')!.textContent!.includes('aren’t saved yet'))
      await closeSettings(page)
      assert.equal(await valueOf(page, '.page-foot textarea'), 'unsaved precious words')
      const [mine] = await page.$$('xpath/.//button[contains(., "Keep this tab")]')
      await mine.click()
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
      await openSettings(page, 'Data')
      const [now] = await page.$$('xpath/.//button[contains(., "Back up now")]')
      await now.click()
      await page.waitForFunction(() => document.body.innerText.includes('Backup saved and verified'))
      await closeSettings(page)
      await typeInto(page, '.day-page .line textarea', 'changed after backup')
      await waitSaved(page)
      await openSettings(page, 'Data')
      await page.waitForSelector('.backup-list li:first-child .text-link')
      await page.click('.backup-list li:first-child .text-link')
      const [restore] = await page.$$('xpath/.//li//button[normalize-space(.)="Restore"]')
      await restore.click()
      await page.waitForFunction(() => document.body.innerText.includes('Restored and verified'))
      await shot(page, '05-restored')
      await closeSettings(page)
      assert.equal(await valueOf(page, '.day-page .line textarea'), 'typed in tab one')
    })

    await step('import rejects a non-duckbook file without touching pages', async () => {
      const bad = path.join(dataDir, 'not-duckbook.json')
      fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }))
      await openSettings(page, 'Data')
      const input = await page.$('.settings input[type=file]')
      await input!.uploadFile(bad)
      await page.waitForFunction(() => /not duckbook data|No months/.test(document.querySelector('.settings')!.textContent!))
      await closeSettings(page)
      assert.equal(await valueOf(page, '.day-page .line textarea'), 'typed in tab one')
    })

    await step('Settings is a page with paper tabs and returns to where you were', async () => {
      await page.goto(`${BASE}/#/week/2026-10-19`)
      await page.waitForSelector('.week-plan')
      await openSettings(page, 'Focus timer')
      await page.waitForSelector('.pomo-settings')
      await shot(page, '08-settings')
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => location.hash === '#/week/2026-10-19')
    })

    await step('Focus Map: off by default; turning it on (Add-ons) adds the tab', async () => {
      assert.equal(await page.$$eval('.tab-module', (x) => x.length), 0)
      await openSettings(page, 'Add-ons')
      await page.click('.module-toggle input')
      await closeSettings(page)
      await page.waitForSelector('.tab-module')
      await page.click('body')
      await page.keyboard.press('f')
      await page.waitForSelector('.canvas')
    })

    await step('Focus Map: write a note in the tray, drag it onto the map, nudge it with keys', async () => {
      await page.click('.pad textarea')
      await page.keyboard.type('synthetic note alpha')
      await page.keyboard.press('Enter')
      await page.waitForSelector('.tray .note')
      const note = (await (await page.$('.tray .note .note-head'))!.boundingBox())!
      const cv = (await (await page.$('.canvas'))!.boundingBox())!
      await dragTo(page, { x: note.x + 20, y: note.y + 6 }, { x: cv.x + cv.width * 0.8, y: cv.y + cv.height * 0.2 })
      await page.waitForSelector('.canvas .note')
      assert.match(await page.$eval('.canvas .note', (n) => n.getAttribute('aria-label')!), /Quick wins/)
      assert.equal(await page.$$eval('.tray .note', (x) => x.length), 0)
      await page.focus('.canvas .note')
      for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowLeft")
      await page.waitForFunction(() => /Big bets/.test(document.querySelector('.canvas .note')!.getAttribute('aria-label')!))
      assert.equal(await page.evaluate(() => location.hash), '#/focus/2026-10-19', 'arrow keys did not flip the week')
      await page.select('.canvas .note .place-select', 'fill')
      await page.waitForFunction(() => /Fill-ins/.test(document.querySelector('.canvas .note')!.getAttribute('aria-label')!))
      await waitSaved(page)
    })

    await step('Focus Map: date and plan from the note; one week task, unsorted, marked', async () => {
      await page.click('.canvas .note .note-head')
      await page.click('.canvas .note .date-chip')
      await pickDate(page, '.canvas .note .date-input', '2026-10-24')
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => document.querySelector('.canvas .note .date-chip')?.textContent === 'Oct 24')
      const plan = await page.waitForSelector('xpath/.//div[contains(@class,"canvas")]//button[contains(., "Plan · Wk 43")]')
      await plan!.click()
      await page.waitForSelector('xpath/.//div[contains(@class,"canvas")]//a[contains(., "Wk 43")]')
      await waitSaved(page)
      await shot(page, '07-focus-map')
      await page.goto(`${BASE}/#/week/2026-10-19`)
      await page.waitForSelector('.dump-list')
      const dump = await page.$$eval('.dump-list .wtask textarea', (x) => x.map((e) => (e as HTMLTextAreaElement).value))
      assert.equal(dump.filter((t) => t === 'synthetic note alpha').length, 1, 'arrives once, unsorted')
      assert.equal(await page.$eval('.dump-list .wtask:last-child .date-chip', (e) => e.textContent), 'Oct 24')
    })

    await step('Linked work: rename from Week, complete from Day, reopen on the note, all consistent', async () => {
      await typeInto(page, '.dump-list .wtask:last-child textarea', 'synthetic work renamed')
      await waitSaved(page)
      await page.goto(`${BASE}/#/day/2026-10-24`)
      const pull = await page.waitForSelector('xpath/.//button[contains(@class,"pull-item")][contains(., "synthetic work renamed")]')
      await pull!.click()
      const row = await page.waitForSelector('.task-row')
      const check = await row!.$('.check')
      await check!.click()
      await waitSaved(page)
      let docs = await apiDocs(page)
      const idea = docs.find((d) => d.key === 'focus')!.value.ideas[0]
      const wk = docs.find((d) => d.key === 'week:2026-10-19')!.value.tasks.filter((t: any) => t.ideaId === idea.id)
      const day = docs.find((d) => d.key === 'day:2026-10-24')!.value.tasks
      assert.equal(idea.text, 'synthetic work renamed')
      assert.equal(idea.status, 'done')
      assert.equal(wk.length, 1)
      assert.equal(wk[0].text, 'synthetic work renamed')
      assert.equal(wk[0].done, true)
      assert.equal(day[0].text, 'synthetic work renamed')
      assert.equal(day[0].done, true)

      await page.goto(`${BASE}/#/focus/2026-10-19`)
      await page.waitForSelector('.canvas .note.state-done')
      await page.click('.canvas .note .note-head')
      const reopen = await page.waitForSelector('xpath/.//div[contains(@class,"canvas")]//button[normalize-space(.)="Reopen"]')
      await reopen!.click()
      await page.waitForSelector('.canvas .note.state-doing')
      await waitSaved(page)
      docs = await apiDocs(page)
      assert.equal(docs.find((d) => d.key === 'week:2026-10-19')!.value.tasks.find((t: any) => t.ideaId)!.done, false)
      assert.equal(docs.find((d) => d.key === 'day:2026-10-24')!.value.tasks[0].done, false)
    })

    await step('Linked work: changing the date from Week moves the one task to that week', async () => {
      await page.goto(`${BASE}/#/week/2026-10-19`)
      await page.waitForSelector('.dump-list')
      await page.hover('.dump-list .wtask:last-child')
      await page.click('.dump-list .wtask:last-child .date-chip')
      // Half-typed years from a date field must never reach the data.
      await pickDate(page, '.dump-list .wtask:last-child .date-input', '0202-10-28')
      await pickDate(page, '.dump-list .wtask:last-child .date-input', '2026-10-28')
      await page.keyboard.press('Enter')
      await waitSaved(page)
      const docs = await apiDocs(page)
      const all = docs.filter((d) => d.key.startsWith('week:')).flatMap((d) => d.value.tasks.filter((t: any) => t.ideaId).map(() => d.key))
      assert.deepEqual(all, ['week:2026-10-26'], 'exactly one linked task, now in the week of the date')
      assert.ok(docs.every((d) => !/^week:(0|1[0-8])/.test(d.key)), 'no pages for half-typed years')
      await page.goto(`${BASE}/#/focus/2026-10-19`)
      await page.waitForSelector('xpath/.//div[contains(@class,"canvas")]//a[contains(., "Wk 44")]')
    })

    await step('Focus filters show notes by state', async () => {
      const count = () => page.$$eval('.canvas .note, .tray .note', (x) => x.length)
      const pick = async (label: string) => {
        const b = await page.waitForSelector(`xpath/.//button[contains(@class,"filter")][starts-with(normalize-space(.), "${label}")]`)
        await b!.click()
      }
      await pick('Completed')
      assert.equal(await count(), 0)
      await pick('In progress')
      assert.equal(await count(), 1)
      await pick('All')
      assert.equal(await count(), 1)
    })

    await step('Focus Map: turning it off hides it but keeps the ideas and links', async () => {
      await openSettings(page, 'Add-ons')
      await page.click('.module-toggle input')
      await closeSettings(page)
      await waitSaved(page)
      await page.goto(`${BASE}/#/week/2026-10-26`)
      await page.waitForSelector('.dump-list')
      assert.equal(await page.$$eval('.tab-module', (x) => x.length), 0)
      assert.equal(await page.$$eval('.idea-mark', (x) => x.length), 0)
      await page.goto(`${BASE}/#/focus/2026-10-19`)
      await page.waitForFunction(() => location.hash.startsWith('#/week/'))
      await openSettings(page, 'Add-ons')
      await page.click('.module-toggle input')
      await closeSettings(page)
      await waitSaved(page)
      await page.goto(`${BASE}/#/focus/2026-10-19`)
      await page.waitForSelector('.canvas .note')
      await page.goto(`${BASE}/#/week/2026-10-26`)
      await page.waitForSelector('.dump-list .idea-mark')
      await page.goto(`${BASE}/#/day/2026-10-19`)
      await page.waitForSelector('.day-page')
    })

    await step('Deleting a linked task by backspacing never blanks the idea', async () => {
      await page.goto(`${BASE}/#/week/2026-10-26`)
      const sel = '.dump-list .wtask:last-child textarea'
      await page.waitForSelector(sel)
      await page.click(sel, { count: 3 })
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await waitSaved(page)
      const docs = await apiDocs(page)
      assert.equal(docs.find((d) => d.key === 'focus')!.value.ideas[0].text, 'synthetic work renamed')
      assert.ok(!docs.find((d) => d.key === 'week:2026-10-26')!.value.tasks.some((t: any) => t.ideaId), 'row removed')
      assert.equal(docs.find((d) => d.key === 'day:2026-10-24')!.value.tasks[0].text, 'synthetic work renamed', 'day copy keeps its title')
      await page.goto(`${BASE}/#/day/2026-10-19`)
      await page.waitForSelector('.day-page')
    })

    await step('Month: draw a line across days, write on it, cross into next month, slide the words, remove', async () => {
      await page.goto(`${BASE}/#/month/2026-10-19`)
      await page.waitForSelector('[data-day="2026-10-13"] .cal-num')
      const a = (await (await page.$('[data-day="2026-10-13"] .cal-num'))!.boundingBox())!
      const b = (await (await page.$('[data-day="2026-10-16"]'))!.boundingBox())!
      await dragTo(page, { x: a.x + 6, y: a.y + 6 }, { x: b.x + b.width / 2, y: b.y + b.height / 2 })
      await page.waitForSelector('.span-pop')
      await page.keyboard.type('synthetic stretch')
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => !document.querySelector('.span-pop'))
      await waitSaved(page)
      assert.equal(await page.evaluate(() => location.hash), '#/month/2026-10-19', 'drawing did not open the day')
      let spans = (await apiDocs(page)).find((d) => d.key === 'spans')!.value.spans
      assert.equal(spans.length, 1)
      assert.deepEqual([spans[0].start, spans[0].end, spans[0].text, spans[0].at], ['2026-10-13', '2026-10-16', 'synthetic stretch', '2026-10-13'])

      // Words slide along the line, never off it.
      const label = (await (await page.$('.span-label:not(.is-echo)'))!.boundingBox())!
      const c15 = (await (await page.$('[data-day="2026-10-15"]'))!.boundingBox())!
      await dragTo(page, { x: label.x + 4, y: label.y + 4 }, { x: c15.x + 20, y: label.y + 4 })
      await page.waitForFunction(() => !!document.querySelector('[data-day="2026-10-15"] .span-label:not(.is-echo)'))
      await waitSaved(page)
      spans = (await apiDocs(page)).find((d) => d.key === 'spans')!.value.spans
      assert.equal(spans[0].at, '2026-10-15')

      // A click on the words opens the small editor; To moves into November.
      await page.click('[data-day="2026-10-15"] .span-label')
      await page.waitForSelector('.span-pop')
      await pickDate(page, '.span-pop input[aria-label="To"]', '2026-11-04')
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => !document.querySelector('.span-pop'))
      await waitSaved(page)
      spans = (await apiDocs(page)).find((d) => d.key === 'spans')!.value.spans
      assert.equal(spans[0].end, '2026-11-04')
      await page.goto(`${BASE}/#/month/2026-11-02`)
      await page.waitForSelector('[data-day="2026-11-04"] .span-seg.is-end')
      // Its words sit where the line enters November, and echo faintly where it wraps to the next row.
      assert.ok(await page.$('[data-day="2026-11-01"] .span-label:not(.is-echo)'), 'November shows the line, with its words')
      assert.ok(await page.$('[data-day="2026-11-02"] .span-label.is-echo'))

      await page.click('[data-day="2026-11-01"] .span-label')
      await page.click('.span-pop .span-x')
      const rm = await page.waitForSelector('xpath/.//div[contains(@class,"span-pop")]//button[normalize-space(.)="Remove"]')
      await rm!.click()
      await waitSaved(page)
      assert.equal((await apiDocs(page)).find((d) => d.key === 'spans')!.value.spans.length, 0)
      assert.equal(await page.$$eval('.span-seg', (x) => x.length), 0)

      // Leave one behind for the lock check below.
      await page.goto(`${BASE}/#/month/2026-10-19`)
      const p = (await (await page.$('[data-day="2026-10-20"] .cal-num'))!.boundingBox())!
      const q = (await (await page.$('[data-day="2026-10-22"]'))!.boundingBox())!
      await dragTo(page, { x: p.x + 6, y: p.y + 6 }, { x: q.x + q.width / 2, y: q.y + q.height / 2 })
      await page.waitForSelector('.span-pop')
      await page.keyboard.type('synthetic stretch kept')
      await page.keyboard.press('Enter')
      await waitSaved(page)
      await page.goto(`${BASE}/#/day/2026-10-19`)
      await page.waitForSelector('.day-page')
    })

    await step('PIN lock: blank shell, no journal in the DOM, API refuses', async () => {
      await openSettings(page, 'Privacy')
      const [set] = await page.$$('xpath/.//button[contains(., "Set a 6-digit PIN")]')
      await set.click()
      const fields = await page.$$('.pin-field input')
      await fields[0].type('246810')
      await fields[1].type('246810')
      const [save] = await page.$$('xpath/.//button[contains(., "Save PIN")]')
      await save.click()
      await page.waitForFunction(() => document.body.innerText.includes('PIN saved'))
      await closeSettings(page)
      await page.click('button[aria-label="Lock"]')
      await page.waitForSelector('.lock-shell .pin-dots')
      await shot(page, '06-locked')
      const t = await textOf(page)
      assert.doesNotMatch(t, /typed in tab one|fixture|from elsewhere|synthetic note|synthetic work|synthetic stretch/)
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

    await step('after a restore the old browser copy is no longer called "safe"; re-move, then remove', async () => {
      await page.waitForSelector('.banner')
      await openSettings(page, 'Data')
      assert.equal((await page.$$('xpath/.//button[contains(., "Remove old copy")]')).length, 0, 'no remove offer while the database differs')
      const [move] = await page.$$('xpath/.//button[contains(., "Move them in")]')
      await move.click()
      await page.waitForSelector('.confirm-box')
      const [replace] = await page.$$('xpath/.//button[contains(., "Replace with browser copy")]')
      await replace.click()
      await page.waitForFunction(() => document.querySelector('.settings')!.textContent!.includes('Moved and verified'))
      const rm = await page.waitForSelector('xpath/.//button[contains(., "Remove old copy")]')
      await rm!.click()
      await page.waitForSelector('.confirm-box')
      const [yes] = await page.$$('xpath/.//div[contains(@class,"confirm-box")]//button[normalize-space(.)="Remove"]')
      await yes.click()
      assert.equal(await page.evaluate(() => localStorage.getItem('duckbook:v1')), null)
      await closeSettings(page)
      assert.equal(await valueOf(page, '.day-page .line textarea'), 'fixture gratitude', 'browser copy content now in the database')
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
