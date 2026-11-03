// Checks the public website as Cloudflare would serve it: the generated worker behind a local
// HTTP server on a spare port, opened in Chrome. Run: npm run site:build && npm run test:site

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const shots = process.env.E2E_SHOTS ?? ''
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p))
if (!browserPath) throw new Error('No Chrome/Edge found for browser checks.')
const PORT = 5396
const BASE = `http://localhost:${PORT}`

const worker = (await import(new URL('../site/dist/worker.js', import.meta.url).href)).default as { fetch(r: Request): Promise<Response> }
const server = http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request(`${BASE}${req.url}`, { method: req.method }))
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(Buffer.from(await r.arrayBuffer()))
})
await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve))

const get = (p: string, method = 'GET') => worker.fetch(new Request(`${BASE}${p}`, { method }))

try {
  for (const [p, title] of [['/', 'Duckbook: a personal paper-style planner'], ['/privacy', 'Privacy policy · Duckbook'], ['/terms', 'Terms of use · Duckbook']]) {
    const r = await get(p)
    assert.equal(r.status, 200, p)
    assert.match(r.headers.get('content-type')!, /text\/html/)
    assert.match(r.headers.get('content-security-policy')!, /default-src 'none'/)
    const html = await r.text()
    assert.ok(html.includes(`<title>${title}</title>`), p)
    assert.ok(html.includes('href="mailto:ndkhoa1000@gmail.com"'), `${p} has the contact`)
    assert.ok(!html.includes('<!--CONTACT-->'), `${p} has no unfilled marker`)
    assert.ok(!/<form|<input|type="password"/i.test(html), `${p} has no sign-in form`)
  }
  const home = await (await get('/')).text()
  assert.ok(home.includes('href="/privacy"') && home.includes('href="/terms"'), 'homepage links privacy and terms')
  const privacy = await (await get('/privacy')).text()
  for (const must of ['drive.file', 'Limited Use', 'api-services-user-data-policy', 'myaccount.google.com/permissions', 'Duckbook Sync', 'Cloudflare']) assert.ok(privacy.includes(must), `privacy mentions ${must}`)
  assert.equal((await get('/privacy.html', 'GET')).status, 301)
  assert.equal((await get('/terms/')).headers.get('location'), `${BASE}/terms`)
  const missing = await get('/api/pages')
  assert.equal(missing.status, 404)
  assert.ok((await missing.text()).includes('This page is blank'))
  assert.equal((await get('/404.html')).status, 404)
  assert.equal((await get('/', 'POST')).status, 405)
  const head = await get('/', 'HEAD')
  assert.equal(head.status, 200)
  assert.equal((await head.text()).length, 0)
  const font = await get('/fonts/newsreader-latin-400-normal.woff2')
  assert.equal(font.headers.get('content-type'), 'font/woff2')
  assert.deepEqual(Buffer.from(await font.arrayBuffer()), fs.readFileSync(new URL('../site/public/fonts/newsreader-latin-400-normal.woff2', import.meta.url)))
  console.log('ok - worker serves pages, assets, redirects, 404 and refuses other methods')

  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true })
  try {
    for (const [p, width] of [['/', 1280], ['/privacy', 1280], ['/terms', 1280], ['/', 390], ['/privacy', 390]] as const) {
      const page = await browser.newPage()
      const problems: string[] = []
      page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
      page.on('pageerror', (e) => problems.push(String(e)))
      page.on('requestfailed', (r) => problems.push(`failed ${r.url()}`))
      page.on('request', (r) => !r.url().startsWith(BASE) && problems.push(`outside request ${r.url()}`))
      await page.setViewport({ width, height: 900 })
      await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle0' })
      const facts = await page.evaluate(() => ({
        fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        h1: document.querySelectorAll('h1').length,
        lang: document.documentElement.lang,
        unnamed: [...document.querySelectorAll('a')].filter((a) => !a.textContent!.trim() && !a.getAttribute('aria-label')).length,
        main: !!document.querySelector('main#main'),
      }))
      assert.deepEqual(problems, [], `${p} at ${width}px`)
      assert.ok(facts.fonts.some((f) => f.includes('Newsreader')), `${p} loads its own font`)
      assert.equal(facts.overflow, false, `${p} fits ${width}px`)
      assert.equal(facts.h1, 1)
      assert.equal(facts.lang, 'en')
      assert.equal(facts.unnamed, 0)
      assert.ok(facts.main)
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to content')
      if (shots) await page.screenshot({ path: path.join(shots, `site${p === '/' ? '-home' : p.replace('/', '-')}-${width}.png`), fullPage: true })
      await page.close()
    }
  } finally {
    await browser.close()
  }
  console.log('ok - pages render in Chrome with own fonts, no outside requests or errors, fit a phone, keyboard skip link')
} finally {
  server.close()
}
