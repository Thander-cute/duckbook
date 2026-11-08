// Browser checks for Month cell text, holidays, own days, DISC and Contacts.
// Throwaway server, temp data dir, synthetic data only. Run: npm run build && node test/contacts.e2e.ts

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { API_LEVEL } from '../src/lib/schema.ts'

const PORT = Number(process.env.DUCKBOOK_TEST_PORT ?? 5431)
const BASE = `http://localhost:${PORT}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-contacts-e2e-'))
const shots = process.env.E2E_SHOTS ?? ''
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p))
if (!browserPath) throw new Error('No Chrome/Edge found for browser checks.')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, DUCKBOOK_DATA_DIR: dataDir, DUCKBOOK_PORT: String(PORT) }, stdio: 'ignore' })
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`, { headers: { 'X-Duckbook': '1' } })).ok) break
  } catch {}
  if (i > 50) throw new Error('test server did not start')
  await sleep(100)
}

const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, defaultViewport: { width: 1500, height: 1000 } })
const step = async (name: string, fn: () => Promise<void>) => {
  await fn()
  console.log(`ok - ${name}`)
}
const shot = async (page: Page, name: string) => {
  if (!shots) return
  await sleep(450)
  await page.screenshot({ path: path.join(shots, `${name}.png`) as `${string}.png` })
}
const open = async (page: Page, route: string, sel: string) => {
  await page.goto(`${BASE}/#/${route}`)
  await page.reload()
  await page.waitForSelector(sel)
}
const saved = async (page: Page) => {
  await sleep(50)
  await page.waitForSelector('[data-save="saved"]', { timeout: 5000 })
}
const fontOf = (page: Page, day: string) => page.$eval(`[data-day="${day}"] textarea`, (e) => parseFloat(getComputedStyle(e).fontSize))
const toggle = (page: Page, label: string) => page.click(`input[role="switch"][aria-label="${label}"]`)
const addons = async (page: Page) => {
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.settings')
  const tab = await page.waitForSelector('xpath/.//button[contains(@class,"sd-tab") and normalize-space(.)="Add-ons"]')
  await tab!.click()
  await page.waitForSelector('input[aria-label="Contacts"]')
}
const closeSettings = async (page: Page) => {
  await page.click('.sd-close')
  await page.waitForSelector('.settings', { hidden: true })
}
const addDay = async (page: Page, day: string, name: string) => {
  await page.hover(`[data-day="${day}"]`)
  await page.click(`[data-day="${day}"] .cal-day-add`)
  await page.waitForSelector('.day-card-add')
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await saved(page)
  await page.keyboard.press('Escape')
  await page.waitForSelector('.day-card', { hidden: true })
}
const docs = async (page: Page) => (await page.evaluate(async () => (await fetch('/api/data', { headers: { 'X-Duckbook': '1' } })).json())).docs as { key: string; rev: number; value: any }[]

