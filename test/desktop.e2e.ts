import assert from 'node:assert/strict'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Browser } from 'puppeteer-core'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-desktop-'))
const port = 5397
const debugPort = 9397
const origin = `http://127.0.0.1:${port}`
const dev = process.argv.includes('--dev')
const exe = path.resolve(dev ? 'node_modules/electron/dist/electron.exe' : 'release/win-unpacked/Duckbook.exe')
const env: NodeJS.ProcessEnv = { ...process.env, DUCKBOOK_DESKTOP_DATA_DIR: path.join(temp, 'notebook'), DUCKBOOK_WEB_DATA_DIR: path.join(temp, 'absent-web'), DUCKBOOK_WEB_PORT: '5396', DUCKBOOK_DESKTOP_PORT: String(port), DUCKBOOK_DATA_DIR: path.join(temp, 'forbidden-web-default'), DUCKBOOK_PORT: '5394', PATH: process.env.SystemRoot ?? 'C:\\Windows' }
delete env.ELECTRON_RUN_AS_NODE
let child: ChildProcess | undefined
let browser: Browser | undefined
let logs = ''
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function launch() {
  for (const key of ['DUCKBOOK_DESKTOP_DATA_DIR', 'DUCKBOOK_WEB_DATA_DIR', 'DUCKBOOK_WEB_PORT', 'DUCKBOOK_DESKTOP_PORT']) {
    assert.ok(env[key], `Missing synthetic ${key}`)
  }
  assert.notEqual(env.DUCKBOOK_WEB_PORT, '5317')
  assert.notEqual(env.DUCKBOOK_DESKTOP_PORT, '5317')
  assert.ok(path.resolve(env.DUCKBOOK_WEB_DATA_DIR!).startsWith(temp + path.sep))
  assert.ok(path.resolve(env.DUCKBOOK_DESKTOP_DATA_DIR!).startsWith(temp + path.sep))
  const process = spawn(exe, [...(dev ? ['.'] : []), `--remote-debugging-port=${debugPort}`], { env, stdio: 'pipe' })
  process.stderr!.on('data', (chunk) => { logs += String(chunk) })
  return process
}
async function connect() {
  for (let i = 0; i < 150; i++) {
    try { return await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null }) } catch {}
    if (child?.exitCode !== null) throw new Error(`Desktop exited: ${logs}`)
    await sleep(100)
  }
  throw new Error(`Desktop did not open: ${logs}`)
}
async function killTree() {
  if (!child?.pid || child.exitCode !== null) return
  const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()))
  execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  await exited
}
function requestClose() {
  assert.ok(child?.pid)
  execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DuckbookClose { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam); }'; $duckbookWindow = [System.Diagnostics.Process]::GetProcessById(${child.pid}).MainWindowHandle; if ($duckbookWindow -eq 0) { throw 'No test window' }; [DuckbookClose]::PostMessage($duckbookWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null`], { stdio: 'pipe' })
}
async function nativeButton(label: string) {
  assert.ok(child?.pid)
  await new Promise<void>((resolve, reject) => {
    const automation = spawn('powershell', ['-NoProfile', '-File', 'test/desktop-window.ps1', '-AppProcessId', String(child!.pid), '-Action', label], { stdio: 'pipe', timeout: 20000 })
    let error = ''
    automation.stderr!.on('data', (chunk) => { error += String(chunk) })
    automation.on('error', reject)
    automation.on('exit', (code) => code === 0 ? resolve() : reject(new Error(error)))
  })
}
try {
  child = launch()
  browser = await connect()
  await browser.waitForTarget((target) => target.type() === 'page' && target.url().startsWith(origin))
  let page = (await browser.pages())[0]!
  await page.waitForFunction(() => !!document.querySelector('.day-page') || document.body.innerText.includes('Start with an empty notebook'))
  const startEmpty = await page.$('xpath/.//button[normalize-space(.)="Start with an empty notebook"]')
  if (startEmpty) await startEmpty.click()
  await page.waitForSelector('.day-page')
  assert.equal(fs.existsSync(env.DUCKBOOK_DATA_DIR!), false, 'bundling never invokes the standalone web entry point')
  assert.equal(fs.existsSync(env.DUCKBOOK_WEB_DATA_DIR!), false, 'startup does not create or open a source notebook')
  await page.evaluate(() => localStorage.setItem('duckbook:tour', JSON.stringify(['month', 'week', 'day', 'reflect', 'focus'])))
  await page.goto(`${origin}/#/day/2026-10-19`)
  await page.waitForSelector('.day-page .line textarea')
  assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined')
  assert.equal((await fetch(`${origin}/api/health`, { headers: { 'X-Duckbook': '1' } })).status, 403)
  const health = await page.evaluate(async () => (await (await fetch('/api/health', { headers: { 'X-Duckbook': '1' } })).json()) as { pid: number })
  const second = launch()
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { second.kill(); reject(new Error('Second launch did not exit.')) }, 10000)
    second.once('exit', (code) => { clearTimeout(timeout); assert.equal(code, 0); resolve() })
  })
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/health', { headers: { 'X-Duckbook': '1' } })).json()).pid), health.pid)
  await page.waitForFunction(() => document.hasFocus())
  console.log('ok - Electron opens notebook with isolated renderer, token gate, single instance, and PATH without Node')
  await page.type('.day-page .line textarea', 'synthetic desktop durable save')
  await page.waitForSelector('[data-save="saved"]')
  await page.evaluate(() => localStorage.setItem('duckbook:paper', 'cream'))
  browser.disconnect()
  await killTree()
  await sleep(500)
  child = launch()
  browser = await connect()
  await browser.waitForTarget((target) => target.type() === 'page' && target.url().startsWith(origin))
  page = (await browser.pages())[0]!
  await page.goto(`${origin}/#/day/2026-10-19`)
  await page.waitForSelector('.day-page .line textarea')
  assert.equal(await page.$eval('.day-page .line textarea', (e) => (e as HTMLTextAreaElement).value), 'synthetic desktop durable save')
  console.log('ok - acknowledged edit survives hard kill and relaunch')
  await page.evaluate(() => localStorage.setItem('duckbook:paper', 'cream'))
  await page.click('.day-page .line textarea')
  await page.keyboard.press('End')
  await page.keyboard.type(' and close flush')
  requestClose()
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Graceful close timed out.')), 15000)
    child!.once('exit', () => { clearTimeout(timeout); resolve() })
  })
  browser.disconnect()
  browser = undefined
  child = launch()
  browser = await connect()
  await browser.waitForTarget((target) => target.type() === 'page' && target.url().startsWith(origin))
  page = (await browser.pages())[0]!
  await page.goto(`${origin}/#/day/2026-10-19`)
  await page.waitForSelector('.day-page .line textarea')
  assert.equal(await page.$eval('.day-page .line textarea', (e) => (e as HTMLTextAreaElement).value), 'synthetic desktop durable save and close flush')
  assert.equal(await page.evaluate(() => localStorage.getItem('duckbook:paper')), 'cream')
  console.log('ok - immediate close flushes pending edits; edits and browser preferences survive restart')
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (request.url().endsWith('/api/docs') && request.method() === 'PUT') void request.abort('failed')
    else void request.continue()
  })
  await page.type('.day-page .line textarea', ' unsaved failure fixture')
  await page.waitForSelector('[data-save="error"]')
  requestClose()
  await nativeButton('Keep open')
  assert.ok((await page.$eval('.day-page .line textarea', (e) => (e as HTMLTextAreaElement).value)).includes('unsaved failure fixture'))
  assert.equal(child.exitCode, null)
  requestClose()
  await nativeButton('Close anyway')
  if (child.exitCode === null) await new Promise<void>((resolve) => child!.once('exit', () => resolve()))
  console.log('ok - failed save close shows native dialog; Keep open preserves edits and Close anyway exits')
} catch (error) {
  console.error(logs)
  if (browser?.connected) {
    for (const page of await browser.pages()) console.error('Window:', page.url(), await page.evaluate(() => document.body.innerText).catch(String))
  }
  throw error
} finally {
  browser?.disconnect()
  if (child?.exitCode === null) await killTree()
  await sleep(300)
  const resolved = path.resolve(temp)
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep))
  fs.rmSync(resolved, { recursive: true, force: true })
}
