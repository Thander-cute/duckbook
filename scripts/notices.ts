// Writes THIRD_PARTY_NOTICES.txt: the licence of every production dependency, which covers
// everything bundled into the app (Electron's own notices ship beside it as LICENSE.electron.txt
// and LICENSES.chromium.html).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export function writeNotices(out: string) {
  const dirs = execSync('npm ls --omit=dev --all --parseable', { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((d) => d.includes(`node_modules${path.sep}`))
  const seen = new Set<string>()
  const parts: string[] = []
  for (const dir of [...new Set(dirs)].sort()) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string; homepage?: string; author?: string | { name?: string } }
    const id = `${pkg.name}@${pkg.version}`
    if (seen.has(id)) continue
    seen.add(id)
    const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
    if (!file && !pkg.license) throw new Error(`${id} has no licence; add its notice by hand before shipping.`)
    const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
    const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : `Licensed under ${pkg.license}${author ? `, copyright ${author}` : ''}. The package ships no licence file.`
    parts.push(`${id} (${pkg.license ?? 'see below'})${pkg.homepage ? `\n${pkg.homepage}` : ''}\n\n${text}\n`)
  }
  const head = 'Duckbook includes the following third-party software. Each is used under the licence shown.\n'
  fs.writeFileSync(out, [head, ...parts].join(`\n${'='.repeat(72)}\n\n`))
  return seen.size
}
