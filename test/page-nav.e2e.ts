// Arrows on the date written on each page, steady tabs, Updates and add-on versions. Synthetic data, throwaway server.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'

const port = 5436
const origin = `http://localhost:${port}`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-pagenav-'))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, DUCKBOOK_PORT: String(port), DUCKBOOK_DATA_DIR: dir }, stdio: 'ignore' })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const VIEWS = ['month', 'week', 'day', 'reflect', 'focus', 'contacts']

const step = async (name: string, fn: () => Promise<void>) => {
  await fn()
  console.log(`ok - ${name}`)
}
const visit = async (page: Page, view: string, date = '2026-11-09') => {
  await page.goto(`${origin}/#/${view}/${date}`)
  await page.waitForSelector('.tabs')
  await sleep(450)
}
const left = (page: Page, sel: string) => page.$eval(sel, (e) => Math.round(e.getBoundingClientRect().left))
const addOns = async (page: Page) => {
  await page.click('button[aria-label="Settings"]')
  await (await page.waitForSelector('xpath/.//button[contains(@class,"sd-tab") and normalize-space(.)="Add-ons"]'))!.click()
}

try {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${origin}/api/session`)
      break
    } catch {
      await sleep(100)
    }
  }
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus', 'contacts'])))
  await page.setViewport({ width: 1280, height: 720 })
  await visit(page, 'day')

  await step('Add-ons: each shows its own version, with history folded away; Updates is absent on the web', async () => {
    await addOns(page)
    for (const l of ['Focus Map', 'Contacts']) {
      const on = await page.$eval(`input[role="switch"][aria-label="${l}"]`, (e) => (e as HTMLInputElement).checked)
      if (!on) await page.click(`input[role="switch"][aria-label="${l}"]`)
    }
    await page.click('input[role="switch"][aria-label="DISC colours"]')
    await sleep(500)
    assert.deepEqual(await page.$$eval('.addon-version summary', (x) => x.map((e) => e.textContent)), ['Version 1.0.0', 'Version 1.0.0', 'Version 1.0.0', 'Version 1.0.0'])
    assert.equal(await page.$eval('.addon-version', (e) => (e as HTMLDetailsElement).open), false)
    await page.click('.addon-version summary')
    assert.match(await page.$eval('.addon-version ul', (e) => (e as HTMLElement).innerText), /1\.0\.0/)
    assert.deepEqual(await page.$$eval('.sd-tab', (x) => x.map((e) => e.textContent)), ['Look & feel', 'Focus timer', 'Shortcuts', 'Privacy', 'Data', 'Add-ons'])
    await page.keyboard.press('Escape')
    await sleep(300)
  })

  for (const [w, h] of [[1880, 1000], [1366, 700], [1280, 720], [1000, 700]]) {
    await step(`${w}×${h}: the tabs and the cog stay put on every page, and in Settings`, async () => {
      await page.setViewport({ width: w, height: h })
      const seen = new Set<string>()
      for (const v of VIEWS) {
        await visit(page, v)
        seen.add(`${await left(page, '.tab')},${await left(page, 'button[aria-label="Settings"]')}`)
      }
      await visit(page, 'day')
      await page.click('button[aria-label="Settings"]')
      await sleep(250)
      seen.add(`${await left(page, '.tab')},${await left(page, 'button[aria-label="Settings"]')}`)
      await page.keyboard.press('Escape')
      assert.equal(seen.size, 1, [...seen].join(' | '))
      const bar = await page.$eval('.topbar', (e) => e.getBoundingClientRect().height)
      assert.equal(bar, 60)
    })
  }

  await page.setViewport({ width: 1280, height: 720 })
  const onPaper = async (v: string) => {
    await visit(page, v)
    const r = await page.evaluate(() => {
      const steppers = [...document.querySelectorAll('.date-stepper')]
      const pages = [...document.querySelectorAll('.desk .page, .desk .sheet')]
      const box = steppers[0]?.getBoundingClientRect()
      return { count: steppers.length, inside: pages.some((x) => { const b = x.getBoundingClientRect(); return !!box && box.left >= b.left && box.right <= b.right && box.top >= b.top }), inTop: !!document.querySelector('.topbar .date-stepper, .topbar .today-btn, .page-nav'), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }
    })
    assert.deepEqual(r, { count: 1, inside: true, inTop: false, overflow: false }, v)
  }
  for (const [w, h] of [[1500, 860], [1280, 720], [1180, 700], [1000, 700]]) {
    await step(`${w}×${h}: each dated page has one date control, on the paper, and the top bar has none`, async () => {
      await page.setViewport({ width: w, height: h })
      for (const v of ['month', 'week', 'day', 'reflect', 'focus']) await onPaper(v)
    })
  }
  await page.setViewport({ width: 1280, height: 720 })

  const shown = () => page.$eval('.date-stepper', (e) => (e as HTMLElement).innerText.replace(/\s+/g, ' '))
  const next = '.date-stepper button[aria-label^="Next "]'
  const prev = '.date-stepper button[aria-label^="Previous "]'
  await step('Day: the arrows and Today turn the written date, and stay under the pointer', async () => {
    await visit(page, 'day', '2026-11-09')
    assert.match(await shown(), /Date: Nov 9/)
    const at = await left(page, next)
    await page.click(next)
    await sleep(120)
    assert.match(await shown(), /Date: Nov 10/)
    assert.equal(await left(page, next), at)
    await page.click(prev)
    await sleep(60)
    await page.click(prev)
    await sleep(120)
    assert.match(await shown(), /Date: Nov 8/)
    await page.click('.date-stepper .today-btn')
    await sleep(120)
    assert.equal(await page.$eval('.date-stepper .today-btn', (e) => getComputedStyle(e).visibility), 'hidden', 'nothing to go back to')
    await page.click(next)
    await sleep(120)
    assert.equal(await page.$eval('.date-stepper .today-btn', (e) => getComputedStyle(e).visibility), 'visible', 'shows once you have left today')
    assert.equal(await page.$eval('.date-stepper .today-btn', (e) => (e as HTMLElement).innerText.trim()), '', 'a mark, not a word')
    assert.equal((await left(page, '.date-field')) > (await left(page, next)), true, 'the arrows sit together before the date')
    assert.equal((await left(page, next)) - (await left(page, prev)), 18)
  })
  await step('Week, Reflect and Focus step a week, on From and To', async () => {
    for (const v of ['week', 'reflect', 'focus']) {
      await visit(page, v, '2026-11-09')
      assert.match(await shown(), /From: Nov 9 To: Nov 15/, v)
      const at = await left(page, next)
      await page.click(next)
      await sleep(120)
      assert.match(await shown(), /From: Nov 16 To: Nov 22/, v)
      assert.equal(await left(page, next), at, v)
      await page.click(next)
      await page.click(next)
      await sleep(120)
      assert.match(await shown(), /From: Nov 30 To: Dec 6/, v)
      assert.equal(await left(page, next), at, `${v}, across months`)
    }
  })
  await step('Month: the arrows step a month, across the year end; Today returns; the arrow keys still work', async () => {
    await visit(page, 'month', '2026-12-09')
    assert.match(await shown(), /Dec 2026/i)
    assert.equal(await page.$eval('.picker-m.is-on', (e) => e.textContent), 'Dec')
    await page.click(next)
    await sleep(150)
    assert.match(await shown(), /Jan 2027/i)
    assert.equal(await page.$eval('.picker-m.is-on', (e) => e.textContent), 'Jan')
    await page.keyboard.press('ArrowLeft')
    await sleep(150)
    assert.match(await shown(), /Dec 2026/i)
    await page.click('.date-stepper .today-btn')
    await sleep(150)
    assert.equal(await page.$eval('.date-stepper .today-btn', (e) => getComputedStyle(e).visibility), 'hidden')
  })

  await step('Every button names what it does: same words in tooltip and label, per page, and the tooltip shows without shifting anything', async () => {
    const words = { day: 'day', week: 'week', reflect: 'week', focus: 'week', month: 'month' }
    for (const [v, unit] of Object.entries(words)) {
      await visit(page, v, '2026-11-16')
      const tips = await page.$$eval('.date-stepper button', (b) => b.map((x) => [x.getAttribute('aria-label'), x.getAttribute('data-tip'), x.hasAttribute('title')]))
      assert.deepEqual(tips, [['Back to today', 'Back to today', false], [`Previous ${unit}`, `Previous ${unit}`, false], [`Next ${unit}`, `Next ${unit}`, false]], v)
      const before = await page.$eval('.date-stepper', (e) => JSON.stringify(e.getBoundingClientRect()))
      await page.hover(`.date-stepper button[aria-label^="Next "]`)
      await sleep(250)
      const t = await page.$eval('.date-stepper button[aria-label^="Next "]', (e) => { const o = getComputedStyle(e, '::after'); return [o.opacity, o.content] })
      assert.deepEqual(t, ['1', `"Next ${unit}"`], v)
      assert.equal(await page.$eval('.date-stepper', (e) => JSON.stringify(e.getBoundingClientRect())), before, `${v}: no layout shift`)
      await page.mouse.move(5, 400)
      await sleep(100)
    }
  })
  await step('Month: same order and sizes as Day, and fits above the picker', async () => {
    const geo = () => page.$eval('.date-stepper', (e) => [...e.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))
    await visit(page, 'day', '2026-11-16')
    const day = await geo()
    await visit(page, 'month', '2026-11-16')
    assert.deepEqual(await geo(), day)
    const r = await page.evaluate(() => {
      const s = document.querySelector('.date-stepper')!.getBoundingClientRect()
      const p = document.querySelector('.month-picker')!.getBoundingClientRect()
      return { inside: s.left >= p.left - 1 && s.right <= p.right + 1, today: document.querySelector('.date-stepper button')!.getBoundingClientRect().left < document.querySelector('.date-stepper button[aria-label^="Next "]')!.getBoundingClientRect().left }
    })
    assert.deepEqual(r, { inside: true, today: true })
    const a = await left(page, next)
    await visit(page, 'month', '2026-11-09')
    assert.equal(await left(page, next), a, 'arrows do not move with the mark')
  })

  await step('Nothing to step through on Contacts or in Settings', async () => {
    await visit(page, 'contacts')
    assert.equal(await page.$('.date-stepper'), null)
    await visit(page, 'day')
    await page.click('button[aria-label="Settings"]')
    await sleep(200)
    assert.equal(await page.$('.topbar .date-stepper'), null)
    await page.keyboard.press('Escape')
  })

  await step('A stored Updates section on the web falls back to the first section', async () => {
    await page.evaluate(() => sessionStorage.setItem('duckbook:settings-section', 'updates'))
    await page.reload()
    await page.waitForSelector('.tabs')
    await page.click('button[aria-label="Settings"]')
    await page.waitForSelector('.sd-head')
    assert.equal(await page.$eval('.sd-head h2', (e) => e.textContent), 'Look & feel')
  })

  console.log('all passed')
} catch (e) {
  console.log(`FAIL: ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
  await sleep(300)
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
