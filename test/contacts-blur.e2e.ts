// Contacts privacy: Notes and DISC start blurred, the eye in each heading shows or hides them, and
// the per-section blur setting is kept on this device. Throwaway server, temp data dir, synthetic data.
// Run: npm run build && node test/contacts-blur.e2e.ts   (E2E_SHOTS=<folder> saves screenshots)
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { API_LEVEL } from '../src/lib/schema.ts'

const PORT = Number(process.env.DUCKBOOK_TEST_PORT ?? 5438)
const BASE = `http://localhost:${PORT}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-contacts-blur-e2e-'))
const shots = process.env.E2E_SHOTS ?? ''
if (shots) fs.mkdirSync(shots, { recursive: true })
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

const NOTES_AN =
  'Synthetic private note about An: patient, but sometimes distant. Prefers to plan ahead and dislikes surprises. Good with details, and can seem blunt when tired. Keeps a small circle of friends and does not like being the centre of attention. Would rather listen than talk, but will say what she thinks when asked.'
const NOTES_CHI = 'Synthetic private note about Chi.'
const people = [
  { id: 'p-an', name: 'Synthetic An', gender: 'female', day: 18, month: 11, year: 1996, disc: { D: 70, S: 30 }, notes: NOTES_AN },
  { id: 'p-binh', name: 'Synthetic Binh', gender: '', day: null, month: null, year: null, disc: {}, notes: '' },
  { id: 'p-chi', name: 'Synthetic Chi', gender: '', day: null, month: null, year: null, disc: {}, notes: NOTES_CHI },
  { id: 'p-dung', name: 'Synthetic Dung', gender: '', day: null, month: null, year: null, disc: { I: 100 }, notes: '' },
]
const fixture = () => ({
  version: 1,
  settings: { ink: 'serif', focusMin: 25, breakMin: 5, modules: { focusMap: false, contacts: true, holidays: false, disc: true } },
  contacts: { people },
  // The import needs at least one page; this one is not part of the checks.
  days: { '2026-11-18': { grateful: '', notes: '', sentence: '', tasks: [] } },
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
const docs = async (page: Page) => (await call(page, 'GET', '/api/data')).json.docs as { key: string; rev: number; value: any }[]

const step = async (name: string, fn: () => Promise<void>) => {
  await fn()
  console.log(`ok - ${name}`)
}
const shot = async (page: Page, name: string) => {
  if (!shots) return
  await sleep(350)
  await page.screenshot({ path: path.join(shots, `${name}.png`) as `${string}.png` })
}
const reset = async (page: Page) => {
  await page.goto(`${BASE}/#/contacts/2026-11-18`)
  const r = await call(page, 'POST', '/api/import', { data: fixture(), source: 'file', replace: true })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  await page.reload()
  await page.waitForSelector('.contacts-left')
}
const saved = async (page: Page) => {
  await sleep(50)
  await page.waitForSelector('[data-save="saved"]', { timeout: 5000 })
}
const pick = async (page: Page, name: string) => {
  const openName = await page.$eval('.contact-name-input', (e) => (e as HTMLTextAreaElement).value).catch(() => null)
  if (openName === name) return
  const row = await page.waitForSelector(`xpath/.//button[contains(@class,"contact-row") and .//span[contains(@class,"contact-name") and contains(.,"${name}")]]`)
  await row!.click()
  await page.waitForSelector('.contact-card')
}
const hidden = (page: Page) => page.$$eval('.contact-private.is-hidden', (x) => x.length)
const eye = (page: Page, label: string) => page.waitForSelector(`.contact-eye[aria-label="${label}"]`)
const clickEye = async (page: Page, label: string) => (await eye(page, label))!.click()
const cardShape = (page: Page) =>
  page.evaluate(() => {
    const side = document.querySelector('.contacts-side')!
    const top = side.getBoundingClientRect().top - side.scrollTop
    const r = (sel: string) => {
      const b = document.querySelector(sel)!.getBoundingClientRect()
      return [Math.round((b.top - top) * 2) / 2, Math.round(b.height * 2) / 2]
    }
    return { card: r('.contact-card'), notes: r('.contact-notes'), disc: r('.disc'), side: side.scrollHeight }
  })
