// Day photo titles and descriptions: typing, limits, viewer keys, persistence and paste.
// Synthetic data only; throwaway server on a spare port with a fresh temp data dir.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { MAX_PHOTO_DESCRIPTION, MAX_PHOTO_TITLE } from '../src/lib/schema.ts'

const port = 5442
const origin = `http://localhost:${port}`
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-photo-text-'))
const shots = path.join(os.tmpdir(), 'duckbook-photo-text-shots')
fs.mkdirSync(shots, { recursive: true })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, DUCKBOOK_PORT: String(port), DUCKBOOK_DATA_DIR: dir }, stdio: 'ignore' })
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
const step = async (name: string, fn: () => Promise<void>) => {
  await fn()
  console.log(`ok - ${name}`)
}
const value = (page: Page, sel: string) => page.$eval(sel, (e) => (e as HTMLInputElement | HTMLTextAreaElement).value)
const titleText = (page: Page) => page.$eval('.polaroid-title', (e) => (e as HTMLInputElement).value ?? e.textContent ?? '')
const apiDocs = (page: Page) =>
  page.evaluate(async () => ((await (await fetch('/api/data', { headers: { 'X-Duckbook': '1' } })).json()) as { docs: { key: string; value: any }[] }).docs)
const waitSaved = (page: Page) => page.waitForSelector('[data-save="saved"]', { timeout: 8000 })
const shot = async (page: Page, name: string) => {
  fs.mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, `${name}.png`) })
}
// The photo card, the caption and the top controls all sit inside the window.
const viewerInside = (page: Page) =>
  page.$$eval('.viewer-mount, .viewer-caption, .viewer-controls, .viewer-nav', (els) =>
    els.length >= 3 &&
    els.every((e) => {
      const r = e.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth
    }),
  )
// The print's box, to prove it does not move when the caption appears or grows.
const mountBox = (page: Page) =>
  page.$eval('.viewer-mount', (e) => {
    const r = e.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  })
