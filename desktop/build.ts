import { build } from 'esbuild'
import { codeFingerprint } from '../server/version.ts'

await build({ entryPoints: ['desktop/main.ts', 'desktop/runtime.ts'], outdir: 'desktop-dist', bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron'], define: { DESKTOP_CODE: JSON.stringify(codeFingerprint()) } })
