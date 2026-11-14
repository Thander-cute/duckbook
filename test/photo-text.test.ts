// Day photo titles and descriptions: shape, limits, strict saves, lenient import, and photo cleanup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_PHOTO_DESCRIPTION,
  MAX_PHOTO_TITLE,
  SchemaError,
  normalizeDoc,
  normalizeState,
  photoDescription,
  photoRefs,
  photoTitle,
  repairDoc,
  stateToDocs,
} from '../src/lib/schema.ts'
import { startTestServer } from './helpers.ts'

const full = 'a'.repeat(64)
const thumb = 'b'.repeat(64)
const photo = (over: Record<string, unknown> = {}) => ({ full, thumb, w: 300, h: 200, ...over })
const day = (photos?: unknown[]) => ({ grateful: '', tasks: [], notes: '', sentence: '', ...(photos ? { photos } : {}) })
const dayKey = 'day:2026-11-11'

test('a title is one line, trimmed and cut; a description keeps up to four lines and is cut', () => {
  assert.equal(photoTitle('  A   day\nout  '), 'A day out')
  assert.equal(photoTitle('x'.repeat(MAX_PHOTO_TITLE + 5)).length, MAX_PHOTO_TITLE)
  assert.equal(photoDescription('  first\r\nsecond\n\n'), 'first\nsecond')
  assert.equal(photoDescription('y'.repeat(MAX_PHOTO_DESCRIPTION + 5)).length, MAX_PHOTO_DESCRIPTION)
  assert.equal(photoTitle('   '), '')
  assert.equal(photoDescription('\n\n'), '')

  // At most four lines: later lines are joined into the fourth with a space, no text lost.
  assert.equal(photoDescription('one\ntwo\nthree\nfour'), 'one\ntwo\nthree\nfour')
  assert.equal(photoDescription('one\ntwo\nthree\nfour\nfive\nsix'), 'one\ntwo\nthree\nfour five six')
  assert.equal(photoDescription('one\n\n\n\n\nsix'), 'one\n\n\nsix')
  assert.equal(photoDescription('one\ntwo\nthree\nfour\n'), 'one\ntwo\nthree\nfour')
  const folded = photoDescription(Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'))
  assert.equal(folded.split('\n').length, 4)
  assert.match(folded, /^line 1\nline 2\nline 3\nline 4 line 5 line 6 line 7 line 8 line 9 line 10$/)
  assert.equal(photoDescription('a'.repeat(MAX_PHOTO_DESCRIPTION) + '\nmore').length, MAX_PHOTO_DESCRIPTION)
})

test('strict saves keep a photo title and description, cut to their limits, and omit empty ones', () => {
  const saved = normalizeDoc(dayKey, day([photo({ title: '  A   day  ', description: '  first\r\nsecond  ' })])) as any
  assert.deepEqual(saved.photos[0], { full, thumb, w: 300, h: 200, title: 'A day', description: 'first\nsecond' })

  const long = normalizeDoc(dayKey, day([photo({ title: 'x'.repeat(MAX_PHOTO_TITLE + 10), description: 'y'.repeat(MAX_PHOTO_DESCRIPTION + 10) })])) as any
  assert.equal(long.photos[0].title.length, MAX_PHOTO_TITLE)
  assert.equal(long.photos[0].description.length, MAX_PHOTO_DESCRIPTION)

  const empty = normalizeDoc(dayKey, day([photo({ title: '   ', description: '\n\n' })])) as any
  assert.equal('title' in empty.photos[0], false)
  assert.equal('description' in empty.photos[0], false)

  // A save with more than four lines is folded before it is stored.
  const folded = normalizeDoc(dayKey, day([photo({ description: 'one\ntwo\nthree\nfour\nfive' })])) as any
  assert.equal(folded.photos[0].description, 'one\ntwo\nthree\nfour five')

  // A photo without either is stored exactly as before.
  assert.deepEqual(normalizeDoc(dayKey, day([photo()])), { ...day(), photos: [{ full, thumb, w: 300, h: 200 }] })
  assert.deepEqual(normalizeDoc(dayKey, day()), day())

  // Wrong types are refused on a live save.
  assert.throws(() => normalizeDoc(dayKey, day([photo({ title: 42 })])), SchemaError)
  assert.throws(() => normalizeDoc(dayKey, day([photo({ description: {} })])), SchemaError)
})

test('lenient import sets a bad title aside, keeps the photo and its other text, and cuts long text', () => {
  const { value, quarantine } = repairDoc(dayKey, day([photo({ title: { nested: true }, description: 'synthetic note' })])) as any
  assert.equal(value.photos.length, 1)
  assert.equal(value.photos[0].full, full)
  assert.equal('title' in value.photos[0], false)
  assert.equal(value.photos[0].description, 'synthetic note')
  assert.ok(quarantine.some((q: { path: string }) => q.path === `${dayKey}.photos.0.title`))

  const imported = normalizeState({
    version: 1,
    days: {
      '2026-11-11': day([photo({ title: 'x'.repeat(MAX_PHOTO_TITLE + 10), description: 'y'.repeat(MAX_PHOTO_DESCRIPTION + 10) })]),
    },
  })
  assert.equal(imported.state.days['2026-11-11'].photos![0].title!.length, MAX_PHOTO_TITLE)
  assert.equal(imported.state.days['2026-11-11'].photos![0].description!.length, MAX_PHOTO_DESCRIPTION)

  const exported = normalizeState({ format: 'duckbook-export', state: { version: 1, days: { '2026-11-11': day([photo({ title: 'from an export' })]) } } })
  assert.equal(exported.state.days['2026-11-11'].photos![0].title, 'from an export')
})

test('photo cleanup still follows full and thumb only, never the new text', () => {
  const titleLikeHash = 'c'.repeat(64)
  const docs = stateToDocs(
    normalizeState({
      version: 1,
      days: { '2026-11-11': day([photo({ title: titleLikeHash, description: titleLikeHash })]) },
    }).state,
  )
  assert.deepEqual([...photoRefs(docs)].sort(), [full, thumb].sort())
})

test('the server saves, cuts and exports a photo title and description; a bad one is refused', async () => {
  const s = await startTestServer()
  try {
    let r = await s.call('PUT', '/api/docs', {
      changes: [{ key: dayKey, baseRev: 0, value: day([photo({ title: 'x'.repeat(MAX_PHOTO_TITLE + 10), description: 'y'.repeat(MAX_PHOTO_DESCRIPTION + 10) })]) }],
    })
    assert.equal(r.status, 200)
    const find = async () => (await s.call('GET', '/api/data')).json.docs.find((d: { key: string }) => d.key === dayKey)
    let doc = await find()
    assert.equal(doc.value.photos[0].title.length, MAX_PHOTO_TITLE)
    assert.equal(doc.value.photos[0].description.length, MAX_PHOTO_DESCRIPTION)

    r = await s.call('PUT', '/api/docs', { changes: [{ key: dayKey, baseRev: doc.rev, value: day([photo({ title: 42 })]) }] })
    assert.equal(r.status, 400, 'a title that is not text is refused')

    r = await s.call('PUT', '/api/docs', { changes: [{ key: dayKey, baseRev: doc.rev, value: day([photo({ title: 'A day out', description: 'first\nsecond' })]) }] })
    assert.equal(r.status, 200)
    doc = await find()
    assert.equal(doc.value.photos[0].title, 'A day out')
    assert.equal(doc.value.photos[0].description, 'first\nsecond')

    // The server folds a description past four lines too, so a sync or import cannot exceed it.
    r = await s.call('PUT', '/api/docs', { changes: [{ key: dayKey, baseRev: doc.rev, value: day([photo({ title: 'A day out', description: 'one\ntwo\nthree\nfour\nfive\nsix' })]) }] })
    assert.equal(r.status, 200)
    doc = await find()
    assert.equal(doc.value.photos[0].description, 'one\ntwo\nthree\nfour five six')

    const exp = (await s.call('GET', '/api/export')).json
    assert.equal(exp.state.days['2026-11-11'].photos[0].title, 'A day out')
    assert.equal(exp.state.days['2026-11-11'].photos[0].description, 'one\ntwo\nthree\nfour five six')
  } finally {
    await s.cleanup()
  }
})
