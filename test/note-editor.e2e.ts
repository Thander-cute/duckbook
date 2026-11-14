// Day Notes with real bold, italic, underline and section lines: what is stored stays plain text with
// marks, opening a note never rewrites it, the keys and typed marks work, input methods and pasting
// keep the text, a change from elsewhere arrives without moving the cursor, the rows stay on the dots,
// and the lock takes the editor away. Throwaway server, temp data dir, synthetic data only.
// Run: npm run build && node test/note-editor.e2e.ts   (E2E_SHOTS=<folder> saves screenshots)
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { API_LEVEL } from '../src/lib/schema.ts'

const PORT = Number(process.env.DUCKBOOK_TEST_PORT ?? 5443)
const BASE = `http://localhost:${PORT}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-note-editor-e2e-'))
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

const DAY = '2026-11-18'
const ED = '.day-page .note-editor'
const FORMATTED = 'Hôm nay **trời đẹp**, tôi đã //viết nhật ký// ở __quán cà phê__.\n---\nƯớc gì ngày mai cũng vậy.'
const fixture = (notes: string, ink = 'serif') => ({
  version: 1,
  settings: { ink, focusMin: 25, breakMin: 5, modules: { focusMap: false, contacts: false, holidays: false, disc: false } },
  days: { [DAY]: { grateful: '', notes, sentence: '', tasks: [] } },
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
const dayDoc = async (page: Page) => ((await call(page, 'GET', '/api/data')).json.docs as { key: string; rev: number; value: any }[]).find((d) => d.key === `day:${DAY}`)!
const stored = async (page: Page) => (await dayDoc(page)).value.notes as string
const storedBecomes = async (page: Page, want: string) => {
  let got = ''
  for (let t = 0; t < 6000; t += 100) {
    if ((got = await stored(page)) === want) return
    await sleep(100)
  }
  assert.equal(got, want, 'the stored note')
}
const step = async (name: string, fn: () => Promise<void>) => {
  await fn()
  console.log(`ok - ${name}`)
}
const shot = async (page: Page, name: string) => {
  if (!shots) return
  await sleep(400)
  const el = await page.$('.day-page')
  await (el ?? page).screenshot({ path: path.join(shots, `${name}.png`) as `${string}.png` })
}
const reset = async (page: Page, notes: string, ink = 'serif') => {
  await page.goto(`${BASE}/#/day/${DAY}`)
  const r = await call(page, 'POST', '/api/import', { data: fixture(notes, ink), source: 'file', replace: true })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  await page.reload()
  await page.waitForSelector(`${ED}.ProseMirror`)
}
const ctrl = async (page: Page, key: string, shift = false) => {
  await page.keyboard.down('Control')
  if (shift) await page.keyboard.down('Shift')
  await page.keyboard.press(key as never)
  if (shift) await page.keyboard.up('Shift')
  await page.keyboard.up('Control')
  await sleep(30)
}
/** One key, at the pace of quick typing. */
const key = async (page: Page, k: string) => {
  await page.keyboard.press(k as never)
  await sleep(30)
}
/** Shift+paste: literal text, not marks (`clipboardTextParser` gets `plain`). */
const pastePlain = async (page: Page, text: string) => {
  await page.keyboard.down('Shift')
  await page.$eval(
    ED,
    (ed, text) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    text,
  )
  await page.keyboard.up('Shift')
}
/** Puts the caret in the note's `line`th paragraph, `offset` characters in (the end when left out). */
const caret = async (page: Page, line: number, offset?: number) => {
  await page.click(ED)
  await page.evaluate(
    (sel, line, offset) => {
      const p = document.querySelector(sel)!.children[line]
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      let left = offset ?? p.textContent!.length
      let n: Node | null = null
      while ((n = walker.nextNode())) {
        const len = n.textContent!.length
        if (left <= len) break
        left -= len
      }
      const r = document.createRange()
      if (n) r.setStart(n, left)
      else r.setStart(p, 0)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(r)
    },
    ED,
    line,
    offset ?? null,
  )
  await sleep(60)
}
const shown = (page: Page) =>
  page.$eval(ED, (ed) =>
    [...ed.children].map((c) => (c.tagName === 'HR' ? 'HR' : [...c.childNodes].map((n) => (n.nodeType === 3 ? n.textContent : `<${(n as Element).tagName.toLowerCase()}>${n.textContent}`)).join('|'))),
  )