const controls = (page: Page) => page.$$eval('.viewer-controls > *', (els) => els.map((e) => e.className))
const paste = async (page: Page, text: string) => {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyV')
  await page.keyboard.up('Control')
}
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) break
    } catch {}
    await sleep(100)
  }
  await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
  const page = await browser.newPage()
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
  await page.bringToFront()
  await page.evaluateOnNewDocument(() => localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus'])))
  await page.setViewport({ width: 1440, height: 900 })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !/401|409|Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('dialog', (d) => void d.accept())
  let resting = { x: 0, y: 0, w: 0, h: 0 }

  await step('a synthetic photo gets a title written on its white strip', async () => {
    await page.goto(`${origin}/#/day/2026-11-11`)
    await page.waitForSelector('.day-photos input[type=file]')
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 320
      c.height = 240
      const g = c.getContext('2d')!
      g.fillStyle = '#7f8fbf'
      g.fillRect(0, 0, 320, 240)
      g.fillStyle = '#fff'
      g.fillRect(40, 40, 80, 60)
      return c.toDataURL('image/png').split(',')[1]
    })
    const file = path.join(dir, 'synthetic-photo.png')
    fs.writeFileSync(file, Buffer.from(png, 'base64'))
    await (await page.$('.day-photos input[type=file]'))!.uploadFile(file)
    await page.waitForFunction(() => document.querySelectorAll('.day-photos .polaroid-img img').length === 1, { timeout: 20000 })
    await waitSaved(page)

    // Without a title the strip is blank; the faint hint appears on hover only.
    await shot(page, '00-polaroid-without-title')
    await page.hover('.day-photos .polaroid')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.polaroid-title-hint')!).opacity !== '0')
    await sleep(200)
    await shot(page, '00-polaroid-title-hint')

    await page.click('.polaroid-title')
    await page.keyboard.type('Buổi sáng')
    await waitSaved(page)
    assert.equal(await value(page, '.polaroid-title'), 'Buổi sáng')
    const photo = (await apiDocs(page)).find((d) => d.key === 'day:2026-11-11')!.value.photos[0]
    assert.equal(photo.title, 'Buổi sáng')
    assert.equal(photo.description, undefined, 'no description yet')
    await page.$eval('.polaroid-title', (e) => (e as HTMLInputElement).blur())
    await page.mouse.move(5, 400)
    await shot(page, '00-polaroid-with-title')
  })

  await step('the title is one line and stops at its limit', async () => {
    await page.click('.polaroid-title', { count: 3 })
    await page.keyboard.type('x'.repeat(40))
    assert.equal((await value(page, '.polaroid-title')).length, 30)
    await waitSaved(page)
    const photo = (await apiDocs(page)).find((d) => d.key === 'day:2026-11-11')!.value.photos[0]
    assert.equal(photo.title.length, 30)
    await page.click('.polaroid-title', { count: 3 })
    await page.keyboard.type('Buổi sáng')
    await waitSaved(page)
  })

  await step('opening a photo shows no caption, and the pencil writes one under the print', async () => {
    // A second photo makes the viewer's arrows meaningful.
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 240
      c.height = 320
      const g = c.getContext('2d')!
      g.fillStyle = '#bf8f7f'
      g.fillRect(0, 0, 240, 320)
      return c.toDataURL('image/png').split(',')[1]
    })
    const file = path.join(dir, 'synthetic-photo-2.png')
    fs.writeFileSync(file, Buffer.from(png, 'base64'))
    await (await page.$('.day-photos input[type=file]'))!.uploadFile(file)
    await page.waitForFunction(() => document.querySelectorAll('.day-photos .polaroid-img img').length === 2, { timeout: 20000 })
    await waitSaved(page)

    await page.click('.day-photos .polaroid-img')
    await page.waitForSelector('.viewer')
    await sleep(300)
    // No description: no text, no placeholder, no frame under the print.
    assert.equal(await page.$$eval('.viewer-text, .viewer-note', (x) => x.length), 0, 'nothing is shown under the print')
    assert.equal(await page.$eval('.viewer-caption', (e) => e.textContent), '')
    const caption = await page.$eval('.viewer-caption', (e) => {
      const s = getComputedStyle(e)
      return { bg: s.backgroundColor, border: s.borderTopWidth, outline: s.outlineStyle }
    })
    assert.deepEqual(caption, { bg: 'rgba(0, 0, 0, 0)', border: '0px', outline: 'none' }, 'the caption is frameless')
    // The top row is the date, the count, the pencil and the close, in that order.
    assert.deepEqual(await controls(page), ['viewer-date', 'viewer-count', 'viewer-pencil', 'viewer-close'])
    assert.equal(await page.$eval('.viewer-date', (e) => e.textContent), 'Wednesday, November 11')
    assert.equal(await page.$eval('.viewer-count', (e) => e.textContent), '1 / 2')
    assert.equal(await viewerInside(page), true, 'the viewer stays inside the window')
    resting = await mountBox(page)
    await shot(page, '01-viewer-no-description')

    // The pencil opens the caption for writing, in the same place and the same light ink.
    await page.click('.viewer-pencil')
    await page.waitForSelector('.viewer-note')
    assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('viewer-note')), 'the caption takes the caret')
    assert.equal(await page.$eval('.viewer-limit', (e) => e.textContent), '0 / 280')
    assert.equal(await page.$eval('.viewer-note', (e) => getComputedStyle(e).color), 'rgb(238, 241, 248)', 'the caption is light on the dim page')
    await page.keyboard.type('Synthetic note on the back.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second line.')
    await waitSaved(page)
    const photo = (await apiDocs(page)).find((d) => d.key === 'day:2026-11-11')!.value.photos[0]
    assert.equal(photo.description, 'Synthetic note on the back.\nSecond line.')
    assert.deepEqual(await mountBox(page), resting, 'the print does not move while the caption is written')
    await sleep(250)
    await shot(page, '02-viewer-editing')

    // Blur leaves editing and shows the plain caption.
    await page.$eval('.viewer-note', (e) => (e as HTMLTextAreaElement).blur())
    await page.waitForFunction(() => !document.querySelector('.viewer-note'))
    assert.equal(await page.$eval('.viewer-text', (e) => e.textContent), 'Synthetic note on the back.\nSecond line.')
    assert.deepEqual(await mountBox(page), resting, 'the print does not move when the caption appears')
    await sleep(250)
    await shot(page, '03-viewer-short-description')

    // The keyboard still belongs to the viewer when the caption is not being written.
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(() => /2 \/ 2/.test(document.querySelector('.viewer-count')!.textContent!))
    await page.keyboard.press('ArrowLeft')
    await page.waitForFunction(() => /1 \/ 2/.test(document.querySelector('.viewer-count')!.textContent!))
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer'))
  })

  await step('the caption keys stay in the note, and the viewer keys still work after it', async () => {
    await page.click('.day-photos .polaroid-img')
    await page.waitForSelector('.viewer')
    await page.click('.viewer-pencil')
    await page.waitForSelector('.viewer-note')
    const counter = () => page.$eval('.viewer-count', (e) => e.textContent)
    assert.equal(await counter(), '1 / 2')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    assert.equal(await counter(), '1 / 2', 'arrows did not step the photo')
    await page.keyboard.type('t')
    await page.keyboard.type('l')
    assert.equal(await page.evaluate(() => location.hash), '#/day/2026-11-11', 'page keys did not turn the page')
    assert.equal(await page.$('.lock-shell'), null, 'the notebook did not lock')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    // Escape leaves the caption, not the viewer.
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer-note'))
    assert.ok(await page.$('.viewer'), 'Escape left the caption, not the viewer')
    await page.keyboard.press('ArrowRight')
    assert.equal(await counter(), '2 / 2', 'the viewer still steps once the caption is left')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer'))
  })

  await step('the title and the caption survive a reload, and a short caption has no scrollbar', async () => {
    await page.evaluate(() => (window as unknown as { duckbookFlush: () => Promise<boolean> }).duckbookFlush())
    await page.reload()
    await page.waitForSelector('.day-photos .polaroid-img img')
    assert.equal(await titleText(page), 'Buổi sáng')
    await page.click('.day-photos .polaroid-img')
    await page.waitForSelector('.viewer-text')
    assert.equal(await page.$eval('.viewer-text', (e) => e.textContent), 'Synthetic note on the back.\nSecond line.')
    await sleep(300)
    const short = await page.$eval('.viewer-text', (e) => {
      const s = getComputedStyle(e)
      return { scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, color: s.color, bg: s.backgroundColor, align: s.textAlign }
    })
    assert.ok(short.scrollHeight <= short.clientHeight, `a short caption does not scroll: ${JSON.stringify(short)}`)
    assert.equal(short.color, 'rgb(238, 241, 248)')
    assert.equal(short.bg, 'rgba(0, 0, 0, 0)')
    assert.equal(short.align, 'center')
    assert.deepEqual(await mountBox(page), resting, 'the print sits where it did without a caption')
    assert.equal(await viewerInside(page), true, 'the viewer stays inside the window')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer'))
  })

  const longText = (
    'A slow morning by the water, the bridge and the reeds and the light in long bands. We walked until the path ran out, then sat on the stones and watched the river carry the day away. '
  ).repeat(4).slice(0, 277)
  // Four lines and 280 characters, with every line long enough to wrap in a narrow window.
  const longDescription = longText.slice(0, 101) + '\n' + longText.slice(101, 159) + '\n' + longText.slice(159, 217) + '\n' + longText.slice(217)

  await step('the caption stops at 280 characters, shows the limit gently, and stays inside the window', async () => {
    await page.click('.day-photos .polaroid-img')
    await page.waitForSelector('.viewer-text')
    await page.click('.viewer-pencil')
    await page.waitForSelector('.viewer-note')
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.keyboard.type(longDescription + ' extra text past the limit')
    const typed = await value(page, '.viewer-note')
    assert.equal(typed.length, 280)
    assert.equal(typed.split('\n').length, 4, 'the caption keeps four lines')
    assert.equal(typed, longDescription)
    assert.equal(await page.$eval('.viewer-limit', (e) => e.textContent), '280 / 280')
    await waitSaved(page)
    const photo = (await apiDocs(page)).find((d) => d.key === 'day:2026-11-11')!.value.photos[0]
    assert.equal(photo.description.length, 280)
    assert.equal(photo.description.split('\n').length, 4)
    assert.deepEqual(await mountBox(page), resting, 'the print does not move while the caption grows')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer-note'))
    const long = await page.$eval('.viewer-text', (e) => {
      const s = getComputedStyle(e)
      return { scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, maxHeight: s.maxHeight, overflowY: s.overflowY }
    })
    assert.ok(long.scrollHeight <= long.clientHeight, `280 characters fit the kept room: ${JSON.stringify(long)}`)
    assert.equal(long.overflowY, 'auto')
    assert.equal(await viewerInside(page), true, 'the viewer stays inside the window')
    await sleep(250)
    await shot(page, '04-viewer-280')

    // A narrow window keeps the print, the caption and the controls inside it too.
    await page.setViewport({ width: 420, height: 800 })
    await sleep(250)
    assert.equal(await viewerInside(page), true, 'the viewer stays inside a narrow window')
    await shot(page, '05-viewer-narrow')
    await page.setViewport({ width: 1440, height: 900 })
    await sleep(150)

    // Put the short caption back for the rest of the checks.
    await page.click('.viewer-pencil')
    await page.waitForSelector('.viewer-note')
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.keyboard.type('Synthetic note on the back.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second line.')
    await waitSaved(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer-note'))
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer'))
  })

  await step('Enter stops at four lines, and a pasted many-line text folds into four', async () => {
    await page.click('.day-photos .polaroid-img')
    await page.waitForSelector('.viewer-text')
    await page.click('.viewer-pencil')
    await page.waitForSelector('.viewer-note')
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.keyboard.type('one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await page.keyboard.press('Enter')
    await page.keyboard.type('three')
    await page.keyboard.press('Enter')
    await page.keyboard.type('four')
    for (let i = 0; i < 8; i++) await page.keyboard.press('Enter')
    assert.equal(await value(page, '.viewer-note'), 'one\ntwo\nthree\nfour', 'Enter does nothing past four lines')
    assert.equal(await page.$eval('.viewer-limit', (e) => e.textContent), '18 / 280')
    await sleep(200)
    await shot(page, '08-after-enter-more')

    // A paste with many breaks folds the extra lines into the fourth with a space.
    await page.click('.viewer-note')
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await paste(page, 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight')
    await waitSaved(page)
    assert.equal(await value(page, '.viewer-note'), 'one\ntwo\nthree\nfour five six seven eight')
    await sleep(200)
    await shot(page, '09-pasted-many-lines')

    // Put the short caption back for the rest of the checks.
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.keyboard.type('Synthetic note on the back.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second line.')
    await waitSaved(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer-note'))
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer'))
  })

  await step('a four-line 280-character caption fits at the desktop window sizes', async () => {
    await page.click('.day-photos .polaroid-img')
    await page.waitForSelector('.viewer-text')
    await page.click('.viewer-pencil')
    await page.waitForSelector('.viewer-note')
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.keyboard.type(longDescription)
    await waitSaved(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer-note'))
    // The desktop app opens at 1440x940 and can go down to its 900x650 minimum, or up to 1.3 size.
    for (const [w, h] of [[1440, 940], [1440, 900], [1280, 800], [900, 650], [692, 500], [420, 800]]) {
      await page.setViewport({ width: w, height: h })
      await sleep(250)
      assert.equal(await viewerInside(page), true, `the viewer stays inside ${w}x${h}`)
      const fits = await page.$eval('.viewer-text', (e) => e.scrollHeight <= e.clientHeight)
      assert.equal(fits, true, `the four-line caption fits without a scrollbar at ${w}x${h}`)
    }
    await page.setViewport({ width: 1440, height: 900 })
    await sleep(200)
    await shot(page, '10-four-line-caption')

    // Put the short caption back for the rest of the checks.
    await page.click('.viewer-pencil')
    await page.waitForSelector('.viewer-note')
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.keyboard.type('Synthetic note on the back.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second line.')
    await waitSaved(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer-note'))
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer'))
  })

  await step('a large photo leaves room for the top controls and the caption', async () => {
    await page.goto(`${origin}/#/day/2026-11-12`)
    await page.waitForSelector('.day-photos input[type=file]')
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 1600
      c.height = 1200
      const g = c.getContext('2d')!
      g.fillStyle = '#7f8fbf'
      g.fillRect(0, 0, 1600, 1200)
      g.fillStyle = '#fff'
      g.fillRect(200, 200, 400, 300)
      return c.toDataURL('image/png').split(',')[1]
    })
    const file = path.join(dir, 'synthetic-photo-large.png')
    fs.writeFileSync(file, Buffer.from(png, 'base64'))
    await (await page.$('.day-photos input[type=file]'))!.uploadFile(file)
    await page.waitForFunction(() => document.querySelectorAll('.day-photos .polaroid-img img').length === 1, { timeout: 30000 })
    await waitSaved(page)
    await page.click('.day-photos .polaroid-img')
    await page.waitForSelector('.viewer')
    for (const [w, h] of [[1440, 900], [1280, 800], [900, 650], [692, 500]]) {
      await page.setViewport({ width: w, height: h })
      await sleep(250)
      assert.equal(await viewerInside(page), true, `the viewer stays inside ${w}x${h}`)
      const boxes = await page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect()
        const controls = r('.viewer-controls')
        const mount = r('.viewer-mount')
        const caption = r('.viewer-caption')
        return { controlsBottom: controls.bottom, mountTop: mount.top, mountBottom: mount.bottom, captionTop: caption.top }
      })
      assert.ok(boxes.controlsBottom <= boxes.mountTop, `the top controls clear the print at ${w}x${h}: ${JSON.stringify(boxes)}`)
      assert.ok(boxes.mountBottom <= boxes.captionTop, `the caption sits under the print at ${w}x${h}: ${JSON.stringify(boxes)}`)
    }
    await page.setViewport({ width: 1440, height: 900 })
    await sleep(200)
    await shot(page, '07-viewer-large-photo')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer'))
  })

  await step('the Month photo mark opens the viewer with the title, read-only, and the day link', async () => {
    await page.goto(`${origin}/#/month/2026-11-11`)
    await page.waitForSelector('[data-day="2026-11-11"] .photo-mark')
    await page.click('[data-day="2026-11-11"] .photo-mark')
    await page.waitForSelector('.viewer-title')
    assert.equal(await page.$eval('.viewer-title', (e) => e.textContent), 'Buổi sáng')
    assert.equal(await page.$$eval('.viewer-title input, .viewer-title textarea', (x) => x.length), 0, 'the title is read-only here')
    assert.equal(await page.$eval('.viewer-text', (e) => e.textContent), 'Synthetic note on the back.\nSecond line.')
    assert.equal(await page.$eval('.viewer-link', (e) => e.textContent), 'Open day →')
    assert.deepEqual(await controls(page), ['viewer-date', 'viewer-count', 'viewer-link', 'viewer-pencil', 'viewer-close'])
    // The date is plain text in the row: clicking it keeps the viewer open.
    await page.click('.viewer-date')
    assert.ok(await page.$('.viewer'), 'clicking the date keeps the viewer open')
    await sleep(200)
    await shot(page, '06-month-viewer')
    // The pencil still writes the caption here, and Escape returns to the plain caption.
    await page.click('.viewer-pencil')
    await page.waitForSelector('.viewer-note')
    assert.equal(await page.$eval('.viewer-limit', (e) => e.textContent), '40 / 280')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer-note'))
    // Open day → leaves the viewer and turns to the day.
    await page.click('.viewer-link')
    await page.waitForFunction(() => !document.querySelector('.viewer'))
    await page.waitForFunction(() => location.hash === '#/day/2026-11-11')
  })

  await step('pasting text into a title or a caption stays text and adds no photo', async () => {
    await page.goto(`${origin}/#/day/2026-11-11`)
    await page.waitForSelector('.day-photos .polaroid-img img')
    await page.click('.polaroid-title', { count: 3 })
    await paste(page, 'pasted title')
    await waitSaved(page)
    assert.equal(await value(page, '.polaroid-title'), 'pasted title')
    let photos = (await apiDocs(page)).find((d) => d.key === 'day:2026-11-11')!.value.photos
    assert.equal(photos.length, 2, 'pasting text added no photo')

    await page.click('.day-photos .polaroid-img')
    await page.waitForSelector('.viewer-text')
    await page.click('.viewer-pencil')
    await page.waitForSelector('.viewer-note')
    await paste(page, 'pasted note')
    await waitSaved(page)
    assert.match(await value(page, '.viewer-note'), /pasted note/)
    photos = (await apiDocs(page)).find((d) => d.key === 'day:2026-11-11')!.value.photos
    assert.equal(photos.length, 2, 'pasting text into the caption added no photo')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer'))
  })

  await step('a title and a caption cut on code points, never leaving half an emoji', async () => {
    const emoji = '😀'
    const emojiTitle = 'a'.repeat(MAX_PHOTO_TITLE - 1) + emoji + 'b'
    const emojiDescription = 'b'.repeat(MAX_PHOTO_DESCRIPTION - 1) + emoji + 'c'
    // A value past the input's own limit, as an older cut or another browser could hand it over.
    await page.click('.polaroid-title', { count: 3 })
    await page.waitForSelector('input.polaroid-title')
    await page.$eval('input.polaroid-title', (e) => e.removeAttribute('maxlength'))
    await page.keyboard.sendCharacter(emojiTitle)
    await sleep(100)
    await waitSaved(page)
    assert.equal(await value(page, 'input.polaroid-title'), 'a'.repeat(MAX_PHOTO_TITLE - 1) + emoji)
    let photo = (await apiDocs(page)).find((d) => d.key === 'day:2026-11-11')!.value.photos[0]
    assert.equal(photo.title, 'a'.repeat(MAX_PHOTO_TITLE - 1) + emoji)
    assert.doesNotMatch(photo.title, LONE_SURROGATE)
    await page.$eval('input.polaroid-title', (e) => (e as HTMLInputElement).blur())

    await page.click('.day-photos .polaroid-img')
    await page.waitForSelector('.viewer-text')
    await page.click('.viewer-pencil')
    await page.waitForSelector('.viewer-note')
    await page.click('.viewer-note')
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.$eval('.viewer-note', (e) => e.removeAttribute('maxlength'))
    await page.keyboard.sendCharacter(emojiDescription)
    await sleep(100)
    await waitSaved(page)
    assert.equal(await value(page, '.viewer-note'), 'b'.repeat(MAX_PHOTO_DESCRIPTION - 1) + emoji)
    photo = (await apiDocs(page)).find((d) => d.key === 'day:2026-11-11')!.value.photos[0]
    assert.equal(photo.description, 'b'.repeat(MAX_PHOTO_DESCRIPTION - 1) + emoji)
    assert.doesNotMatch(photo.description, LONE_SURROGATE)

    // Put back the text the next checks use.
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.keyboard.type('pasted note')
    await waitSaved(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer-note'))
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.viewer'))
    await page.click('.polaroid-title', { count: 3 })
    await page.keyboard.type('pasted title')
    await waitSaved(page)
  })

  await step('locking leaves no title or description text in the DOM', async () => {
    await page.click('button[aria-label="Settings"]')
    await page.waitForSelector('.settings')
    await (await page.waitForSelector('xpath/.//button[contains(@class,"sd-tab") and normalize-space(.)="Privacy"]'))!.click()
    const [set] = await page.$$('xpath/.//button[contains(., "Set a 6-digit PIN")]')
    await set.click()
    const fields = await page.$$('.pin-field input')
    await fields[0].type('246810')
    await fields[1].type('246810')
    const [save] = await page.$$('xpath/.//button[contains(., "Save PIN")]')
    await save.click()
    await page.waitForFunction(() => document.body.innerText.includes('PIN saved'))
    await page.click('button[aria-label="Close settings"]')
    await page.waitForFunction(() => !document.querySelector('.settings'))
    await page.goto(`${origin}/#/day/2026-11-11`)
    await page.waitForSelector('.day-photos .polaroid-img img')
    await page.click('button[aria-label="Lock"]')
    await page.waitForSelector('.lock-shell .pin-dots')
    const text = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('textarea, input')].map((e) => (e as HTMLInputElement).value).join(' '))
    assert.doesNotMatch(text, /Buổi sáng|pasted title|Synthetic note on the back|pasted note/)
    assert.equal(await page.$$eval('.polaroid-title, .viewer-note, .viewer-text', (x) => x.length), 0)
    await page.keyboard.type('246810')
    await page.waitForSelector('.day-page')
  })

  assert.deepEqual(errors, [], 'no page errors')
  console.log('all passed')
} catch (e) {
  console.log(`FAIL: ${(e as Error).stack ?? e}`)
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
  await sleep(300)
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
