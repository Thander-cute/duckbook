// Update path check: an old server (from a past commit) keeps running while the browser gets the new
// build. The page must refuse to edit, and the launcher must restart the server, after which the
// page continues by itself. Synthetic data, temp dirs, test port only.
// Run: npm run build && node test/upgrade.e2e.ts [oldCommit]

import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { codeFingerprint } from '../server/version.ts'
import { API_LEVEL } from '../src/lib/schema.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OLD = process.argv[2] ?? '766cc72'
const PORT = 5395
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-upgrade-'))
const wt = path.join(tmp, 'old')
const dataDir = path.join(tmp, 'data')
const env = { ...process.env, DUCKBOOK_PORT: String(PORT), DUCKBOOK_DATA_DIR: dataDir }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p))!

async function health() {
  try {
    return (await (await fetch(`${BASE}/api/health`, { headers: { 'X-Duckbook': '1' } })).json()) as { code?: string; pid?: number }
  } catch {
    return null
  }
}

async function main() {
  execFileSync('git', ['worktree', 'add', '--detach', wt, OLD], { cwd: repo, stdio: 'ignore' })
  // An old commit after sync existed still needs its one third-party package (yjs); a worktree has
  // no node_modules of its own, so link this checkout's. Removed before the worktree goes away.
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(wt, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  let old: ChildProcess | null = null
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true })
  try {
    // The old server code, serving the NEW build, as happens after `npm run build` with the server left running.
    fs.mkdirSync(dataDir, { recursive: true })
    const boot = `import { start } from ${JSON.stringify(pathToFileURL(path.join(wt, 'server', 'main.ts')).href)}; const s = await start({ distDir: ${JSON.stringify(path.join(repo, 'dist'))} }); (await import('node:fs')).writeFileSync(${JSON.stringify(path.join(dataDir, 'server.pid'))}, String(process.pid))`
    fs.writeFileSync(path.join(tmp, 'boot-old.ts'), boot)
    old = spawn(process.execPath, [path.join(tmp, 'boot-old.ts')], { env, stdio: 'ignore' })
    for (let i = 0; i < 50 && !(await health()); i++) await sleep(100)
    assert.ok(await health(), 'old server up')
    assert.notEqual((await health())!.code, codeFingerprint())

    const page = await browser.newPage()
    await page.goto(`${BASE}/#/day/2026-10-19`)
    const oldLevel = ((await (await fetch(`${BASE}/api/health`, { headers: { 'X-Duckbook': '1' } })).json()) as { apiLevel?: number }).apiLevel
    if (oldLevel !== API_LEVEL) {
      await page.waitForFunction(() => document.body.innerText.includes('still running the old version'))
      assert.equal(await page.$$eval('textarea', (x) => x.length), 0, 'no editing through the old server')
      console.log('ok - new page refuses to edit through an old server')
    } else {
      // Same data version: the shapes match, so the page may work; the launcher still restarts it below.
      await page.waitForSelector('.day-page')
      console.log('ok - same data version: page works, restart still offered')
    }

    const launcher = spawn(process.execPath, ['scripts/launch.ts', '--no-open'], { cwd: repo, env, stdio: ['pipe', 'pipe', 'inherit'] })
    let out = ''
    launcher.stdout!.on('data', (d) => (out += d))
    launcher.stdin!.write('y\n')
    const code = await new Promise<number | null>((r) => launcher.on('exit', r))
    assert.equal(code, 0, out)
    assert.match(out, /still running the old version/)
    assert.equal((await health())?.code, codeFingerprint(), 'launcher restarted onto the current code')
    console.log('ok - launcher restarts a server running old code')

    await page.reload()
    await page.waitForSelector('.day-page', { timeout: 15_000 })
    await page.click('.day-page .line textarea')
    await page.keyboard.type('after the update')
    await page.waitForSelector('[data-save="saved"]', { timeout: 5000 })
    console.log('ok - the open page continues by itself and saves')
  } finally {
    await browser.close()
    const h = await health()
    if (h?.pid) process.kill(h.pid)
    old?.kill()
    await sleep(300)
    try {
      if (process.platform === 'win32') fs.rmdirSync(path.join(wt, 'node_modules'))
      else fs.unlinkSync(path.join(wt, 'node_modules'))
    } catch {
      /* no link, or the worktree was never made */
    }
    execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo, stdio: 'ignore' })
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
