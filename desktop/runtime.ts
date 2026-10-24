import { start } from '../server/main.ts'

const parent = process.parentPort!
parent.on('message', async ({ data }) => {
  if (data.type !== 'start') return
  try {
    const server = await start(data.options)
    parent.on('message', async ({ data }) => {
      if (data.type === 'stop') {
        await server.stop()
        process.exit(0)
      }
    })
    parent.postMessage({ type: 'ready', node: process.versions.node })
  } catch (e) {
    parent.postMessage({ type: 'error', error: (e as Error).message })
    process.exitCode = 1
  }
})