try {
  const page = await browser.newPage()
  // The first-visit tour would sit over the pages these steps click.
  await page.evaluateOnNewDocument(() => localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus'])))
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await step('Month words start at the page default and shrink as they fill the cell, all visible', async () => {
    await open(page, 'month/2026-11-01', '[data-day="2026-11-10"]')
    await page.click('[data-day="2026-11-10"] textarea')
    await page.keyboard.type('short')
    await page.click('[data-day="2026-11-11"] textarea')
    await page.keyboard.type('a longer synthetic note that fills most of this one day cell and keeps on going')
    await saved(page)
    assert.equal(await fontOf(page, '2026-11-10'), 15, 'the default is no longer oversized')
    const small = await fontOf(page, '2026-11-11')
    assert.ok(small < 15 && small >= 11, `a long note shrinks (${small}px)`)
    assert.ok(await page.$eval('[data-day="2026-11-11"] textarea', (e) => e.scrollHeight <= e.clientHeight), 'the long note fits')
  })

  await step('Ctrl+[ and Ctrl+] resize one day, with text selected or not; the size is kept and other days stay', async () => {
    await page.click('[data-day="2026-11-10"] textarea', { count: 3 })
    await page.keyboard.down('Control')
    for (let i = 0; i < 3; i++) await page.keyboard.press('BracketRight')
    await page.keyboard.up('Control')
    await saved(page)
    assert.equal(await fontOf(page, '2026-11-10'), 18)
    assert.equal(await page.$eval('[data-day="2026-11-10"] textarea', (e) => (e as HTMLTextAreaElement).value), 'short', 'the words are untouched')
    assert.equal(await fontOf(page, '2026-11-09'), 15, 'other days stay')
    await page.reload()
    await page.waitForSelector('[data-day="2026-11-10"]')
    assert.equal(await fontOf(page, '2026-11-10'), 18, 'kept after a reload')
    await page.click('[data-day="2026-11-10"] textarea')
    await page.keyboard.down('Control')
    for (let i = 0; i < 3; i++) await page.keyboard.press('BracketLeft')
    await page.keyboard.up('Control')
    await saved(page)
    assert.equal('sizes' in (await docs(page)).find((d) => d.key === 'month:2026-11')!.value, false, 'back at the default it leaves nothing stored')
  })

  await step('The default size is set on the Month page and moves every day without its own size', async () => {
    await page.click('[data-day="2026-11-09"] textarea')
    await page.keyboard.type('one')
    await page.keyboard.down('Control')
    await page.keyboard.press('BracketRight')
    await page.keyboard.up('Control')
    await saved(page)
    assert.equal(await fontOf(page, '2026-11-09'), 16)
    await page.click('.month-foot button:last-of-type')
    await saved(page)
    assert.equal(await fontOf(page, '2026-11-10'), 16, 'default went up')
    assert.equal(await fontOf(page, '2026-11-09'), 16, 'its own size stays')
    await page.click('.month-foot button:first-of-type')
    await page.click('.month-foot button:first-of-type')
    await saved(page)
    assert.equal(await fontOf(page, '2026-11-10'), 14)
    await page.click('.month-foot button:last-of-type')
    await saved(page)
    await shot(page, 'month-fit')
  })

  await step('Add-ons has one Holidays switch and no date entry; the desktop size is absent on the web', async () => {
    assert.equal(await page.$('.cal-occ'), null)
    assert.equal(await page.$('.cal-day-add'), null, 'no + while holidays are off')
    await addons(page)
    assert.equal(await page.$('.settings form'), null)
    assert.equal(await page.$('input[aria-label="DISC colours"]'), null, 'DISC only appears with Contacts on')
    assert.equal(await page.$$eval('.sd-row-title', (t) => t.some((x) => x.textContent === 'Days to remember')), false)
    await toggle(page, 'Holidays')
    await saved(page)
    await closeSettings(page)
    await page.click('button[aria-label="Settings"]')
    await page.waitForSelector('.settings')
    const look = await page.waitForSelector('xpath/.//button[contains(@class,"sd-tab") and normalize-space(.)="Look & feel"]')
    await look!.click()
    assert.equal(await page.$$eval('.sd-row-title', (t) => t.some((x) => x.textContent === 'Size')), false)
    await closeSettings(page)
  })

  await step('Built-in holidays, solar and lunar, show on Month and Day', async () => {
    assert.match(await page.$eval('[data-day="2026-11-20"] .cal-occ', (e) => e.textContent ?? ''), /Nhà giáo/)
    await open(page, 'month/2027-02-01', '[data-day="2027-02-06"]')
    assert.match(await page.$eval('[data-day="2027-02-06"] .cal-occ', (e) => e.textContent ?? ''), /Tết Nguyên đán/, 'lunar new year 2027')
    assert.match(await page.$eval('[data-day="2027-02-05"] .cal-occ', (e) => e.textContent ?? ''), /Giao thừa/)
    await open(page, 'day/2026-09-25', '.day-page')
    assert.match(await page.$eval('.day-occasions', (e) => e.textContent ?? ''), /Trung thu/)
  })

  await step('An own day is added on the Month day, comes back every year, can be removed', async () => {
    await open(page, 'month/2026-11-01', '[data-day="2026-11-12"]')
    await addDay(page, '2026-11-12', 'Synthetic anniversary')
    assert.match(await page.$eval('[data-day="2026-11-12"] .cal-occ', (e) => e.textContent ?? ''), /Synthetic anniversary/)
    await page.click('[data-day="2026-11-12"] .cal-occ')
    await page.waitForSelector('.day-card')
    await shot(page, 'day-card')
    await page.keyboard.press('Escape')
    await page.waitForSelector('.day-card', { hidden: true })
    await open(page, 'month/2028-11-01', '[data-day="2028-11-12"]')
    assert.match(await page.$eval('[data-day="2028-11-12"] .cal-occ', (e) => e.textContent ?? ''), /Synthetic anniversary/)
    await page.click('[data-day="2028-11-12"] .cal-occ')
    await page.waitForSelector('.day-card .span-x')
    await page.click('.day-card .span-x')
    const bin = await page.waitForSelector('.day-card .confirm-remove button')
    await bin!.click()
    await saved(page)
    assert.equal(await page.$('[data-day="2028-11-12"] .cal-occ'), null)
    assert.deepEqual((await docs(page)).find((d) => d.key === 'occasions')!.value.days, [])
    await page.keyboard.press('Escape')
  })

  await step('Add a person: pressing Add leaves no blank rows; they appear once named; birthday and age show', async () => {
    await open(page, 'month/2026-11-01', '[data-day="2026-11-10"]')
    await addons(page)
    await toggle(page, 'Contacts')
    await saved(page)
    await closeSettings(page)
    await page.keyboard.press('c')
    await page.waitForSelector('.contacts-left')
    assert.equal(await page.$('.today-btn'), null, 'nothing to step through here')

    for (let i = 0; i < 4; i++) await page.click('.contacts-find .text-btn')
    await page.waitForSelector('.contact-name-input')
    await saved(page)
    assert.equal(await page.$$eval('.contact-row', (x) => x.length), 0, 'no blank rows')
    assert.equal(await page.$('.contact-notes'), null, 'the rest waits for a name')
    assert.equal((await docs(page)).find((d) => d.key === 'contacts')?.value.people.length ?? 0, 0, 'nothing saved yet')

    await page.type('.contact-name-input', 'Synthetic Lan')
    await page.waitForSelector('.contact-notes')
    assert.equal(await page.$eval('.contact-name-input', (e) => (e as HTMLTextAreaElement).value), 'Synthetic Lan', 'typing kept its place while the card opened')
    await page.type('input[aria-label="Day"]', '18')
    await page.type('input[aria-label="Month"]', '11')
    await page.type('input[aria-label="Year (optional)"]', '1996')
    await page.keyboard.press('Enter')
    await page.type('.contact-notes', 'synthetic note about Lan')
    await saved(page)
    assert.equal(await page.$('.contact-bday-edit .seg'), null, 'no solar or lunar choice')

    await open(page, 'month/2026-11-01', '[data-day="2026-11-18"]')
    assert.match(await page.$eval('[data-day="2026-11-18"] .cal-occ', (e) => e.getAttribute('title') ?? ''), /Synthetic Lan turns 30/)
    await open(page, 'day/2026-11-18', '.day-page')
    assert.match(await page.$eval('.day-occasions', (e) => e.textContent ?? ''), /Synthetic Lan turns 30/)
  })

  await step('DISC is off until switched on; only picked colours appear in the bar, shared evenly; dragging a line sets the main one', async () => {
    const chip = async (name: string) => (await page.waitForSelector(`xpath/.//button[contains(@class,"disc-chip") and contains(.,"${name}")]`))!.click()
    const bar = () => page.$$eval('.disc-seg', (x) => x.map((e) => { const [name, share] = (e.getAttribute('title') ?? '').split(' '); return `${name[0]} ${share}` }))
    await open(page, 'contacts/2026-11-18', '.contact-row')
    await page.click('.contact-row')
    await page.waitForSelector('.contact-notes')
    assert.equal(await page.$('.disc'), null)
    await addons(page)
    await toggle(page, 'DISC colours')
    await saved(page)
    await closeSettings(page)
    await page.waitForSelector('.disc-chips')
    assert.equal(await page.$('.disc-bar'), null, 'no bar until a colour is picked')
    assert.ok(await page.$('.disc-head .info'), 'an (i) explains the model')

    await chip('Steadiness')
    assert.deepEqual(await bar(), ['S 100%'])
    assert.equal(await page.$('.disc-line-grip'), null, 'one colour has no line to drag')
    await chip('Dominance')
    assert.deepEqual(await bar(), ['S 50%', 'D 50%'])
    await chip('Conscientiousness')
    assert.deepEqual(await bar(), ['S 50%', 'D 40%', 'C 10%'], 'a third colour keeps the main one')
    await chip('Influence')
    assert.deepEqual(await bar(), ['S 40%', 'D 40%', 'C 10%', 'I 10%'])
    await chip('Influence')
    await chip('Conscientiousness')
    assert.deepEqual(await bar(), ['S 50%', 'D 50%'])
    assert.equal(await page.$eval('.disc-chip:not(.is-on)', (e) => getComputedStyle(e).opacity), '0.55', 'with two chosen, the others step back')
    await saved(page)

    const box = (await (await page.$('.disc-bar'))!.boundingBox())!
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width * 0.5, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 5 })
    assert.deepEqual(await bar(), ['S 20%', 'D 80%'], 'the bar follows the pointer in its order')
    await page.mouse.up()
    assert.deepEqual(await bar(), ['D 80%', 'S 20%'], 'on release the largest goes first and is the main one')
    assert.match(await page.$eval('.disc-summary', (e) => e.textContent ?? ''), /Mostly Dominance/)
    assert.deepEqual(await page.$$eval('.disc-chip.is-on', (x) => x.map((e) => e.textContent)), ['Dominance80%', 'Steadiness20%'], 'each picked colour shows its share, in a fixed place')
    assert.deepEqual(await page.$$eval('.disc-chip:not(.is-on)', (x) => x.map((e) => e.textContent)), ['Influence', 'Conscientiousness'])
    assert.equal(await page.$eval('.disc-chip:not(.is-on) i', (e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', 'an unpicked colour has no colour')
    await saved(page)
    assert.deepEqual((await docs(page)).find((d) => d.key === 'contacts')!.value.people[0].disc, { D: 80, S: 20 })
    assert.deepEqual(await page.$$eval('.contact-row .disc-dots i', (x) => x.map((e) => e.className)), ['disc-d', 'disc-s'], 'the list shows dots, the largest share first')

    await chip('Influence')
    assert.deepEqual(await bar(), ['D 70%', 'S 20%', 'I 10%'], 'adding a colour keeps the shares already set')
    await chip('Influence')
    await saved(page)
    assert.deepEqual(await bar(), ['D 78%', 'S 22%'], 'dropping it keeps the rest in proportion')
    await page.focus('.disc-line-grip')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await saved(page)
    assert.deepEqual(await bar(), ['D 70%', 'S 30%'], 'the line moves with arrow keys in steps, and they do not step the page')
    await shot(page, 'contacts')

    await page.reload()
    await page.waitForSelector('.contact-row')
    await page.click('.contact-row')
    assert.deepEqual(await bar(), ['D 70%', 'S 30%'], 'kept after a reload')

    await addons(page)
    await toggle(page, 'DISC colours')
    await saved(page)
    await closeSettings(page)
    assert.equal(await page.$('.disc-dots'), null)
    assert.equal(await page.$('.disc'), null)
    assert.deepEqual((await docs(page)).find((d) => d.key === 'contacts')!.value.people[0].disc, { D: 70, S: 30 }, 'kept while off')
    await addons(page)
    await toggle(page, 'DISC colours')
    await saved(page)
    await closeSettings(page)
  })

  await step('With 150 people the pages stay the window height; the list scrolls inside, files by given name, and A–Z jumps', async () => {
    const family = ['Nguyễn Văn', 'Trần Thị', 'Lê', 'Phạm Minh', 'Đỗ']
    const given = ['An', 'Bình', 'Chi', 'Dũng', 'Đào', 'Giang', 'Hà', 'Khoa', 'Linh', 'Minh', 'Nam', 'Oanh', 'Phúc', 'Quân', 'Sơn', 'Trang', 'Uyên', 'Vy', 'Xuân', 'Yến']
    const months = [11, 11, 12, 1]
    const people = Array.from({ length: 149 }, (_, i) => ({ id: `gen${i}`, name: `${family[i % 5]} ${given[i % 20]}`, gender: '', day: (i % 27) + 1, month: months[i % 4], year: null, disc: [{ D: 60, I: 40 }, { S: 50, C: 30, I: 20 }, { I: 75, S: 25 }, { C: 40, D: 35, S: 15, I: 10 }, { D: 100 }][i % 5], notes: '' }))
    const cur = (await docs(page)).find((d) => d.key === 'contacts')!
    const r = await page.evaluate(async (body, api) => (await fetch('/api/docs', { method: 'PUT', headers: { 'X-Duckbook': '1', 'X-Duckbook-Api': String(api), 'Content-Type': 'application/json' }, body })).status, JSON.stringify({ changes: [{ key: 'contacts', baseRev: cur.rev, value: { people: [...cur.value.people, ...people] } }] }), API_LEVEL)
    assert.equal(r, 200)
    await open(page, 'contacts/2026-11-18', '.contact-row')
    assert.equal(await page.$$eval('.contact-row', (x) => x.length), 150)
    const m = await page.evaluate(() => {
      const list = document.querySelector('.contacts-list')!
      const spread = document.querySelector('.contacts-spread')!
      return { doc: document.documentElement.scrollHeight, win: innerHeight, spread: spread.getBoundingClientRect().height, scrolls: list.scrollHeight > list.clientHeight }
    })
    assert.ok(m.doc <= m.win + 100, `the window barely scrolls: ${m.doc} vs ${m.win}`)
    assert.ok(m.spread < m.win, 'the book fits the window')
    assert.ok(m.scrolls, 'the list scrolls inside the page')
    assert.ok((await page.$$eval('.contacts-soon li', (x) => x.length)) <= 8, 'upcoming birthdays stay short')
    await shot(page, 'contacts-many')

    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.contacts-index button')].find((b) => b.textContent === 'T')!.click())
    const top = await page.evaluate(() => {
      const list = document.querySelector('.contacts-list')!
      const head = document.querySelector('[data-letter="T"]')!
      return Math.abs(head.getBoundingClientRect().top - list.getBoundingClientRect().top)
    })
    assert.ok(top < 2, `T is at the top of the list (${top}px off)`)
    assert.match(await page.$eval('[data-letter="T"] .contact-name', (e) => e.textContent ?? ''), /Trang/, 'Nguyễn … Trang files under T')
    assert.equal(await page.$eval('.contacts-index button:nth-child(4)', (e) => (e as HTMLButtonElement).disabled), false, 'Đào and Dũng file under D')

    await page.type('.contacts-search', 'dao')
    assert.ok((await page.$$eval('.contact-row', (x) => x.length)) > 0, 'search ignores accents')
    assert.ok(await page.$$eval('.contact-name', (x) => x.every((e) => /Đào/.test(e.textContent ?? ''))))
  })

  await step('Turning Contacts off hides the page and birthdays and keeps everyone; on brings them back', async () => {
    await open(page, 'month/2026-11-01', '[data-day="2026-11-18"]')
    await addons(page)
    await toggle(page, 'Contacts')
    await saved(page)
    assert.equal(await page.$('input[aria-label="DISC colours"]'), null)
    await closeSettings(page)
    assert.doesNotMatch((await page.$eval('[data-day="2026-11-18"]', (e) => e.textContent)) ?? '', /Synthetic Lan/)
    await page.goto(`${BASE}/#/contacts/2026-11-18`)
    await page.waitForFunction(() => location.hash.startsWith('#/month'))
    await addons(page)
    await toggle(page, 'Contacts')
    await saved(page)
    await closeSettings(page)
    assert.ok((await docs(page)).find((d) => d.key === 'contacts')!.value.people.length === 150)
  })

  assert.deepEqual(errors, [], 'no page errors')
  console.log('all passed')
} finally {
  await browser.close()
  server.kill()
  await sleep(300)
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
}