const tags = (page: Page, tag: string) => page.$$eval(`${ED} ${tag}`, (xs) => xs.map((x) => x.textContent))

try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus', 'contacts'])))
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await step('the editor is loaded only on a page with a note', async () => {
    await page.goto(`${BASE}/#/month/${DAY}`)
    await page.reload()
    await page.waitForSelector('.topbar')
    await sleep(400)
    const loaded = () => page.evaluate(() => performance.getEntriesByType('resource').some((e) => /NoteEditor/.test(e.name)))
    assert.equal(await loaded(), false, 'not on the Month page')
    await page.goto(`${BASE}/#/day/${DAY}`)
    await page.waitForSelector(`${ED}.ProseMirror`)
    assert.equal(await loaded(), true)
  })

  await step('a formatted note shows bold, italic, underline and a section line, and opening it changes nothing', async () => {
    await reset(page, FORMATTED)
    const before = await dayDoc(page)
    assert.deepEqual(await tags(page, 'strong'), ['trời đẹp'])
    assert.deepEqual(await tags(page, 'em'), ['viết nhật ký'])
    assert.deepEqual(await tags(page, 'u'), ['quán cà phê'])
    assert.equal((await page.$$(`${ED} hr`)).length, 1)
    assert.equal(await page.$eval(ED, (e) => e.textContent!.includes('*') || e.textContent!.includes('//')), false, 'no marks on show')
    assert.deepEqual(
      await page.$eval(ED, (e) => [e.getAttribute('role'), e.getAttribute('aria-label'), e.getAttribute('aria-multiline'), e.getAttribute('contenteditable')]),
      ['textbox', 'Notes', 'true', 'true'],
    )
    await caret(page, 2)
    await sleep(800)
    const after = await dayDoc(page)
    assert.equal(after.value.notes, FORMATTED)
    assert.equal(after.rev, before.rev, 'not saved again')
    await shot(page, '01-formatted-serif')
  })

  await step('an old note with characters that look like marks is kept exactly', async () => {
    const odd = 'C:\\\\**đậm** và \\**sao\\** 1/2 https://a.vn/x\n\\---\n** mở\r\n'
    await reset(page, odd)
    await caret(page, 0)
    await sleep(800)
    assert.equal(await stored(page), odd)
  })

  await step('addresses, paths and slashes show as written, and typing next to them leaves them byte for byte', async () => {
    const lines = [
      'xem http://a.com/x//y và https://b.vn/z//w nhé',
      'mở file:///C:/Users/me/a.txt nhé',
      String.raw`lưu ở C:\Users\me\__pycache__\x.py nhé`,
      String.raw`chia sẻ \\server\share\_tmp\_ nhé`,
      'a // b // c nhé',
    ]
    await reset(page, lines.join('\n'))
    assert.deepEqual(await shown(page), lines, 'no formatting, nothing hidden')
    for (let n = 0; n < lines.length; n++) {
      await caret(page, n)
      await page.keyboard.type(' thêm')
      lines[n] += ' thêm'
      await storedBecomes(page, lines.join('\n'))
      await caret(page, n, 1)
      await key(page, 'Backspace')
      lines[n] = lines[n].slice(1)
      await storedBecomes(page, lines.join('\n'))
    }
  })

  await step('Ctrl+B on a selection, undo and redo; Ctrl+B then typing', async () => {
    await reset(page, 'một hai')
    await caret(page, 0)
    await page.keyboard.down('Shift')
    for (let k = 0; k < 3; k++) await key(page, 'ArrowLeft')
    await sleep(60)
    await page.keyboard.up('Shift')
    await ctrl(page, 'b')
    await storedBecomes(page, 'một **hai**')
    assert.deepEqual(await tags(page, 'strong'), ['hai'])
    await ctrl(page, 'z')
    await storedBecomes(page, 'một hai')
    await ctrl(page, 'z', true)
    await storedBecomes(page, 'một **hai**')
    await ctrl(page, 'z')
    await ctrl(page, 'y')
    await storedBecomes(page, 'một **hai**')
    await key(page, 'End')
    await key(page, 'Enter')
    await ctrl(page, 'i')
    await page.keyboard.type('nghiêng')
    await ctrl(page, 'i')
    await page.keyboard.type(' rồi ')
    await ctrl(page, 'u')
    await page.keyboard.type('gạch')
    await storedBecomes(page, 'một **hai**\n//nghiêng// rồi __gạch__')
  })

  await step('Ctrl+U is the note’s, not the browser’s', async () => {
    await page.evaluate(() => {
      const w = window as unknown as { seen: boolean[] }
      w.seen = []
      window.addEventListener('keydown', (e) => e.ctrlKey && e.key !== 'Control' && w.seen.push(e.defaultPrevented))
    })
    await caret(page, 0)
    await ctrl(page, 'u')
    await ctrl(page, 'b')
    assert.deepEqual(await page.evaluate(() => (window as unknown as { seen: boolean[] }).seen), [true, true])
  })

  await step('typed marks become formatting, as in Notion; Backspace takes it back', async () => {
    await reset(page, '')
    await caret(page, 0)
    await page.keyboard.type('**trời đẹp** rồi *nghiêng* và __gạch__ và _cũng nghiêng_ ')
    assert.deepEqual(await tags(page, 'strong'), ['trời đẹp'])
    assert.deepEqual(await tags(page, 'em'), ['nghiêng', 'cũng nghiêng'])
    assert.deepEqual(await tags(page, 'u'), ['gạch'])
    await storedBecomes(page, '**trời đẹp** rồi //nghiêng// và __gạch__ và //cũng nghiêng// ')
    await key(page, 'Enter')
    await page.keyboard.type('**sai**')
    assert.deepEqual(await tags(page, 'strong'), ['trời đẹp', 'sai'])
    await key(page, 'Backspace')
    assert.deepEqual(await tags(page, 'strong'), ['trời đẹp'], 'Backspace right after undoes the formatting')
    assert.equal((await shown(page))[1], '**sai**')
    await key(page, 'Enter')
    await page.keyboard.type('snake_case và 2*3*4 và a__b')
    assert.equal((await shown(page))[2], 'snake_case và 2*3*4 và a__b', 'marks inside words stay text')
    await storedBecomes(page, '**trời đẹp** rồi //nghiêng// và __gạch__ và //cũng nghiêng// \n\\**sai\\**\nsnake_case và 2*3*4 và a__b')
  })

  await step('literal marks after a one-letter colon stay text, typed or pasted', async () => {
    // Typing `A:**hi**` fires the bold rule; Backspace takes it back. The stars must stay stars.
    await reset(page, '')
    await caret(page, 0)
    await page.keyboard.type('A:**hi**')
    assert.deepEqual(await tags(page, 'strong'), ['hi'], 'the bold rule fires')
    await key(page, 'Backspace')
    assert.deepEqual(await tags(page, 'strong'), [], 'Backspace takes the formatting back')
    assert.equal((await shown(page))[0], 'A:**hi**')
    await storedBecomes(page, 'A:**hi\\**')
    await page.reload()
    await page.waitForSelector(`${ED}.ProseMirror`)
    assert.equal((await shown(page))[0], 'A:**hi**', 'the stars are still text after reload')
    assert.deepEqual(await tags(page, 'strong'), [])

    // Shift+paste is literal text, not marks.
    for (const text of ['D:**2026**', 'C:__x__', 'A:__\\//__www.__']) {
      await reset(page, '')
      await caret(page, 0)
      await pastePlain(page, text)
      assert.equal((await shown(page))[0], text, `${text} is shown as written`)
      assert.deepEqual(await tags(page, 'strong'), [])
      assert.deepEqual(await tags(page, 'em'), [])
      assert.deepEqual(await tags(page, 'u'), [])
      // Wait for the save, then check that opening the stored text changes nothing.
      let last = ''
      for (let t = 0; t < 6000; t += 100) {
        const now = await stored(page)
        if (now && now === last) break
        last = now
        await sleep(100)
      }
      assert.notEqual(last, '', 'the pasted text is saved')
      await page.reload()
      await page.waitForSelector(`${ED}.ProseMirror`)
      assert.equal((await shown(page))[0], text, `${text} reads back as written`)
      assert.equal(await stored(page), last, 'opening it does not rewrite it')
    }

    // Text the format cannot hold is shown as it reads back, so a reload changes nothing either.
    await reset(page, '')
    await caret(page, 0)
    await pastePlain(page, 'A:**x**B:**y**')
    assert.equal(await page.$eval(ED, (e) => e.textContent), 'A:xB:y')
    assert.deepEqual(await tags(page, 'strong'), ['x', 'y'])
    await storedBecomes(page, 'A:**x**B:**y**')
  })

  await step('formatting the stored text cannot hold is not shown', async () => {
    // Bold on `*star*` cannot be written, so it is not shown either.
    await reset(page, '*star*')
    await caret(page, 0)
    await page.keyboard.down('Shift')
    for (let k = 0; k < 6; k++) await key(page, 'ArrowLeft')
    await page.keyboard.up('Shift')
    await ctrl(page, 'b')
    await sleep(300)
    assert.deepEqual(await tags(page, 'strong'), [], 'bold the text cannot hold is not shown')
    assert.equal((await shown(page))[0], '*star*')
    await storedBecomes(page, '*star*')

    // Typing a star at the start of a bold word makes the bold unholdable: it goes, visibly.
    await reset(page, '**abc**')
    await caret(page, 0, 0)
    await key(page, '*')
    await sleep(300)
    assert.deepEqual(await tags(page, 'strong'), [])
    assert.equal((await shown(page))[0], '*abc')
    await storedBecomes(page, '*abc')

    // A word right after an address cannot be bold either.
    await reset(page, 'www.x')
    await caret(page, 0)
    await page.keyboard.down('Shift')
    await key(page, 'ArrowLeft')
    await page.keyboard.up('Shift')
    await ctrl(page, 'b')
    await sleep(300)
    assert.deepEqual(await tags(page, 'strong'), [])
    await storedBecomes(page, 'www.x')
  })

  await step('--- then Enter makes a section line and writing goes on below it', async () => {
    await reset(page, 'trên')
    await caret(page, 0)
    await key(page, 'Enter')
    await page.keyboard.type('---')
    await key(page, 'Enter')
    await page.keyboard.type('dưới')
    assert.deepEqual(await shown(page), ['trên', 'HR', 'dưới'])
    await storedBecomes(page, 'trên\n---\ndưới')
    // A pause, so what follows is its own step to undo.
    await sleep(700)
    await key(page, 'Enter')
    await page.keyboard.type('--- không phải')
    await key(page, 'Enter')
    assert.equal((await page.$$(`${ED} hr`)).length, 1, 'dashes with words after them are text')
    await storedBecomes(page, 'trên\n---\ndưới\n--- không phải\n')
    await ctrl(page, 'z')
    await storedBecomes(page, 'trên\n---\ndưới')
  })

  await step('an input method composing Vietnamese, plain and bold', async () => {
    await reset(page, '')
    await caret(page, 0)
    const cdp = await page.createCDPSession()
    const compose = async (steps: string[]) => {
      for (const s of steps) {
        await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length })
        await sleep(20)
      }
      await cdp.send('Input.insertText', { text: steps[steps.length - 1] })
      await sleep(40)
    }
    await compose(['t', 'ti', 'tie', 'tiê', 'tiên', 'tiếng'])
    await page.keyboard.type(' ')
    await ctrl(page, 'b')
    await compose(['v', 'vi', 'vie', 'viê', 'việ', 'việt'])
    await ctrl(page, 'b')
    await page.keyboard.type(' ')
    await compose(['đ', 'đư', 'đươ', 'được'])
    assert.deepEqual(await tags(page, 'strong'), ['việt'])
    await storedBecomes(page, 'tiếng **việt** được')
    await cdp.detach()
  })

  await step('Unikey-style typing: backspaces and replacement letters, plain and bold, at a mark edge', async () => {
    await reset(page, '**đậm**')
    await caret(page, 0)
    // Telex "dduwowcj" as Unikey sends it: each fix deletes what it replaces and types the new letters.
    const telex = async () => {
      const k = page.keyboard
      await k.sendCharacter('d')
      await k.press('Backspace')
      await k.sendCharacter('đ')
      await k.sendCharacter('u')
      await k.sendCharacter('o')
      await k.press('Backspace')
      await k.press('Backspace')
      await k.sendCharacter('ươ')
      await k.sendCharacter('c')
      await k.press('Backspace')
      await k.press('Backspace')
      await k.press('Backspace')
      await k.sendCharacter('ược')
    }
    await telex()
    assert.deepEqual(await tags(page, 'strong'), ['đậmđược'], 'typing at the end of bold stays bold')
    await ctrl(page, 'b')
    await page.keyboard.sendCharacter(' ')
    await telex()
    await storedBecomes(page, '**đậmđược** được')
    await caret(page, 0, 0)
    await telex()
    // At the start of a line that begins in bold, typing is bold too, as in Docs and Word.
    await storedBecomes(page, '**đượcđậmđược** được')
  })

  await step('pasted formatting is kept, everything else is cleaned out', async () => {
    await reset(page, 'đầu')
    await caret(page, 0)
    const paste = (data: Record<string, string>) =>
      page.$eval(
        ED,
        (ed, data) => {
          const dt = new DataTransfer()
          for (const [k, v] of Object.entries(data)) dt.setData(k, v)
          ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
        },
        data,
      )
    const fetched: string[] = []
    const seeRequest = (r: { url: () => string }) => void fetched.push(r.url())
    page.on('request', seeRequest)
    await paste({
      'text/html':
        '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-x"><p><span style="font-weight:700">Đậm</span> <span style="font-style:italic">nghiêng</span> <a href="javascript:window.__pwned=1">link</a><br><u>gạch</u> <img src="/pasted-image.png" onerror="window.__pwned=2"><style>p{color:red}</style><script>window.__pwned=3</script><span style="color:red;font-size:40px">đỏ</span></p></b>',
      'text/plain': 'Đậm nghiêng link\ngạch đỏ',
    })
    await sleep(300)
    page.off('request', seeRequest)
    assert.equal(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned), undefined)
    assert.deepEqual(fetched.filter((u) => u.includes('pasted-image')), [], 'a pasted image is not fetched')
    assert.deepEqual(await shown(page), ['đầu|<strong>Đậm| |<em>nghiêng| link', '<u>gạch| đỏ'])
    assert.equal(await page.$$eval(`${ED} [style], ${ED} a, ${ED} img, ${ED} script, ${ED} span`, (x) => x.length), 0)
    await storedBecomes(page, 'đầu**Đậm** //nghiêng// link\n__gạch__ đỏ')

    await key(page, 'Enter')
    await paste({ 'text/plain': 'dòng một\r\n**dòng hai**' })
    assert.deepEqual((await shown(page)).slice(2), ['dòng một', '<strong>dòng hai'])
    await storedBecomes(page, 'đầu**Đậm** //nghiêng// link\n__gạch__ đỏ\ndòng một\n**dòng hai**')

    await ctrl(page, 'a')
    const copied = await page.$eval(ED, (ed) => {
      const dt = new DataTransfer()
      ed.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
      return dt.getData('text/plain')
    })
    assert.equal(copied, 'đầuĐậm nghiêng link\ngạch đỏ\ndòng một\ndòng hai', 'copied as plain text without marks')
  })

  await step('a change from elsewhere arrives while writing, and the cursor stays where it was', async () => {
    await reset(page, 'dòng một\ndòng hai')
    await caret(page, 1, 4)
    const d = await dayDoc(page)
    const put = await call(page, 'PUT', '/api/docs', { changes: [{ key: d.key, baseRev: d.rev, value: { ...d.value, notes: '**Từ nơi khác** dòng một\ndòng hai' } }] })
    assert.equal(put.status, 200, JSON.stringify(put.json))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction((sel) => document.querySelector(sel)?.querySelector('strong')?.textContent === 'Từ nơi khác', {}, ED)
    assert.equal(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), ED), true, 'still writing in the note')
    await page.keyboard.type('X')
    await storedBecomes(page, '**Từ nơi khác** dòng một\ndòngX hai')

    // While an input method is composing, the change waits for the word to finish.
    await caret(page, 1)
    const cdp = await page.createCDPSession()
    await cdp.send('Input.imeSetComposition', { text: 'vi', selectionStart: 2, selectionEnd: 2 })
    const e = await dayDoc(page)
    await call(page, 'PUT', '/api/docs', { changes: [{ key: e.key, baseRev: e.rev, value: { ...e.value, notes: e.value.notes.replace('dòng một', 'dòng MỘT') } }] })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await sleep(500)
    assert.equal(await page.$eval(ED, (x) => x.textContent!.includes('MỘT')), false, 'not under the composition')
    await cdp.send('Input.imeSetComposition', { text: 'việ', selectionStart: 3, selectionEnd: 3 })
    await cdp.send('Input.insertText', { text: 'việt' })
    await cdp.detach()
    await page.waitForFunction((sel) => document.querySelector(sel)!.textContent!.includes('MỘT'), {}, ED)
    await page.keyboard.type('!')
    await storedBecomes(page, '**Từ nơi khác** dòng MỘT\ndòngX haiviệt!')
  })

  await step('a change from elsewhere that matches an older text of this tab is still shown', async () => {
    // This tab typed `hello`, then deleted it. Device B saves exactly `hello`. It is not this tab's
    // own text coming back, so it must arrive; typing on top keeps it.
    await reset(page, '')
    await caret(page, 0)
    await page.keyboard.type('hello')
    await storedBecomes(page, 'hello')
    for (let k = 0; k < 5; k++) await key(page, 'Backspace')
    await storedBecomes(page, '')
    const d = await dayDoc(page)
    const put = await call(page, 'PUT', '/api/docs', { changes: [{ key: d.key, baseRev: d.rev, value: { ...d.value, notes: 'hello' } }] })
    assert.equal(put.status, 200, JSON.stringify(put.json))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction((sel) => document.querySelector(sel)?.textContent === 'hello', {}, ED)
    await ctrl(page, 'End')
    await page.keyboard.type('x')
    await storedBecomes(page, 'hellox')
  })

  for (const ink of ['serif', 'hand']) {
    await step(`rows stay on the dots, ${ink}`, async () => {
      await reset(page, FORMATTED + '\n**một dòng rất dài** '.repeat(1) + 'chữ '.repeat(60) + '\n---\n__cuối__', ink)
      await page.evaluate(() => document.fonts.ready)
      const rows = await page.$eval(ED, (ed) => {
        const dot = parseFloat(getComputedStyle(ed).backgroundSize)
        const top = ed.getBoundingClientRect().top
        return { dot, lh: parseFloat(getComputedStyle(ed.querySelector('p')!).lineHeight), tops: [...ed.children].map((c) => Math.round((c.getBoundingClientRect().top - top) * 100) / 100), hr: ed.querySelector('hr')!.getBoundingClientRect().height }
      })
      assert.equal(rows.lh, rows.dot)
      assert.equal(rows.hr, rows.dot)
      for (const t of rows.tops) assert.equal(t % rows.dot, 0, `a row starts at ${t}, dots every ${rows.dot}: ${rows.tops}`)
      if (ink === 'hand') {
        const bold = await page.evaluate(() => [...document.fonts].some((f) => /Dancing Script/.test(f.family) && f.weight === '700' && f.status === 'loaded'))
        assert.equal(bold, true, 'the bold handwriting font is loaded')
      }
      await shot(page, `02-rows-${ink}`)
    })
  }

  await step('the lock takes the editor and the note away', async () => {
    await reset(page, 'Ghi chú riêng tư **bí mật**')
    await page.click('button[aria-label="Settings"]')
    await (await page.waitForSelector('xpath/.//button[contains(@class,"sd-tab") and normalize-space(.)="Privacy"]'))!.click()
    await (await page.waitForSelector('xpath/.//button[contains(., "Set a 6-digit PIN")]'))!.click()
    const fields = await page.$$('.pin-field input')
    for (const f of fields) await f.type('246810')
    await (await page.waitForSelector('xpath/.//button[contains(., "Save PIN")]'))!.click()
    await page.waitForSelector('xpath/.//*[contains(., "PIN saved")]')
    await page.click('button[aria-label="Close settings"]')
    await page.click('button[aria-label="Lock"]')
    await page.waitForSelector('.lock-shell .pin-dots')
    assert.equal(await page.$$eval('.ProseMirror, .note-editor, [contenteditable]', (x) => x.length), 0)
    assert.equal(await page.evaluate(() => document.body.innerText.includes('bí mật') || document.body.innerText.includes('riêng tư')), false)
    await shot(page, '03-locked')
  })

  assert.deepEqual(errors, [])
  console.log('note editor: all checks passed')
} finally {
  await browser.close()
  server.kill()
  await sleep(300)
  fs.rmSync(dataDir, { recursive: true, force: true })
}