/** The accessibility tree of the open card only, so the list's DISC dots are not mixed in. */
const cardTree = async (page: Page) => JSON.stringify(await page.accessibility.snapshot({ root: (await page.$('.contact-card'))!, interestingOnly: false }))
const addons = async (page: Page) => {
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.settings')
  const tab = await page.waitForSelector('xpath/.//button[contains(@class,"sd-tab") and normalize-space(.)="Add-ons"]')
  await tab!.click()
  await page.waitForSelector('input[aria-label="Blur notes"]')
}
const closeSettings = async (page: Page) => {
  await page.click('.sd-close')
  await page.waitForSelector('.settings', { hidden: true })
}
const toggle = (page: Page, label: string) => page.click(`input[role="switch"][aria-label="${label}"]`)
const switchOn = (page: Page, label: string) => page.$eval(`input[role="switch"][aria-label="${label}"]`, (e) => (e as HTMLInputElement).checked)

try {
  const page = await browser.newPage()
  // The first-visit tour would sit over the pages these steps click.
  await page.evaluateOnNewDocument(() => localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus', 'contacts'])))
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await step('a person opens with Notes and DISC blurred; the headings and their eyes stay clear', async () => {
    await reset(page)
    await pick(page, 'Synthetic An')
    assert.equal(await hidden(page), 2, 'both sections start hidden')
    assert.ok(await page.$('.contact-private.is-hidden .contact-notes'), 'notes are inside a hidden section')
    assert.ok(await page.$('.disc .contact-private.is-hidden .disc-chips'), 'the DISC chips are inside a hidden section')
    assert.ok(await page.$('.disc .contact-private.is-hidden .disc-summary'), 'the DISC description is inside a hidden section')
    assert.deepEqual(
      await page.$eval('.contact-private.is-hidden .contact-private-body', (e) => [getComputedStyle(e).filter, getComputedStyle(e).opacity, getComputedStyle(e).userSelect]),
      ['grayscale(1) blur(7px)', '0.6', 'none'],
    )
    assert.equal(await page.$('.contact-private-show'), null, 'the old Show pills are gone')
    assert.ok(await page.$('.contact-private-veil'), 'a click on the blur is offered')

    assert.equal(await page.$eval('.contact-name-input', (e) => !!e.closest('.contact-private')), false, 'the name is clear')
    assert.equal(await page.$eval('.contact-field .seg', (e) => !!e.closest('.contact-private')), false, 'gender is clear')
    assert.equal(await page.$eval('.contact-bday-edit', (e) => !!e.closest('.contact-private')), false, 'the birthday is clear')
    assert.equal(await page.$eval('.disc-head', (e) => !!e.closest('.contact-private')), false, 'the DISC heading is clear')
    assert.equal(await page.$eval('.disc-head .info', (e) => !!e.closest('[inert]')), false, 'the DISC (i) is clear')

    assert.ok(await page.$('.contact-notes-label .contact-eye svg'), 'the notes eye is beside the NOTES heading')
    assert.ok(await page.$('.disc-head .contact-eye svg'), 'the DISC eye is beside the DISC heading')
    assert.deepEqual(await page.$eval('.contact-notes-label .contact-eye', (e) => [e.getAttribute('aria-label'), e.getAttribute('data-tip')]), ['Show notes', 'Show'], 'the notes eye names its section and tooltip')
    assert.deepEqual(await page.$eval('.disc-head .contact-eye', (e) => [e.getAttribute('aria-label'), e.getAttribute('data-tip')]), ['Show DISC', 'Show'], 'the DISC eye names its section and tooltip')
    await page.hover('.contact-notes-label .contact-eye')
    await sleep(200)
    assert.deepEqual(await page.$eval('.contact-notes-label .contact-eye', (e) => { const s = getComputedStyle(e, '::after'); return [s.opacity, s.content] }), ['1', '"Show"'], 'the short tooltip shows on hover')
    await page.mouse.move(5, 5)
    assert.deepEqual(await page.$$eval('.contact-row .disc-dots', (x) => x.map((e) => getComputedStyle(e).filter)), ['none', 'none'], 'the list dots stay as they are')
    await shot(page, '1-blurred')
  })

  await step('while blurred the words are not read out, focusable, editable or selectable', async () => {
    const tree = await cardTree(page)
    assert.ok(!tree.includes(NOTES_AN), 'the notes are not in the accessibility tree')
    assert.ok(!tree.includes('direct, decisive, wants results'), 'the DISC description is not in the accessibility tree')
    assert.ok(!tree.includes('Dominance 70%'), 'the DISC shares are not in the accessibility tree')
    assert.ok(tree.includes('Show notes') && tree.includes('Show DISC'), 'the eye controls are announced')
    assert.ok(tree.includes('DISC describes how someone tends to act'), 'the DISC heading and (i) are still announced')

    assert.equal(await page.evaluate(() => { const n = document.querySelector<HTMLTextAreaElement>('.contact-notes')!; n.focus(); return document.activeElement === n }), false, 'the notes cannot take focus')
    assert.equal(await page.evaluate(() => { const c = document.querySelector<HTMLButtonElement>('.disc-chip')!; c.focus(); return document.activeElement === c }), false, 'the DISC chips cannot take focus')
    assert.equal(await page.evaluate(() => { const i = document.querySelector<HTMLElement>('.disc-head .info')!; i.focus(); return document.activeElement === i }), true, 'the DISC (i) can take focus while the content is blurred')

    await page.focus('.contact-name-input')
    const reached: string[] = []
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press('Tab')
      reached.push(await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return el ? `${el.className}|${el.getAttribute('aria-label') ?? ''}` : ''
      }))
    }
    assert.ok(!reached.some((c) => c.includes('contact-notes') || c.includes('disc-chip') || c.includes('disc-line-grip')), `Tab skips the hidden parts: ${reached.join(' | ')}`)
    assert.ok(reached.some((c) => c.includes('contact-eye') && c.includes('Show notes')), 'Tab reaches the notes eye')
    assert.ok(reached.some((c) => c.includes('contact-eye') && c.includes('Show DISC')), 'Tab reaches the DISC eye')
    assert.ok(reached.some((c) => c.includes('info')), 'Tab reaches the clear DISC (i)')

    // A mouse drag across the blurred area selects nothing; releasing outside it does not reveal it.
    await page.evaluate(() => getSelection()?.removeAllRanges())
    const b = (await (await page.$('.contact-private.is-hidden .contact-notes'))!.boundingBox())!
    await page.mouse.move(b.x + 8, b.y + 8)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width - 8, b.y + 8, { steps: 4 })
    assert.equal(await page.evaluate(() => getSelection()?.toString() ?? ''), '', 'nothing inside the blurred area is selected')
    await page.mouse.move(5, 5, { steps: 4 })
    await page.mouse.up()
    assert.equal(await hidden(page), 2, 'the drag did not reveal anything')

    const before = (await docs(page)).find((d) => d.key === 'contacts')!.value
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.type('x')
    assert.equal((await docs(page)).find((d) => d.key === 'contacts')!.value.people[0].notes, NOTES_AN, 'typing did not edit the notes')
    assert.deepEqual((await docs(page)).find((d) => d.key === 'contacts')!.value, before)
  })

  await step('the eye reveals and hides a section without moving the page', async () => {
    const before = await cardShape(page)
    await clickEye(page, 'Show notes')
    assert.equal(await hidden(page), 1, 'only DISC is still hidden')
    assert.equal(await page.$('.contact-private.is-hidden .contact-notes'), null, 'notes are no longer hidden')
    assert.equal(await page.$eval('.contact-notes', (e) => getComputedStyle(e.closest('.contact-private-body')!).filter), 'none', 'the notes go back to full colour')
    assert.ok(await page.$('.disc .contact-private.is-hidden'), 'the DISC content is still hidden')
    assert.deepEqual(await cardShape(page), before, 'nothing moved when the notes were revealed')
    assert.ok((await cardTree(page)).includes(NOTES_AN), 'the revealed notes are in the accessibility tree')
    assert.deepEqual(await page.$eval('.contact-notes-label .contact-eye', (e) => [e.getAttribute('aria-label'), e.getAttribute('data-tip')]), ['Hide notes', 'Hide'], 'the notes eye now offers Hide')
    assert.deepEqual(await page.$eval('.disc-head .contact-eye', (e) => [e.getAttribute('aria-label'), e.getAttribute('data-tip')]), ['Show DISC', 'Show'], 'the DISC eye still offers Show')

    await page.click('.contact-notes')
    await page.keyboard.press('End')
    await page.keyboard.type(' Synthetic edit.')
    await saved(page)
    assert.match((await docs(page)).find((d) => d.key === 'contacts')!.value.people[0].notes, /Synthetic edit\.$/, 'the revealed notes can be edited and saved')
    await shot(page, '2-notes-revealed')

    const mid = await cardShape(page)
    await clickEye(page, 'Show DISC')
    assert.equal(await hidden(page), 0, 'both sections are revealed')
    assert.equal(await page.$eval('.disc .contact-private-body', (e) => getComputedStyle(e).filter), 'none', 'DISC goes back to full colour')
    assert.match(await page.$eval('.disc-summary', (e) => e.textContent ?? ''), /Mostly Dominance/, 'the DISC description can be read')
    assert.deepEqual(await cardShape(page), mid, 'nothing moved when DISC was revealed')
    assert.ok((await cardTree(page)).includes('direct, decisive, wants results'), 'the revealed DISC is in the accessibility tree')
    assert.equal(await page.$eval('.contact-notes-label .contact-eye', (e) => e.getAttribute('aria-label')), 'Hide notes', 'the notes eye offers Hide')
    assert.equal(await page.$eval('.disc-head .contact-eye', (e) => e.getAttribute('aria-label')), 'Hide DISC', 'the DISC eye offers Hide')

    await page.click('xpath/.//button[contains(@class,"disc-chip") and contains(.,"Influence")]')
    await saved(page)
    assert.deepEqual((await docs(page)).find((d) => d.key === 'contacts')!.value.people[0].disc, { D: 60, S: 30, I: 10 }, 'the revealed DISC can be edited and saved')
    await shot(page, '3-revealed')

    await clickEye(page, 'Hide notes')
    assert.equal(await hidden(page), 1, 'the notes eye can blur them again')
    await clickEye(page, 'Show notes')
    assert.equal(await hidden(page), 0, 'and show them again')
    await clickEye(page, 'Hide DISC')
    assert.equal(await hidden(page), 1, 'the DISC eye can blur it again')
    await clickEye(page, 'Show DISC')
    assert.equal(await hidden(page), 0, 'and show it again')
  })

  await step('clicking the blurred area itself reveals it', async () => {
    await pick(page, 'Synthetic Binh')
    await pick(page, 'Synthetic An')
    assert.equal(await hidden(page), 2, 'opening the person again starts blurred')
    const notes = (await (await page.$('.contact-private.is-hidden .contact-notes'))!.boundingBox())!
    await page.mouse.click(notes.x + 10, notes.y + 10)
    assert.equal(await hidden(page), 1, 'a click on the blurred notes reveals them')
    const disc = (await (await page.$('.disc .contact-private.is-hidden'))!.boundingBox())!
    await page.mouse.click(disc.x + 10, disc.y + 10)
    assert.equal(await hidden(page), 0, 'a click on the blurred DISC reveals it')
  })

  await step('empty sections stay normal, so adding something new is not obstructed', async () => {
    await pick(page, 'Synthetic Binh')
    assert.equal(await hidden(page), 0, 'nothing to hide on someone with no notes or DISC')
    assert.equal(await page.$('.contact-eye'), null, 'no eyes when there is nothing to hide')
    await shot(page, '5-empty')
    await page.click('.contact-notes')
    await page.keyboard.type('Synthetic new note.')
    await saved(page)
    assert.equal(await hidden(page), 0, 'typing a first note does not blur it')
    await clickEye(page, 'Hide notes')
    assert.equal(await hidden(page), 1, 'the eye can hide a note written just now')
    await clickEye(page, 'Show notes')
    assert.equal(await hidden(page), 0)
    await page.click('xpath/.//button[contains(@class,"disc-chip") and contains(.,"Steadiness")]')
    await saved(page)
    assert.equal(await hidden(page), 0, 'picking a first DISC colour does not blur it')
    await clickEye(page, 'Hide DISC')
    assert.equal(await hidden(page), 1, 'the eye can hide DISC picked just now')
    await clickEye(page, 'Show DISC')
    assert.equal(await hidden(page), 0)

    await pick(page, 'Synthetic Chi')
    assert.equal(await hidden(page), 1, 'notes-only person hides only the notes')
    assert.ok(await page.$('.contact-private.is-hidden .contact-notes'))
    assert.equal(await page.$('.disc .contact-private.is-hidden'), null)
    assert.ok(await page.$('.contact-notes-label .contact-eye'), 'the notes eye is there')
    assert.equal(await page.$('.disc-head .contact-eye'), null, 'no DISC eye when DISC is empty')
    assert.ok(await page.$('.disc-chips'), 'the empty DISC editor is still there to use')

    await pick(page, 'Synthetic Dung')
    assert.equal(await hidden(page), 1, 'DISC-only person hides only DISC')
    assert.ok(await page.$('.disc .contact-private.is-hidden'))
    assert.equal(await page.$eval('.disc-head', (e) => !!e.closest('.contact-private')), false, 'the DISC heading stays clear on a DISC-only person')
    assert.equal(await page.$('.contact-private.is-hidden .contact-notes'), null)
    assert.equal(await page.$('.contact-notes-label .contact-eye'), null, 'no notes eye when notes are empty')
    await page.click('.contact-notes')
    await page.keyboard.type('Synthetic first note.')
    await saved(page)
    assert.equal(await hidden(page), 1, 'adding notes later does not blur them')
    await shot(page, '6-disc-only')
  })

  await step('choosing another person or leaving Contacts blurs them again', async () => {
    await pick(page, 'Synthetic An')
    await clickEye(page, 'Show notes')
    await clickEye(page, 'Show DISC')
    assert.equal(await hidden(page), 0)
    await pick(page, 'Synthetic Binh')
    await pick(page, 'Synthetic An')
    assert.equal(await hidden(page), 2, 'another person, then back: blurred again')
    await shot(page, '4-after-switch')

    await clickEye(page, 'Show notes')
    await clickEye(page, 'Show DISC')
    assert.equal(await hidden(page), 0)
    await page.click('xpath/.//button[@role="tab" and contains(.,"Week")]')
    await page.waitForSelector('.week-plan')
    await page.click('xpath/.//button[@role="tab" and contains(.,"Contacts")]')
    await page.waitForSelector('.contacts-left')
    await pick(page, 'Synthetic An')
    assert.equal(await hidden(page), 2, 'leaving the page and coming back: blurred again')
  })

  await step('the blur settings sit under Add-ons, on by default, one for each section', async () => {
    await pick(page, 'Synthetic Binh')
    await pick(page, 'Synthetic An')
    const shape = await cardShape(page)
    const before = await docs(page)
    await addons(page)
    assert.deepEqual(
      await page.$$eval('.sd-row-title', (x) => x.map((e) => e.textContent).filter((t) => t === 'Blur notes' || t === 'Blur DISC')),
      ['Blur notes', 'Blur DISC'],
      'the two rows sit under Add-ons',
    )
    assert.deepEqual([await switchOn(page, 'Blur notes'), await switchOn(page, 'Blur DISC')], [true, true], 'both start on')
    await shot(page, '8-settings')

    await toggle(page, 'Blur notes')
    await closeSettings(page)
    assert.equal(await page.$('.contact-private.is-hidden .contact-notes'), null, 'notes show normally when their blur is off')
    assert.equal(await page.$('.contact-notes-label .contact-eye'), null, 'the notes eye is gone when its blur is off')
    assert.ok(await page.$('.disc .contact-private.is-hidden'), 'DISC keeps its own blur')
    assert.ok(await page.$('.disc-head .contact-eye'), 'the DISC eye stays')
    assert.deepEqual(await cardShape(page), shape, 'the eye coming and going moves nothing')
    assert.deepEqual(await docs(page), before, 'the setting is not written to the notebook')
    await shot(page, '9-notes-off')
  })

  await step('the blur settings are kept on this device across a reload', async () => {
    await addons(page)
    assert.equal(await switchOn(page, 'Blur notes'), false, 'the notes choice survived the reload')
    assert.equal(await switchOn(page, 'Blur DISC'), true, 'DISC was not changed')
    await closeSettings(page)
    await page.reload()
    await page.waitForSelector('.contacts-left')
    await pick(page, 'Synthetic An')
    assert.equal(await page.$('.contact-private.is-hidden .contact-notes'), null, 'notes still normal after a reload')
    assert.ok(await page.$('.disc .contact-private.is-hidden'), 'DISC still blurred after a reload')

    await addons(page)
    await toggle(page, 'Blur notes')
    await closeSettings(page)
    await pick(page, 'Synthetic Binh')
    await pick(page, 'Synthetic An')
    assert.ok(await page.$('.contact-private.is-hidden .contact-notes'), 'turning notes back on blurs them again')

    await addons(page)
    await toggle(page, 'Blur DISC')
    await closeSettings(page)
    await pick(page, 'Synthetic Binh')
    await pick(page, 'Synthetic An')
    assert.equal(await page.$('.disc .contact-private.is-hidden'), null, 'DISC shows normally when its blur is off')
    assert.equal(await page.$('.disc-head .contact-eye'), null, 'the DISC eye is gone when its blur is off')
    assert.ok(await page.$('.contact-private.is-hidden .contact-notes'), 'notes keep their own blur')

    await addons(page)
    await toggle(page, 'Blur DISC')
    await closeSettings(page)
    await pick(page, 'Synthetic Binh')
    await pick(page, 'Synthetic An')
    assert.equal(await hidden(page), 2, 'both are blurred again')
    const settingsDoc = (await docs(page)).find((d) => d.key === 'settings')!
    assert.equal('blurNotes' in settingsDoc.value || 'blurDisc' in settingsDoc.value, false, 'no blur keys in the notebook')
  })

  await step('the notebook locking blurs them again', async () => {
    await pick(page, 'Synthetic Binh')
    await pick(page, 'Synthetic An')
    await clickEye(page, 'Show notes')
    await clickEye(page, 'Show DISC')
    assert.equal(await hidden(page), 0)
    assert.equal((await call(page, 'PUT', '/api/lock-settings', { pin: '246810' })).status, 200)
    await page.reload()
    await page.waitForSelector('.contacts-left')
    await pick(page, 'Synthetic An')
    await clickEye(page, 'Show notes')
    await clickEye(page, 'Show DISC')
    assert.equal(await hidden(page), 0)
    await page.click('button[aria-label="Lock"]')
    await page.waitForSelector('.lock-shell .pin-dots')
    assert.equal(await page.$('.contact-notes'), null, 'the card is not mounted behind the lock screen')
    assert.ok(!(await page.evaluate(() => document.body.innerText)).includes(NOTES_AN), 'the notes are not on the lock screen')
    await page.keyboard.type('246810')
    await page.waitForSelector('.contacts-left')
    await pick(page, 'Synthetic An')
    assert.equal(await hidden(page), 2, 'after unlocking, the person opens blurred again')
    await shot(page, '7-after-lock')
  })

  await step('the eye works from the keyboard', async () => {
    await page.focus('.contact-eye[aria-label="Show notes"]')
    await page.keyboard.press('Enter')
    assert.equal(await hidden(page), 1, 'Enter on the notes eye reveals them')
    await page.focus('.contact-eye[aria-label="Show DISC"]')
    await page.keyboard.press('Enter')
    assert.equal(await hidden(page), 0, 'Enter on the DISC eye reveals it')
    await page.focus('.contact-eye[aria-label="Hide notes"]')
    await page.keyboard.press('Enter')
    assert.equal(await hidden(page), 1, 'Enter on Hide notes blurs them again')
  })

  assert.deepEqual(errors, [], 'no page errors')
  console.log('all passed')
} finally {
  await browser.close()
  server.kill()
  await sleep(300)
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 })
}
