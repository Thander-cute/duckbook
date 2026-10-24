import os from 'node:os'
import path from 'node:path'

export function defaultDataDir() {
  if (process.env.DUCKBOOK_DATA_DIR) return path.resolve(process.env.DUCKBOOK_DATA_DIR)
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Duckbook')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Duckbook')
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'duckbook')
}
