// Where devices meet: one folder of files. Each device only ever creates files with its own name,
// never edits or deletes another's, so a plain file store (Google Drive, or a folder in tests) is enough.

import fs from 'node:fs'
import path from 'node:path'

/** `modifiedTime` is the store's own clock (ISO), never this computer's. */
export interface RemoteFile { id: string; name: string; modifiedTime?: string }

export interface Remote {
  /** Files in the notebook folder, optionally only those added since a time (ISO). */
  list(since?: string): Promise<RemoteFile[]>
  read(file: RemoteFile): Promise<Buffer>
  create(name: string, data: Buffer, mime: string): Promise<void>
}

/** A local folder standing in for Drive (tests, and anyone who prefers a synced folder). */
export class FolderRemote implements Remote {
  readonly dir: string
  constructor(dir: string) {
    this.dir = dir
  }

  async list(since?: string) {
    if (!fs.existsSync(this.dir)) return []
    const after = since ? Date.parse(since) : 0
    return fs
      .readdirSync(this.dir)
      .map((name) => ({ name, mtime: fs.statSync(path.join(this.dir, name)).mtimeMs }))
      .filter((f) => !f.name.endsWith('.tmp') && f.mtime > after)
      .map((f) => ({ id: f.name, name: f.name, modifiedTime: new Date(f.mtime).toISOString() }))
  }

  async read(file: RemoteFile) {
    return fs.readFileSync(path.join(this.dir, file.id))
  }

  async create(name: string, data: Buffer) {
    fs.mkdirSync(this.dir, { recursive: true })
    const tmp = path.join(this.dir, `${name}.${process.pid}.tmp`)
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, path.join(this.dir, name))
  }
}
