// The desktop app's size: zoom keys do nothing, a zoom left behind by an older build is cleared, and
// the size chosen in Settings stays across a restart. Synthetic profile and ports only.
// Run: npm run build && npm run desktop:bundle && node test/desktop-size.e2e.ts
// `--press-only` just presses Ctrl − and closes (to leave a stuck zoom using an older bundle);
// DUCKBOOK_SIZE_PROFILE reuses a profile between runs.

import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'

const pressOnly = process.argv.includes('--press-only')
const temp = process.env.DUCKBOOK_SIZE_PROFILE ?? fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-size-'))
const port = 5393
const debugPort = 9393
const origin = `http://127.0.0.1:${port}`
const exe = path.resolve('node_modules/electron/dist/electron.exe')
const env: NodeJS.ProcessEnv = { ...process.env, DUCKBOOK_DESKTOP_DATA_DIR: path.join(temp, 'notebook'), DUCKBOOK_WEB_DATA_DIR: path.join(temp, 'absent-web'), DUCKBOOK_WEB_PORT: '5392', DUCKBOOK_DESKTOP_PORT: String(port), DUCKBOOK_DATA_DIR: path.join(temp, 'forbidden-web-default'), DUCKBOOK_PORT: '5391', PATH: process.env.SystemRoot ?? 'C:\\Windows' }
delete env.ELECTRON_RUN_AS_NODE

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let child: ChildProcess | undefined
let browser: Browser | undefined

async function open(): Promise<Page> {
  child = spawn(exe, ['.', `--remote-debugging-port=${debugPort}`], { env, stdio: 'ignore' })
  for (let i = 0; i < 150 && !browser; i++) {
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null })
    } catch {
      await sleep(100)
    }
  }
  assert.ok(browser, 'desktop did not open')
  await browser.waitForTarget((t) => t.type() === 'page' && t.url().startsWith(origin))
  const page = (await browser.pages())[0]!
  try {
    await page.waitForFunction(() => !!document.querySelector('.tabs') || document.body.innerText.includes('Start with an empty notebook'), { timeout: 15000 })
  } catch (e) {
    const targets = browser.targets().map((t) => `${t.type()} ${t.url()}`)
    console.log('did not open:', JSON.stringify({ url: page.url(), targets, text: await page.evaluate(() => document.body.innerText.slice(0, 300)), root: await page.evaluate(() => document.getElementById('root')?.innerHTML.slice(0, 300)) }))
    throw e
  }
  const empty = await page.$('xpath/.//button[normalize-space(.)="Start with an empty notebook"]')
  if (empty) await empty.click()
  await page.waitForSelector('.tabs')
  await page.evaluate(() => localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus'])))
  await sleep(500)
  return page
}

async function close() {
  const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()))
  await browser?.disconnect()
  browser = undefined
  execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DuckbookClose { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam); }'; $w = [System.Diagnostics.Process]::GetProcessById(${child!.pid}).MainWindowHandle; if ($w -eq 0) { throw 'No test window' }; [DuckbookClose]::PostMessage($w, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null`], { stdio: 'pipe' })
  await exited
  await sleep(500)
}

const ratio = (page: Page) => page.evaluate(() => window.devicePixelRatio)

/**
 * Real keys from the OS: keys sent through DevTools never reach the app menu, so they would pass on
 * the old build too. Sent only while the test window is in front, so they can't land anywhere else.
 */
async function pressZoom(_page: Page, key: string) {
  const script = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DuckbookFront { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }'
$w = [System.Diagnostics.Process]::GetProcessById(${child!.pid}).MainWindowHandle
if ($w -eq 0) { throw 'No test window' }
$shell = New-Object -ComObject WScript.Shell
[void]$shell.AppActivate(${child!.pid})
[void][DuckbookFront]::SetForegroundWindow($w)
Start-Sleep -Milliseconds 300
if ([DuckbookFront]::GetForegroundWindow() -ne $w) { throw 'The test window is not in front; no keys sent.' }
$shell.SendKeys('^${key}')
`
  execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'pipe' })
  await sleep(600)
}

async function pickSize(page: Page, label: string) {
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.settings')
  const button = await page.waitForSelector(`xpath/.//div[contains(@class,"sd-row")][.//div[normalize-space(.)="Size"]]//button[normalize-space(.)="${label}"]`)
  await button!.click()
  await sleep(300)
  await page.click('.sd-close')
  await page.waitForSelector('.settings', { hidden: true })
}

try {
  let page = await open()
  if (pressOnly) {
    const before = await ratio(page)
    await pressZoom(page, '-')
    console.log(`before ${before}, after Ctrl - ${await ratio(page)}`)
    await close()
    await open().then(async (p) => console.log(`after restart ${await ratio(p)}`))
    await close()
  } else {
    const base = Number(process.env.DUCKBOOK_SIZE_BASE ?? (await ratio(page)))
    const near = (a: number, b: number) => Math.abs(a - b) < 0.01
    assert.ok(near(await ratio(page), base), `starts at full size: ${await ratio(page)} vs ${base}`)
    console.log('ok - opens at full size, whatever an earlier build left behind')

    for (const key of ['-', '=', '0']) {
      await pressZoom(page, key)
      assert.ok(near(await ratio(page), base), `Ctrl ${key} left the size alone: ${await ratio(page)}`)
    }
    console.log('ok - Ctrl - = 0 do nothing')

    await page.evaluate(() => (window as unknown as { duckbookView: { setTextSize: (f: number) => Promise<boolean> } }).duckbookView.setTextSize(3)).then((r) => assert.equal(r, false, 'a size outside the list is refused'))

    await pickSize(page, 'Large')
    assert.ok(near(await ratio(page), base * 1.15), `Large applies: ${await ratio(page)}`)
    await pressZoom(page, '-')
    assert.ok(near(await ratio(page), base * 1.15), 'Ctrl - does not move it')
    console.log('ok - Settings changes the size')

    await close()
    page = await open()
    assert.ok(near(await ratio(page), base * 1.15), `kept across a restart: ${await ratio(page)}`)
    console.log('ok - the size stays across a restart')

    await pickSize(page, 'Normal')
    assert.ok(near(await ratio(page), base), 'back to Normal')

    await page.goto(`${origin}/#/month/2026-11-01`)
    const cell = '[data-day="2026-11-10"] textarea'
    await page.waitForSelector(cell)
    await page.click(cell)
    await page.keyboard.type('synthetic')
    const size = () => page.$eval(cell, (e) => parseFloat(getComputedStyle(e).fontSize))
    const start = await size()
    await pressZoom(page, '{]}')
    assert.equal(await size(), start + 1, 'Ctrl+] makes one day larger')
    await pressZoom(page, '{[}')
    assert.equal(await size(), start, 'Ctrl+[ makes it smaller again')
    assert.ok(near(await ratio(page), base), 'and neither zooms the app')
    assert.equal(await page.$eval(cell, (e) => (e as HTMLTextAreaElement).value), 'synthetic', 'nor types anything')
    console.log('ok - Ctrl+[ and Ctrl+] size a Month day with real keys')
    await close()
    console.log('all passed')
  }
} finally {
  await browser?.disconnect().catch(() => {})
  if (child?.pid && child.exitCode === null) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {}
  }
  if (!process.env.DUCKBOOK_SIZE_PROFILE) fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 })
}
