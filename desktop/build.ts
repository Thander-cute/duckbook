import { build } from 'esbuild'
import fs from 'node:fs'
import { codeFingerprint } from '../server/version.ts'

// The app's Google OAuth client (not committed), built in so people only press Connect.
const client = ['google-client.json', 'google_client.json'].find((f) => fs.existsSync(f))
const googleClient = client ? fs.readFileSync(client, 'utf8') : 'null'
console.log(client ? `Google Drive sync: built in from ${client}` : 'Google Drive sync: no google-client.json, so this build cannot connect to Google')

await build({ entryPoints: ['desktop/main.ts', 'desktop/runtime.ts'], outdir: 'desktop-dist', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron'], define: { DESKTOP_CODE: JSON.stringify(codeFingerprint()), BUNDLED_GOOGLE_CLIENT: JSON.stringify(googleClient) } })
