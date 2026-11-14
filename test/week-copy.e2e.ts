// Copying a week's plan in the browser: the button, the Settings switch, and the automatic copy on a
// simulated week change. Throwaway server, temp data dir, synthetic data only.
// Run: npm run build && node test/week-copy.e2e.ts   (E2E_SHOTS=<folder> saves screenshots)
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type ElementHandle, type HTTPRequest, type Page } from 'puppeteer-core'
import { API_LEVEL } from '../src/lib/schema.ts'

const PORT = Number(process.env.DUCKBOOK_TEST_PORT ?? 5437)
const BASE = `http://localhost:${PORT}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-weekcopy-e2e-'))
const shots = process.env.E2E_SHOTS ?? ''
if (shots) fs.mkdirSync(shots, { recursive: true })
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p))
if (!browserPath) throw new Error('No Chrome/Edge found for browser checks.')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const serverLog = fs.openSync(path.join(os.tmpdir(), `duckbook-weekcopy-e2e-server-${PORT}.log`), 'w')
const server = spawn(process.execPath, ['server/main.ts'], { env: { ...process.env, DUCKBOOK_DATA_DIR: dataDir, DUCKBOOK_PORT: String(PORT) }, stdio: ['ignore', serverLog, serverLog] })
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`, { headers: { 'X-Duckbook': '1' } })).ok) break
  } catch {}
  if (i > 50) throw new Error('test server did not start')
  await sleep(100)
}
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, defaultViewport: { width: 1500, height: 1000 } })

const W1 = '2026-11-02'
const W2 = '2026-11-09'
const W3 = '2026-11-16'
const W4 = '2026-11-23'
const COPIED = ['synthetic A', 'synthetic B', 'synthetic C', 'synthetic D', 'synthetic work in a box', 'synthetic work unsorted']

const step = async (name: string, fn: () => Promise<void>) => {
  await fn()
  console.log(`ok - ${name}`)
}
const shot = async (page: Page, name: string) => {
  if (!shots) return
  await sleep(250)
  await page.screenshot({ path: path.join(shots, `${name}.png`) as `${string}.png` })
}

const fixture = () => ({
  version: 1,
  settings: { ink: 'serif', focusMin: 25, breakMin: 5, modules: { focusMap: true, contacts: false, holidays: false, disc: false } },
  focus: {
    ideas: [
      { id: 'i-box', text: 'synthetic work in a box', x: 0.5, y: 0.5, status: 'doing', date: null, createdAt: '' },
      { id: 'i-loose', text: 'synthetic work unsorted', x: 0.2, y: 0.5, status: 'idea', date: null, createdAt: '' },
      { id: 'i-done', text: 'synthetic work finished', x: 0.7, y: 0.5, status: 'done', date: null, createdAt: '' },
      { id: 'i-never', text: 'synthetic idea never planned', x: 0.5, y: 0.2, status: 'idea', date: null, createdAt: '' },
    ],
  },
  weeks: {
    [W1]: {
      goal: 'synthetic goal',
      notes: 'synthetic week notes',
      selfCare: 'synthetic walk',
      reflection: { checkin: 'synthetic check-in', success: '', lesson: '', future: '', more: '', reviewed: true },
      habits: [{ id: 'h1', name: 'synthetic habit', days: [true, true, false, false, true, false, false] }],
      tasks: [
        { id: 'a', text: 'synthetic A', q: 'A', done: false },
        { id: 'b', text: 'synthetic B', q: 'B', done: false },
        { id: 'c', text: 'synthetic C', q: 'C', done: false },
        { id: 'd', text: 'synthetic D', q: 'D', done: false },
        { id: 'f', text: 'synthetic finished', q: 'A', done: true },
        { id: 'u', text: 'synthetic unsorted', q: null, done: false },
        { id: 'wb', text: 'synthetic work in a box', q: 'B', done: false, ideaId: 'i-box' },
        { id: 'wl', text: 'synthetic work unsorted', q: null, done: false, ideaId: 'i-loose' },
        { id: 'wd', text: 'synthetic work finished', q: 'A', done: true, ideaId: 'i-done' },
      ],
    },
  },
  days: { [W1]: { grateful: '', notes: '', sentence: '', tasks: [{ id: 'dt', text: 'synthetic day task', estimate: 1, pomos: 0, done: false, weekTaskId: 'a' }] } },
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
const texts = (w: any) => w.tasks.map((t: any) => t.text).sort()

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
/** The element's box once it has stopped moving: the page settles for a moment after loading. */
const settledRect = async (page: Page, sel: string) => {
  let prev = ''
  for (let i = 0; i < 25; i++) {
    const now = JSON.stringify(await page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }))
    if (now === prev) return JSON.parse(now) as number[]
    prev = now
    await sleep(100)
  }
  throw new Error(`layout never settled: ${sel}`)
}
/** A clean notebook, on the given day. */
const reset = async (page: Page, today: string, data: object = fixture()) => {
  await page.goto(`${BASE}/#/week/${today}`)
  await setToday(page, today)
  const r = await call(page, 'POST', '/api/import', { data, source: 'file', replace: true })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  // A replaced notebook starts with no pencil lines left alone on this device (as reloadAll does in the app).
  await page.evaluate(() => localStorage.removeItem('duckbook:pencil'))
  await page.reload()
  await page.waitForSelector('.week-plan')
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}
/** Keep every pencil line of the week shown, and wait for the save. */
const keepAll = async (page: Page) => {
  await page.click('.pencil-all')
  await saved(page)
}
const pencilLabel = (text: string) => `Suggestion from last week: ${text}. Press to keep it; drag across, hold, or press Delete to drop it.`
const dropLabel = (text: string) => `Drop the suggestion: ${text}`
const switchOn = async (page: Page, want: boolean) => {
  await page.click('button[aria-label="Settings"]')
  await (await page.waitForSelector('xpath/.//button[contains(@class,"sd-tab") and normalize-space(.)="Planning"]'))!.click()
  const sw = 'input[role="switch"][aria-label="Copy the plan into each new week"]'
  await page.waitForSelector(sw)
  if ((await page.$eval(sw, (e) => (e as HTMLInputElement).checked)) !== want) await page.click(sw)
  await saved(page)
  await page.click('.sd-close')
  await page.waitForSelector('.settings', { hidden: true })
}

