// Duckbook launcher: start the local server if needed, then open http://localhost:5317.
//   node scripts/launch.ts            start (or reuse) and open the browser
//   node scripts/launch.ts --stop     stop the background server
//   node scripts/launch.ts --shortcut put a "Duckbook" shortcut on the Windows desktop

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PORT, defaultDataDir } from '../server/main.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.DUCKBOOK_PORT ?? DEFAULT_PORT)
const url = `http://localhost:${port}/`
const dataDir = defaultDataDir()
const args = new Set(process.argv.slice(2))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function isDuckbook() {
  try {
    const r = await fetch(`${url}api/health`, { headers: { 'X-Duckbook': '1' }, signal: AbortSignal.timeout(1500) })
    return r.ok && ((await r.json()) as { app?: string }).app === 'duckbook'
  } catch {
    return false
  }
}

const portBusy = (host: string) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ host, port })
    s.once('connect', () => (s.destroy(), resolve(true)))
    s.once('error', () => resolve(false))
    s.setTimeout(800, () => (s.destroy(), resolve(false)))
  })

/** Windows only: who is listening on our port? */
function listeners(): { pid: number; cmd: string }[] {
  if (process.platform !== 'win32') return []
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$_"; "$($p.ProcessId)|$($p.CommandLine)" }`,
      ],
      { encoding: 'utf8' },
    )
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => ({ pid: Number(l.split('|')[0]), cmd: l.slice(l.indexOf('|') + 1) }))
  } catch {
    return []
  }
}

function openBrowser() {
  if (args.has('--no-open')) return
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
}

function needsBuild() {
  const index = path.join(repo, 'dist', 'index.html')
  if (!fs.existsSync(index)) return true
  const built = fs.statSync(index).mtimeMs
  const newer = (p: string): boolean => {
    const st = fs.statSync(p)
    if (st.isDirectory()) return fs.readdirSync(p).some((f) => newer(path.join(p, f)))
    return st.mtimeMs > built
  }
  return ['src', 'index.html', 'package.json'].some((p) => newer(path.join(repo, p)))
}

function run(cmd: string, cmdArgs: string[]) {
  const r = spawnSync(cmd, cmdArgs, { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed`)
}

async function stop() {
  const pidFile = path.join(dataDir, 'server.pid')
  if (!fs.existsSync(pidFile)) return console.log('duckbook is not running.')
  const pid = Number(fs.readFileSync(pidFile, 'utf8'))
  try {
    process.kill(pid)
    console.log('duckbook stopped.')
  } catch {
    console.log('duckbook was not running.')
  }
  fs.rmSync(pidFile, { force: true })
}

function shortcut() {
  if (process.platform !== 'win32') return console.log('Shortcuts are only set up automatically on Windows.')
  const target = path.join(repo, 'Duckbook.cmd')
  const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\Duckbook.lnk');$s.TargetPath='${target}';$s.WorkingDirectory='${repo}';$s.WindowStyle=7;$s.Description='Open duckbook';$s.Save()`
  execFileSync('powershell', ['-NoProfile', '-Command', ps])
  console.log('Added "Duckbook" to your desktop.')
}

async function main() {
  if (args.has('--stop')) return stop()
  if (args.has('--shortcut')) return shortcut()

  if (await isDuckbook()) {
    openBrowser()
    return
  }

  if ((await portBusy('127.0.0.1')) || (await portBusy('::1'))) {
    const who = listeners()
    const oldDev = who.find((p) => /vite/i.test(p.cmd) && p.cmd.toLowerCase().includes(repo.toLowerCase().replace(/\//g, '\\')))
    if (oldDev) {
      console.log(`The old development server for duckbook (process ${oldDev.pid}) is using port ${port}.`)
      console.log('Stopping it does not touch your pages: they are stored in your browser and will be offered for moving into the database.')
      console.log('If you have duckbook open, wait a second after your last edit before continuing.')
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = (await rl.question('Stop it and switch to the new duckbook? [y/N] ')).trim().toLowerCase()
      rl.close()
      if (answer !== 'y' && answer !== 'yes') {
        console.log('Nothing changed.')
        process.exitCode = 1
        return
      }
      process.kill(oldDev.pid)
      for (let i = 0; i < 20 && ((await portBusy('127.0.0.1')) || (await portBusy('::1'))); i++) await sleep(250)
    } else {
      console.log(`Port ${port} is used by another program${who.length ? ` (${who.map((w) => `process ${w.pid}`).join(', ')})` : ''}. duckbook needs that exact address so it can find your existing pages.`)
      process.exitCode = 1
      return
    }
  }

  if (!fs.existsSync(path.join(repo, 'node_modules'))) {
    console.log('First run: installing…')
    run('npm', ['ci'])
  }
  if (needsBuild()) {
    console.log('Preparing duckbook…')
    run('npm', ['run', 'build'])
  }

  const logDir = path.join(dataDir, 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  const log = path.join(logDir, 'server.log')
  if (fs.existsSync(log) && fs.statSync(log).size > 1_000_000) fs.renameSync(log, path.join(logDir, 'server.old.log'))
  const fd = fs.openSync(log, 'a')
  const child = spawn(process.execPath, [path.join(repo, 'server', 'main.ts')], { cwd: repo, detached: true, stdio: ['ignore', fd, fd], windowsHide: true })
  let exited: number | null = null
  child.on('exit', (code) => (exited = code ?? 1))
  child.unref()

  for (let i = 0; i < 50; i++) {
    if (await isDuckbook()) {
      openBrowser()
      return
    }
    if (exited !== null) break
    await sleep(200)
  }
  console.log(`duckbook did not start. Details: ${log}`)
  process.exitCode = 1
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exitCode = 1
})
