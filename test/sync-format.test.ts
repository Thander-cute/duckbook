// Sync file format: this build writes format 2, still reads format 1 (0.1.1 and earlier 0.1.2
// builds), and refuses anything newer. A 0.1.1 device that reads a format-2 changes file must stop
// rather than apply it, because its schema would silently drop the fields it does not know.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../server/db.ts'
import { FolderRemote } from '../server/sync/remote.ts'
import { SyncRunner } from '../server/sync/runner.ts'
import { defaultSettings } from '../src/lib/schema.ts'

const day = (over: Record<string, unknown> = {}) => ({ grateful: '', tasks: [], notes: '', sentence: '', ...over })

function device() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-format-'))
  const store = new Store(dir)
  return {
    store,
    save(key: string, value: unknown) {
      const rev = store.allDocs().find((d) => d.key === key)?.rev ?? 0
      return store.putDocs([{ key, baseRev: rev, value }]).revs
    },
    close() {
      store.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

interface DriveFile { name: string; body: any }

async function files(remote: FolderRemote): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  for (const f of await remote.list()) {
    const raw = (await remote.read(f)).toString('utf8')
    out.push({ name: f.name, body: f.name.endsWith('.json') ? JSON.parse(raw) : raw })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Rewrite a JSON file's format version, as an older or newer build would have written it. */
async function rewrite(remote: FolderRemote, name: string, version: number) {
  const f = (await remote.list()).find((x) => x.name === name)!
  const body = JSON.parse((await remote.read(f)).toString('utf8'))
  body.version = version
  fs.writeFileSync(path.join(remote.dir, name), JSON.stringify(body))
}

test('this build writes format 2 and still reads format 1 from 0.1.1 and earlier builds', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-format-drive-'))
  const remote = new FolderRemote(folder)
  const writer = device()
  const reader = device()
  const w = new SyncRunner(writer.store, async () => remote)
  const r = new SyncRunner(reader.store, async () => remote)
  try {
    const photo = writer.store.savePhoto(Buffer.from([0xff, 0xd8, 0xff, 0x41, 0xff, 0xd9]))
    writer.save('day:2026-11-11', day({ notes: 'written by an older build', photos: [{ full: photo, thumb: photo, w: 10, h: 10, title: 'Synthetic summer', description: 'Synthetic caption.' }] }))
    writer.save('settings', { ...defaultSettings(), autoCopyWeek: true, autoCopiedWeek: '2026-11-02' })
    await w.join('start')

    const written = await files(remote)
    assert.equal(written.find((f) => f.name === 'notebook.json')!.body.version, 2, 'the notebook file is format 2')
    const ops = written.filter((f) => f.name.startsWith('ops-'))
    assert.ok(ops.length)
    assert.ok(ops.every((f) => f.body.version === 2), 'every changes file is format 2')

    // The same content as 0.1.1 or an earlier 0.1.2 build wrote it: format 1.
    await rewrite(remote, 'notebook.json', 1)
    for (const f of ops) await rewrite(remote, f.name, 1)
    await r.join('replace')
    const pages = reader.store.allDocs()
    const dayDoc = pages.find((d) => d.key === 'day:2026-11-11')!.value as any
    assert.equal(dayDoc.notes, 'written by an older build')
    assert.equal(dayDoc.photos[0].title, 'Synthetic summer')
    assert.equal(dayDoc.photos[0].description, 'Synthetic caption.')
    const settings = pages.find((d) => d.key === 'settings')!.value as any
    assert.equal(settings.autoCopyWeek, true)
    assert.equal(settings.autoCopiedWeek, '2026-11-02')
  } finally {
    w.stop()
    r.stop()
    writer.close()
    reader.close()
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('a changes file from a newer build is refused, and nothing in Drive or on this device is lost', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-format-drive-'))
  const remote = new FolderRemote(folder)
  const writer = device()
  const reader = device()
  const w = new SyncRunner(writer.store, async () => remote)
  const r = new SyncRunner(reader.store, async () => remote)
  try {
    writer.save('day:2026-11-11', day({ notes: 'from the writer' }))
    await w.join('start')
    await r.join('replace')
    const before = reader.store.allDocs().map((d) => [d.key, d.value])

    // The writer saves another page; its file is format 2, then pretend it came from a newer build.
    writer.save('day:2026-11-12', day({ notes: 'only the newer build has this' }))
    await w.syncNow()
    const newer = (await files(remote)).find((f) => f.name.startsWith('ops-') && f.body.ops.some((o: { key: string }) => o.key === 'day:2026-11-12'))!
    await rewrite(remote, newer.name, 3)
    await assert.rejects(r.syncNow(), /Another device runs a newer duckbook\. Update this app to keep syncing\./)
    assert.match(r.state().error ?? '', /Update this app to keep syncing/)
    assert.deepEqual(reader.store.allDocs().map((d) => [d.key, d.value]), before, 'nothing was applied')
    assert.ok(fs.existsSync(path.join(folder, newer.name)), 'the newer file stays in Drive')
    assert.equal((await files(remote)).find((f) => f.name === newer.name)!.body.version, 3)
  } finally {
    w.stop()
    r.stop()
    writer.close()
    reader.close()
    fs.rmSync(folder, { recursive: true, force: true })
  }
})

test('a notebook file from a newer build is refused on join', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'duckbook-format-drive-'))
  const remote = new FolderRemote(folder)
  const writer = device()
  const reader = device()
  const w = new SyncRunner(writer.store, async () => remote)
  const r = new SyncRunner(reader.store, async () => remote)
  try {
    writer.save('day:2026-11-11', day({ notes: 'from the writer' }))
    await w.join('start')
    await rewrite(remote, 'notebook.json', 3)
    await assert.rejects(r.join('replace'), /The notebook in Drive was made by a newer duckbook\. Update this app first\./)
    assert.equal(reader.store.docCount(), 0, 'nothing was taken')
    assert.ok(fs.existsSync(path.join(folder, 'notebook.json')), 'the notebook file stays in Drive')
  } finally {
    w.stop()
    r.stop()
    writer.close()
    reader.close()
    fs.rmSync(folder, { recursive: true, force: true })
  }
})