/** A page whose clock reads `test:today`, and whose once-a-minute checks come round quickly. */
const pageErrors: string[] = []
const newPage = async () => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()) })
  page.on('response', (r) => { if (r.status() >= 400) void r.text().then((t) => pageErrors.push(`${r.status()} ${r.request().method()} ${r.url()} ${t.slice(0, 200)}`)) })
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

try {
  const page = await newPage()
  await page.goto(`${BASE}/#/week/${W2}`)

  await step('no copy button; last week’s unfinished work shows in pencil in its boxes, and nothing is saved', async () => {
    await reset(page, W2)
    assert.equal(await page.$('.copy-plan'), null, 'the title row has no copy button')
    assert.equal(await page.$('.week-plan .page-title .date-stepper button[aria-label="Next week"]') !== null, true)
    const keeps = await page.$$eval('.pencil-keep', (els) => els.map((e) => e.getAttribute('aria-label')!))
    assert.deepEqual(keeps.sort(), COPIED.map(pencilLabel).sort(), 'one pencil line per task: boxed and planned work, not plain unsorted ones')
    assert.equal(await page.$eval('.pencil-care', (e) => e.getAttribute('aria-label')), 'Suggestion from last week for Self-care: synthetic walk. Press to keep it.')
    assert.equal(await page.$eval('.pencil-all', (e) => e.textContent!.trim()), 'keep all from last week')
    assert.match(await page.$eval('.quad-A', (e) => e.innerHTML), /Suggestion from last week: synthetic A\./)
    assert.equal(await weekDoc(page, W2), undefined, 'showing pencil lines saves nothing')
    const drops = await page.$$eval('.pencil-drop', (els) => els.map((e) => e.getAttribute('aria-label')!))
    assert.deepEqual(drops.sort(), COPIED.map(dropLabel).sort(), 'one pencil × per line')
    await shot(page, '1-pencil')
    const deco = () => page.$eval('.quad-A .pencil-keep', (e) => getComputedStyle(e).textDecorationColor)
    const xOpacity = () => page.$eval('.quad-A .pencil-drop', (e) => Number(getComputedStyle(e).opacity))
    const rect = () => page.$eval('.quad-A .pencil-task', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })
    const rest = await deco()
    const xRest = await xOpacity()
    assert.ok(xRest > 0 && xRest < 0.6, 'the × is faint at rest')
    const before = await settledRect(page, '.quad-A .pencil-task')
    const clip = shots
      ? await page.$eval('.quad-A .pencil-task', (e) => { const r = e.getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 } })
      : null
    if (shots) await page.screenshot({ path: path.join(shots, '1-pencil-line-rest.png') as `${string}.png`, clip: { ...clip!, scale: 4 } })
    await page.mouse.move(before[0] + before[2] / 2, before[1] + before[3] / 2)
    await sleep(250)
    assert.equal(await deco(), rest, 'no strike hint on hover')
    const xLineHover = await xOpacity()
    assert.ok(xLineHover > xRest, 'the × darkens with the line')
    assert.deepEqual(await rect(), before, 'hover does not move the line')
    if (shots) await page.screenshot({ path: path.join(shots, '1-pencil-line-hover.png') as `${string}.png`, clip: { ...clip!, scale: 4 } })
    const xBox = await page.$eval('.quad-A .pencil-drop', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    await page.mouse.move(xBox.x, xBox.y)
    await sleep(250)
    assert.ok((await xOpacity()) > xLineHover, 'the × darkens on its own hover')
    assert.equal(await deco(), rest, 'no strike hint on the × either')
    if (shots) {
      await page.screenshot({ path: path.join(shots, '1-pencil-line-x-hover.png') as `${string}.png`, clip: { ...clip!, scale: 4 } })
      // The strike as the drop shows it: dark through the words, the line already fading. Held still for the shot.
      await page.evaluate(() => {
        const li = document.querySelector('.quad-A .pencil-task') as HTMLElement
        const b = li.querySelector('.pencil-keep') as HTMLElement
        li.style.transition = 'none'
        li.style.opacity = '0.55'
        b.style.transition = 'none'
        b.style.textDecorationColor = 'var(--ink-soft)'
        b.style.opacity = '1'
      })
      await page.screenshot({ path: path.join(shots, '1-pencil-line-mid-strike.png') as `${string}.png`, clip: { ...clip!, scale: 4 } })
      await page.evaluate(() => {
        const li = document.querySelector('.quad-A .pencil-task') as HTMLElement
        const b = li.querySelector('.pencil-keep') as HTMLElement
        li.style.transition = ''
        li.style.opacity = ''
        b.style.transition = ''
        b.style.textDecorationColor = ''
        b.style.opacity = ''
      })
      assert.deepEqual(await rect(), before, 'the strike does not move the line')
    }
    await page.mouse.move(5, 400)
  })

  await step('keep all: the right things land in the right boxes, and the old week and its day are untouched', async () => {
    const before = await weekDoc(page, W1)
    await page.click(`.pencil-keep[aria-label="${pencilLabel('synthetic A')}"]`)
    await saved(page)
    await shot(page, '2a-one-kept')
    await keepAll(page)
    await shot(page, '2-kept-all')
    const w = await weekDoc(page, W2)
    assert.deepEqual(texts(w), COPIED)
    const q = (t: string) => w.tasks.find((x: any) => x.text === t).q
    assert.deepEqual(['synthetic A', 'synthetic B', 'synthetic C', 'synthetic D', 'synthetic work in a box', 'synthetic work unsorted'].map(q), ['A', 'B', 'C', 'D', 'B', null])
    assert.ok(w.tasks.every((t: any) => !t.done))
    assert.equal(w.tasks.find((x: any) => x.text === 'synthetic work in a box').ideaId, 'i-box')
    assert.deepEqual(w.habits.map((h: any) => [h.name, h.days.filter(Boolean).length]), [['synthetic habit', 0]])
    assert.equal(w.selfCare, 'synthetic walk')
    assert.deepEqual([w.goal, w.notes, w.reflection.checkin], ['', '', ''])
    assert.deepEqual(await weekDoc(page, W1), before, 'source week unchanged')
    assert.equal(await doc(page, `day:${W2}`), undefined)
    assert.match(await page.$eval('.quad-A', (e) => (e as HTMLElement).innerHTML), /synthetic A/)
    assert.equal(await page.$eval('.brain-dump .dump-list', (e) => e.querySelectorAll('li').length), 1, 'unsorted plain task left behind; planned work stays unsorted')
  })

  await step('nothing left to keep: the lines and the keep-all line are gone, also after a reload, and nothing is added', async () => {
    const before = await weekDoc(page, W2)
    assert.equal(await page.$('.pencil-all'), null)
    assert.equal(await page.$('.pencil-keep'), null)
    assert.equal(await page.$('.pencil-care'), null)
    await page.reload()
    await page.waitForSelector('.week-plan')
    assert.equal(await page.$('.pencil-keep'), null, 'kept on this device, so not offered again')
    assert.deepEqual(await weekDoc(page, W2), before)
    await shot(page, '3-nothing-left')
  })

  await step('Focus note: an idea in two weeks shows the latest, lists both, and Move carries only the latest', async () => {
    await open(page, `focus/${W4}`, '[data-note="i-box"]')
    const note = await page.$eval('[data-note="i-box"]', (e) => (e as HTMLElement).textContent)
    assert.match(note!, /Wk 46/)
    const move = await page.$eval('[data-note="i-box"] .note-bar button[title^="Planned in"]', (e) => [e.textContent, e.getAttribute('title')])
    assert.match(move[0]!, /Move to/)
    assert.match(move[1]!, /Wk 45.*Wk 46/)
    await page.$eval('[data-note="i-box"] .note-bar button[title^="Planned in"]', (e) => (e as HTMLElement).click())
    await saved(page)
    assert.ok((await weekDoc(page, W1)).tasks.some((t: any) => t.ideaId === 'i-box'), 'the earlier week keeps its task')
    assert.ok(!(await weekDoc(page, W2)).tasks.some((t: any) => t.ideaId === 'i-box'), 'the latest copy moved')
    assert.ok((await weekDoc(page, W4)).tasks.some((t: any) => t.ideaId === 'i-box'))
  })

  await step('finishing a linked copy marks the idea and every copy; finished work is not copied on', async () => {
    await reset(page, W2)
    await keepAll(page)
    await page.waitForSelector('.quad-B .wtask')
    const box = await page.evaluateHandle(() => [...document.querySelectorAll('.quad-B .wtask')].find((li) => li.querySelector('textarea')?.value === 'synthetic work in a box')!)
    await (await (box as ElementHandle<Element>).$('button[aria-label^="Mark"], input[aria-label^="Mark"]'))!.click()
    await saved(page)
    const linked = async (m: string) => (await weekDoc(page, m)).tasks.find((t: any) => t.ideaId === 'i-box')
    assert.equal((await linked(W2)).done, true)
    assert.equal((await linked(W1)).done, true, 'the source task is the same work item')
    assert.equal((await doc(page, 'focus')).ideas.find((i: any) => i.id === 'i-box').status, 'done')
    await open(page, `week/${W3}`, '.week-plan')
    await keepAll(page)
    assert.ok(!(await weekDoc(page, W3)).tasks.some((t: any) => t.ideaId === 'i-box'))
    assert.ok(!texts(await weekDoc(page, W3)).includes('synthetic work in a box'))
  })

  await step('Move on a Focus note with two copies in the latest week moves one line, and the day task follows it', async () => {
    const data = fixture() as any
    const copies = [
      { id: 'i-box~a1', text: 'synthetic work in a box', q: 'B', done: false, ideaId: 'i-box' },
      { id: 'i-box~b2', text: 'synthetic work in a box', q: null, done: false, ideaId: 'i-box' },
    ]
    data.weeks[W2] = { goal: '', notes: '', selfCare: '', reflection: { checkin: '', success: '', lesson: '', future: '', more: '', reviewed: false }, habits: [], tasks: copies }
    data.days[W2] = { grateful: '', notes: '', sentence: '', tasks: [{ id: 'dt2', text: 'synthetic day on the unsorted copy', estimate: 1, pomos: 0, done: false, weekTaskId: 'i-box~b2' }] }
    await reset(page, W2, data)
    await open(page, `focus/${W4}`, '[data-note="i-box"]')
    await page.waitForSelector('[data-note="i-box"] .note-bar')
    await page.$$eval('[data-note="i-box"] .note-bar button.note-act', (bs) => (bs.find((b) => /Move to/.test(b.textContent ?? '')) as HTMLElement).click())
    await saved(page)
    assert.deepEqual((await weekDoc(page, W2)).tasks, [], 'the latest week lets go of both copies')
    const landed = (await weekDoc(page, W4)).tasks.filter((t: any) => t.ideaId === 'i-box')
    assert.deepEqual(landed.map((t: any) => [t.id, t.q]), [['i-box~a1', 'B']], 'one line, with the boxed copy’s box')
    assert.equal((await doc(page, `day:${W2}`)).tasks[0].weekTaskId, 'i-box~a1', 'the day task follows the line that is left')
    assert.ok((await weekDoc(page, W1)).tasks.some((t: any) => t.ideaId === 'i-box'), 'the older week keeps its copy')
  })

  await step('a notebook never connected to Drive copies at once, with no wait shown', async () => {
    await reset(page, W2)
    await switchOn(page, true)
    await setToday(page, W3)
    await open(page, `week/${W3}`, '.quad-A .wtask')
    await saved(page)
    assert.deepEqual(texts(await weekDoc(page, W3)), COPIED)
    assert.equal((await call(page, 'POST', '/api/sync/now', {})).json.joined, null, 'not joined: nothing to wait for')
    assert.equal(await page.$('.pencil-wait'), null, 'no wait shown')
  })

  await step('a past week offers no pencil lines and creates no page', async () => {
    await reset(page, W2)
    await open(page, 'week/2026-10-26', '.week-plan')
    assert.equal(await page.$('.pencil-keep'), null)
    assert.equal(await page.$('.pencil-all'), null)
    assert.equal(await page.$('.pencil-care'), null)
    await shot(page, '4-past-week')
    assert.equal(await weekDoc(page, '2026-10-26'), undefined)
  })

  await step('drawing across a pencil line drops it on this device, through a reload; keep all takes the rest', async () => {
    await reset(page, W2)
    const d = pencilLabel('synthetic D')
    const sel = `.quad-D .pencil-keep[aria-label="${d}"]`
    const lineRect = () => page.$eval('.quad-D .pencil-task', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })
    await page.waitForSelector(sel)
    const before = await settledRect(page, '.quad-D .pencil-task')
    const [bx, by, bw, bh] = before
    await page.mouse.move(bx + 6, by + bh / 2)
    await page.mouse.down()
    await page.mouse.move(bx + bw - 6, by + bh / 2, { steps: 8 })
    await sleep(50)
    assert.equal(await page.$eval('.quad-D .pencil-task', (e) => e.classList.contains('is-dropping')), true, 'the stroke crosses the line out')
    assert.deepEqual(await lineRect(), before, 'the strike does not move the line')
    await page.mouse.up()
    await page.waitForFunction((s) => !document.querySelector(s), {}, sel)
    assert.equal(await page.$(sel), null, 'gone once struck out and faded')
    await page.reload()
    await page.waitForSelector('.week-plan')
    assert.equal(await page.$(sel), null, 'still gone after a reload')
    await keepAll(page)
    assert.deepEqual(texts(await weekDoc(page, W2)), COPIED.filter((t) => t !== 'synthetic D'), 'every line but the dropped one')
  })

  await step('a press-and-hold or Delete drops a line too', async () => {
    await reset(page, W2)
    const holdSel = `.quad-B .pencil-keep[aria-label="${pencilLabel('synthetic B')}"]`
    const b = (await (await page.waitForSelector(holdSel))!.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await sleep(650)
    await page.mouse.up()
    await page.waitForFunction((s) => !document.querySelector(s), {}, holdSel)
    assert.equal(await page.$(holdSel), null, 'a hold drops the line')

    const keySel = `.quad-C .pencil-keep[aria-label="${pencilLabel('synthetic C')}"]`
    await page.focus(keySel)
    await page.keyboard.press('Delete')
    await page.waitForFunction((s) => !document.querySelector(s), {}, keySel)
    assert.equal(await page.$(keySel), null, 'Delete drops the focused line')

    await keepAll(page)
    assert.deepEqual(texts(await weekDoc(page, W2)), COPIED.filter((t) => t !== 'synthetic B' && t !== 'synthetic C'))
  })

  await step('clicking the × drops a line with the same strike and fade', async () => {
    await reset(page, W2)
    const d = pencilLabel('synthetic A')
    const sel = `.quad-A .pencil-keep[aria-label="${d}"]`
    await page.click(`.quad-A .pencil-drop[aria-label="${dropLabel('synthetic A')}"]`)
    await sleep(50)
    assert.equal(await page.$eval('.quad-A .pencil-task', (e) => e.classList.contains('is-dropping')), true, 'the × crosses the line out')
    await page.waitForFunction((s) => !document.querySelector(s), {}, sel)
    assert.equal(await page.$(sel), null, 'gone once struck out and faded')
    await page.reload()
    await page.waitForSelector('.week-plan')
    assert.equal(await page.$(sel), null, 'still gone after a reload')
    await keepAll(page)
    assert.deepEqual(texts(await weekDoc(page, W2)), COPIED.filter((t) => t !== 'synthetic A'))
  })

  await step('Settings: off by default; turning it on starts with the next week', async () => {
    await reset(page, W2)
    assert.equal((await doc(page, 'settings')).autoCopyWeek, false)
    await page.click('button[aria-label="Settings"]')
    await (await page.waitForSelector('xpath/.//button[contains(@class,"sd-tab") and normalize-space(.)="Planning"]'))!.click()
    await page.waitForSelector('input[aria-label="Copy the plan into each new week"]')
    assert.equal(await page.$eval('input[aria-label="Copy the plan into each new week"]', (e) => (e as HTMLInputElement).checked), false)
    await shot(page, '5-settings-off')
    await page.click('input[aria-label="Copy the plan into each new week"]')
    await saved(page)
    await shot(page, '6-settings-on')
    await page.click('.sd-close')
    const s = await doc(page, 'settings')
    assert.deepEqual([s.autoCopyWeek, s.autoCopiedWeek], [true, W2])
    await open(page, `week/${W2}`, '.week-plan')
    await sleep(400)
    assert.equal(await weekDoc(page, W2), undefined, 'the week under way is left to the button')
  })

  await step('off: a new week copies nothing', async () => {
    await reset(page, W2)
    await setToday(page, W3)
    await open(page, `week/${W3}`, '.week-plan')
    await sleep(400)
    assert.equal(await weekDoc(page, W3), undefined)
  })

  await step('auto: opening in a new week copies once, and a deleted copy does not come back', async () => {
    await reset(page, W2)
    await switchOn(page, true)
    await setToday(page, W3)
    await open(page, `week/${W3}`, '.quad-A .wtask')
    await saved(page)
    const w = await weekDoc(page, W3)
    assert.deepEqual(texts(w), COPIED)
    assert.equal(w.selfCare, 'synthetic walk')
    assert.equal((await doc(page, 'settings')).autoCopiedWeek, W3)
    assert.equal(await weekDoc(page, W2), undefined, 'a skipped week stays empty: copied from the latest week with content')

    const row = await page.evaluateHandle(() => [...document.querySelectorAll('.quad-A .wtask textarea')].find((t) => (t as HTMLTextAreaElement).value === 'synthetic A')!)
    await (row as ElementHandle<Element>).click()
    await page.keyboard.down('Control')
    await page.keyboard.press('KeyA')
    await page.keyboard.up('Control')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await saved(page)
    assert.ok(!texts(await weekDoc(page, W3)).includes('synthetic A'))
    await open(page, `week/${W3}`, '.week-plan')
    await sleep(500)
    assert.ok(!texts(await weekDoc(page, W3)).includes('synthetic A'), 'still gone on the next open')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await sleep(500)
    assert.ok(!texts(await weekDoc(page, W3)).includes('synthetic A'), 'and on coming back to the window')
  })

  await step('auto: browsing past and future weeks triggers nothing', async () => {
    for (const m of ['2026-12-07', W4, W2, '2026-10-26']) {
      await open(page, `week/${m}`, '.week-plan')
      await sleep(350)
      assert.equal(await weekDoc(page, m), undefined, m)
    }
    assert.equal((await doc(page, 'settings')).autoCopiedWeek, W3)
  })

  await step('auto: the week rolling over with the app open copies into the new week, wherever you are looking', async () => {
    await open(page, 'week/2026-12-07', '.week-plan')
    await setToday(page, W4)
    await page.waitForFunction((m) => fetch('/api/data', { headers: { 'X-Duckbook': '1' } }).then((r) => r.json()).then((d) => d.docs.some((x: any) => x.key === `week:${m}` && x.value.tasks.length)), { polling: 200, timeout: 5000 }, W4)
    await saved(page)
    const w = await weekDoc(page, W4)
    assert.deepEqual(texts(w), COPIED.filter((t) => t !== 'synthetic A'), 'from the week before, as the owner left it')
    assert.equal(await weekDoc(page, '2026-12-07'), undefined)
    assert.equal(await page.$eval('.from-to', (e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()), 'From: Dec 7 To: Dec 13', 'the page you were on stays')
  })

  await step('auto: after skipped weeks it copies from the latest earlier week with content', async () => {
    await setToday(page, '2026-12-14')
    await open(page, 'week/2026-12-14', '.quad-B .wtask')
    await saved(page)
    assert.deepEqual(texts(await weekDoc(page, '2026-12-14')), COPIED.filter((t) => t !== 'synthetic A'))
    assert.equal(await weekDoc(page, '2026-11-30'), undefined)
    assert.equal(await weekDoc(page, '2026-12-07'), undefined)
  })

  await step('auto: manual then auto, and two tabs at the rollover: no duplicates, no conflict', async () => {
    await reset(page, W2)
    await switchOn(page, true)
    await open(page, `week/${W2}`, '.week-plan')
    await keepAll(page)
    await open(page, `week/${W3}`, '.week-plan')
    await keepAll(page)
    const second = await newPage()
    await second.goto(`${BASE}/#/week/${W2}`)
    await second.waitForSelector('.week-plan')
    await Promise.all([setToday(page, W3)])
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await second.evaluate(() => window.dispatchEvent(new Event('focus')))
    await sleep(1200)
    assert.deepEqual(texts(await weekDoc(page, W3)), COPIED)
    assert.equal(await page.$eval('.banner.is-warn', (e) => e.textContent).catch(() => null), null)
    assert.equal(await second.$eval('.banner.is-warn', (e) => e.textContent).catch(() => null), null)
    await setToday(page, W4)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await second.evaluate(() => window.dispatchEvent(new Event('focus')))
    await sleep(1500)
    assert.deepEqual(texts(await weekDoc(page, W4)), COPIED)
    assert.equal((await weekDoc(page, W4)).habits.length, 1)
    assert.equal(await page.$eval('.banner.is-warn', (e) => e.textContent).catch(() => null), null)
    assert.equal(await second.$eval('.banner.is-warn', (e) => e.textContent).catch(() => null), null)
    await second.close()
  })

  // Requests the next steps hold back or refuse.
  let refuse: (r: HTTPRequest) => boolean = () => false
  let hold: (r: HTTPRequest) => boolean = () => false
  let puts = 0
  await page.setRequestInterception(true)
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().endsWith('/api/docs')) puts++
    if (refuse(r)) return void r.abort('connectionrefused')
    if (hold(r)) return void setTimeout(() => void r.continue(), 900)
    void r.continue()
  })
  const isData = (r: HTTPRequest) => r.method() === 'GET' && r.url().endsWith('/api/data') && !r.headers()['x-test']
  const isSave = (r: HTTPRequest) => r.method() === 'PUT' && r.url().endsWith('/api/docs')
  // The checks below read through a separate page, which nothing here refuses. It doesn't run the
  // app, so it can't make the copy itself.
  const reader = await newPage()
  await reader.goto(`${BASE}/api/health`)
  await page.bringToFront()
  const fresh = async (today: string) => {
    await setToday(reader, today)
    const r = await call(reader, 'POST', '/api/import', { data: fixture(), source: 'file', replace: true })
    assert.equal(r.status, 200, JSON.stringify(r.json))
    await page.evaluate(() => localStorage.removeItem('duckbook:pencil'))
    await open(page, `week/${today}`, '.week-plan')
  }

  await step('a page still loading writes nothing; the copy comes once it has loaded', async () => {
    await fresh(W2)
    await switchOn(page, true)
    await setToday(page, W3)
    hold = isData
    puts = 0
    await page.reload()
    await sleep(500)
    assert.equal(puts, 0, 'no save while loading')
    assert.equal(await weekDoc(reader, W3), undefined)
    hold = () => false
    await page.waitForSelector('.week-plan')
    await sleep(1800)
    assert.deepEqual(texts(await weekDoc(reader, W3)), COPIED)
  })

  await step('a failed automatic copy says so, copies nothing, and goes through once it can', async () => {
    await fresh(W2)
    await switchOn(page, true)
    refuse = isData
    await setToday(page, W3)
    await page.waitForSelector('.banner.is-warn', { timeout: 5000 })
    assert.match(await page.$eval('.banner.is-warn', (e) => e.textContent!), /wasn’t copied/)
    await shot(page, '7-auto-failed')
    assert.equal(await weekDoc(reader, W3), undefined)
    assert.equal((await doc(reader, 'settings')).autoCopiedWeek, W2, 'not marked done')
    refuse = () => false
    await page.waitForFunction(() => !document.querySelector('.banner.is-warn'), { timeout: 5000 })
    await saved(page)
    assert.deepEqual(texts(await weekDoc(reader, W3)), COPIED)
    assert.equal((await doc(reader, 'settings')).autoCopiedWeek, W3)
  })

  await step('a failed automatic copy: switching the copy off clears the banner, even while the data still fails', async () => {
    await fresh(W2)
    await switchOn(page, true)
    refuse = isData
    await setToday(page, W3)
    await page.waitForSelector('.banner.is-warn', { timeout: 5000 })
    await switchOn(page, false)
    await page.waitForFunction(() => !document.querySelector('.banner.is-warn'), { timeout: 5000 })
    refuse = () => false
    await sleep(300)
    assert.equal(await weekDoc(reader, W3), undefined, 'switched off: nothing copied')
    assert.equal((await doc(reader, 'settings')).autoCopyWeek, false)
  })

  await step('keep all that cannot save says so in the banner, and saves when it can', async () => {
    await fresh(W2)
    refuse = isSave
    await page.click('.pencil-all')
    await page.waitForSelector('.banner.is-warn', { timeout: 5000 })
    assert.match(await page.$eval('.banner.is-warn', (e) => e.textContent!), /Not saved/)
    await shot(page, '8-kept-not-saved')
    assert.equal(await weekDoc(reader, W2), undefined)
    refuse = () => false
    await page.waitForSelector('[data-save="saved"]', { timeout: 15000 })
    assert.deepEqual(texts(await weekDoc(reader, W2)), COPIED)
  })

  await step('locked: a new week copies nothing until unlock, then exactly once', async () => {
    await fresh(W2)
    await switchOn(page, true)
    assert.equal((await call(page, 'PUT', '/api/lock-settings', { pin: '246810' })).status, 200)
    await page.reload()
    await page.waitForSelector('button[aria-label="Lock"]')
    await page.click('button[aria-label="Lock"]')
    await page.waitForSelector('.lock-shell .pin-dots')
    await setToday(page, W3)
    await page.reload()
    await page.waitForSelector('.lock-shell .pin-dots')
    puts = 0
    await sleep(600)
    assert.equal(puts, 0, 'nothing written while locked')
    await page.keyboard.type('246810')
    await page.waitForSelector('.week-plan')
    await sleep(1500)
    const docs = await call(page, 'GET', '/api/data')
    const w = docs.json.docs.find((d: any) => d.key === `week:${W3}`).value
    assert.deepEqual(texts(w), COPIED)
  })

  await step('a copy still waiting to save when the notebook locks is kept and saved after unlock', async () => {
    refuse = isSave
    await setToday(page, W4)
    await page.waitForFunction(() => document.querySelector('[data-save]')?.getAttribute('data-save') !== 'saved', { timeout: 5000 })
    await sleep(300)
    await page.click('button[aria-label="Lock"]')
    await page.waitForSelector('.lock-shell .pin-dots', { timeout: 8000 })
    refuse = () => false
    await page.keyboard.type('246810')
    await page.waitForSelector('.week-plan')
    await sleep(1500)
    const docs = (await call(page, 'GET', '/api/data')).json.docs
    assert.deepEqual(texts(docs.find((d: any) => d.key === `week:${W4}`).value), COPIED)
    assert.equal(docs.find((d: any) => d.key === 'settings').value.autoCopiedWeek, W4)
  })

  console.log('all passed')
} catch (e) {
  console.log(`FAIL: ${(e as Error).stack}`)
  console.log('page errors:', pageErrors.slice(-8))
  process.exitCode = 1
} finally {
  await browser.close()
  server.kill()
  await sleep(300)
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
