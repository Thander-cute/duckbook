// Which server code is running. The launcher compares this with the files on disk to notice
// a server started before an update (Node keeps the code it loaded at start).

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
declare const DESKTOP_CODE: string | undefined

export function codeFingerprint() {
  if (typeof DESKTOP_CODE !== 'undefined') return DESKTOP_CODE
  const files = [
    ...fs
      .readdirSync(path.join(repo, 'server'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts'))
      .sort()
      .map((f) => path.join('server', f)),
    ...['schema.ts', 'tree.ts'].map((f) => path.join('src', 'lib', f)),
  ]
  const h = createHash('sha256')
  for (const f of files) h.update(f).update('\0').update(fs.readFileSync(path.join(repo, f))).update('\0')
  return h.digest('hex').slice(0, 16)
}
