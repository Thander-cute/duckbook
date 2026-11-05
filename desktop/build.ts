import { build } from 'esbuild'
import fs from 'node:fs'
import { codeFingerprint } from '../server/version.ts'
import { writeNotices } from '../scripts/notices.ts'

// The app's Google OAuth client (not committed), built in so people only press Connect.
const client = ['google-client.json', 'google_client.json'].find((f) => fs.existsSync(f))
const googleClient = client ? fs.readFileSync(client, 'utf8') : 'null'
console.log(client ? `Google Drive sync: built in from ${client}` : 'Google Drive sync: no google-client.json, so this build cannot connect to Google')

// This version's CHANGELOG.md section becomes the release notes shown before an update.
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version as string
const section = fs.readFileSync('CHANGELOG.md', 'utf8').split(/^## /m).find((s) => s.split(/\s/, 1)[0] === version)
const whatsNew = section?.slice(section.indexOf('\n')).trim()
fs.writeFileSync('build/release-notes.md', whatsNew ? `${whatsNew}\n` : `Duckbook ${version}\n`)

const define = { DESKTOP_CODE: JSON.stringify(codeFingerprint()), BUNDLED_GOOGLE_CLIENT: JSON.stringify(googleClient) }
// electron-updater is CommonJS and requires Node built-ins at runtime, which an ESM bundle needs a require for.
const banner = { js: "import { createRequire as __duckbookRequire } from 'node:module'; const require = __duckbookRequire(import.meta.url);" }
await build({ entryPoints: ['desktop/main.ts', 'desktop/runtime.ts'], outdir: 'desktop-dist', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron'], define, banner })
// A sandboxed preload must be one CommonJS file.
await build({ entryPoints: ['desktop/preload.ts'], outfile: 'desktop-dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] })
console.log(`Third-party notices: ${writeNotices('desktop-dist/THIRD_PARTY_NOTICES.txt')} packages`)
