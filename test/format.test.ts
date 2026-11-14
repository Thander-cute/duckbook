// Formatting written into note text, and the editor document it becomes: reading gives back the exact
// text, broken marks, web addresses and paths stay ordinary text, whatever the editor holds is written
// so it reads back the same, and an edit leaves the rest of its line byte for byte. Synthetic text only.
import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorState, type Transaction } from 'prosemirror-state'
import { noteText, parseNote } from '../src/lib/format.ts'
import { carry, schema, toDoc, toText } from '../src/lib/noteDoc.ts'

const VI = 'Hôm nay trời đẹp, tôi đã viết nhật ký ở quán cà phê. Ước gì ngày mai cũng vậy.'
const shape = (s: string) =>
  parseNote(s).map((l) => (l.rule ? 'RULE' : l.pieces.map((p) => (p.mark ? `[${p.text}]` : `${p.b ? 'B' : ''}${p.i ? 'I' : ''}${p.u ? 'U' : ''}:${p.text}`)).join(' ')))
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]

// Lines with addresses and paths, as they might sit in a note.
const URLS = 'xem http://a.com/x//y và https://b.vn/z//w và www.c.vn//q nhé'
const FILES = 'mở file:///C:/Users/me/a.txt và file:///D:/b//c//d nhé'
const PATH = String.raw`lưu ở C:\Users\me\__pycache__\x.py nhé`
const SHARE = String.raw`chia sẻ \\server\share\_tmp\_ và \\nas\**x nhé`
const SLASHES = 'a // b // c nhé'
const LITERAL_LINES = [URLS, FILES, PATH, SHARE, SLASHES]

test('reading gives back the exact text, Vietnamese precomposed and decomposed', () => {
  const samples = ['', '\n\n', VI, VI.normalize('NFD'), `**${VI.normalize('NFD')}**\n---\n//${VI}// and __${VI.normalize('NFD')}__`, 'a\r\nb **c**\r\n---\r\n', '\\**not**  \\--- x', '\\---', LITERAL_LINES.join('\n')]
  for (const s of samples) {
    assert.equal(noteText(parseNote(s)), s)
    assert.equal(toText(toDoc(s)), s, 'an unedited note is written back exactly')
  }
  assert.notEqual(VI, VI.normalize('NFD'))
})

test('random mark soup keeps every character, and an unopened note is written back exactly', () => {
  const parts = ['*', '**', '***', '/', '//', ':', '_', '__', '\\', '---', '-', ' ', '\n', 'ệ', 'e\u0302\u0323', 'ư', 'a', 'Đ', '\t', '\r', 'x', 'http://', 'C:\\', 'www.']
  for (let n = 0; n < 3000; n++) {
    let s = ''
    for (let k = Math.floor(rnd() * 40); k > 0; k--) s += pick(parts)
    assert.equal(noteText(parseNote(s)), s, JSON.stringify(s))
    assert.equal(toText(toDoc(s)), s, JSON.stringify(s))
  }
})

test('a long line full of unpaired marks is still quick', () => {
  const s = '**a '.repeat(20000) + '//b '.repeat(20000) + '__c '.repeat(20000) + 'http://x//y '.repeat(5000)
  const t = Date.now()
  assert.equal(noteText(parseNote(s)), s)
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`)
})

test('bold, italic, underline, nested, escaped, and a section line', () => {
  assert.deepEqual(shape('a **đẹp** b'), [':a  [**] B:đẹp [**] : b'])
  assert.deepEqual(shape('//nghiêng// __gạch__'), ['[//] I:nghiêng [//] :  [__] U:gạch [__]'])
  assert.deepEqual(shape('**//cả hai//**'), ['[**] [//] BI:cả hai [//] [**]'])
  assert.deepEqual(shape('chữ**đậm**chữ'), [':chữ [**] B:đậm [**] :chữ'], 'inside a word')
  assert.deepEqual(shape('\\**không đậm\\**'), ['[\\] :**không đậm [\\] :**'], 'a backslash before an exact pair keeps it as text')
  assert.deepEqual(shape(String.raw`a \ b \* c \*** d \\ e`), [String.raw`:a \ b \* c \*** d \\ e`], 'any other backslash is just text')
  assert.deepEqual(shape('trên\n---\ndưới\n\\---'), [':trên', 'RULE', ':dưới', '[\\] :---'])
})

test('a mark right around an address or path still works', () => {
  assert.deepEqual(shape('**https://a.vn/x//y** và //www.b.vn// nhé'), ['[**] B:https://a.vn/x//y [**] : và  [//] I:www.b.vn [//] : nhé'])
  assert.deepEqual(shape(String.raw`__C:\Users\me__ và **\\nas\share**`), [String.raw`[__] U:C:\Users\me [__] : và  [**] B:\\nas\share [**]`])
})

test('broken, ambiguous, address or path marks are ordinary text, with nothing hidden', () => {
  const plain = ['**mở', 'đóng**', '** cách**', '**cách **', '****', '***x***', '*một*', '_một_', '//', '--', ' ---', '--- chữ', '**a\nb**', ...LITERAL_LINES]
  plain.push('a//b http://c', 'https://a.vn/x//y và https://b.vn/z', 'xem http://a.com và http://b.com', 'C:\\_tạm\\_', 'www.a.vn/__x__ và www.b.vn/**y**', 'ghi chú://a//')
  for (const s of plain)
    for (const l of parseNote(s)) {
      assert.equal(l.rule, false, s)
      if (!l.rule) assert.ok(l.pieces.every((p) => !p.b && !p.i && !p.u && !p.mark), `${JSON.stringify(s)} → ${JSON.stringify(l.pieces)}`)
    }
})

/** What the editor shows: each character with its formatting, and the section lines. */
const seen = (doc: ReturnType<typeof toDoc>) => {
  const out: string[] = []
  doc.forEach((n) => {
    if (n.type.name === 'rule') return void out.push('RULE')
    let line = ''
    n.forEach((t) => {
      const m = t.marks.map((x) => x.type.name).sort().join('')
      for (const c of t.text!) line += /\s/.test(c) ? c : `${c}${m ? `{${m}}` : ''}`
    })
    out.push(line)
  })
  return out
}
const para = (parts: [string, string[]][]) => schema.nodes.paragraph.create(null, parts.filter(([t]) => t).map(([t, m]) => schema.text(t, m.map((x) => schema.marks[x].create()))))

test('notes as people write them: whatever the editor holds is written so it reads back the same', () => {
  const words = ['hôm', 'nay', 'trời', 'đẹp', 'tôi', 'viết', 'nhật', 'ký', 'https://a.vn/x//y', 'file:///C:/a.txt', String.raw`C:\Users\me\__pycache__\x.py`, String.raw`\\server\share`, 'a//b', '1/2', 'snake_case', 'e.g.', '(xem', 'ok)', '5*3', '---']
  const styles = [[], [], [], ['b'], ['i'], ['u'], ['b', 'i'], ['i', 'u']]
  for (let n = 0; n < 4000; n++) {
    const blocks = []
    for (let p = 1 + Math.floor(rnd() * 3); p > 0; p--) {
      if (rnd() < 0.1) {
        blocks.push(schema.nodes.rule.create())
        continue
      }
      const parts: [string, string[]][] = []
      for (let k = 1 + Math.floor(rnd() * 8); k > 0; k--) parts.push([' ', []], [pick(words), pick(styles)])
      blocks.push(para(parts))
    }
    const doc = schema.nodes.doc.create(null, blocks)
    const text = toText(doc)
    const back = toDoc(text)
    assert.deepEqual(seen(back), seen(doc), JSON.stringify(text))
    assert.equal(toText(back), text, 'and reads the same text again')
  }
})

test('any formatting at all keeps every character and reads back as the same text', () => {
  const letters = ['a', 'ệ', 'ư', 'Đ', ' ', ' ', '*', '/', '_', '\\', ':', '-', 'x', '.']
  const styles = [[], ['b'], ['i'], ['u'], ['b', 'i'], ['b', 'u'], ['i', 'u'], ['b', 'i', 'u']]
  let same = 0
  for (let n = 0; n < 4000; n++) {
    const parts: [string, string[]][] = []
    for (let k = Math.floor(rnd() * 8); k > 0; k--) {
      let t = ''
      for (let j = 1 + Math.floor(rnd() * 5); j > 0; j--) t += pick(letters)
      parts.push([t, pick(styles)])
    }
    const doc = schema.nodes.doc.create(null, [para(parts)])
    const text = toText(doc)
    const back = toDoc(text)
    assert.equal(back.textContent, doc.textContent, JSON.stringify(text))
    assert.equal(toText(back), text)
    // Formatting a mark character right at the edge of its own mark (bold ending in *) can't be held;
    // only that formatting is let go. This soup is full of such cases; real notes rarely are.
    if (JSON.stringify(seen(back)) === JSON.stringify(seen(doc))) same++
  }
  assert.ok(same > 2000, `${same} of 4000 kept all their formatting`)
})

test('typed-looking text in the editor stays text: dashes, stars, slashes, a web address', () => {
  const p = (t: string) => schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, t ? [schema.text(t)] : [])])
  for (const t of ['---', '**not bold**', '1/2 and 3/4', 'https://a.vn và https://b.vn', 'snake_case and __init__', 'a \\* b', ...LITERAL_LINES]) {
    const text = toText(p(t))
    assert.deepEqual(seen(toDoc(text)), [t], `${t} → ${text}`)
  }
  for (const t of ['1/2 and 3/4', 'a \\* b', ...LITERAL_LINES]) assert.equal(toText(p(t)), t, 'no backslashes when nothing needs them')
  assert.equal(toText(p('**not bold**')), '\\**not bold\\**')
  const bold = schema.nodes.doc.create(null, [para([['đậm ', ['b']], ['thường', []]])])
  assert.equal(toText(bold), '**đậm** thường', 'the space leaves the bold')
})

/** The note after an edit made the way the editor makes it, with the edit carried over to the text. */
function edited(note: string, change: (tr: Transaction, at: (line: number, word: string, end?: boolean) => number) => void) {
  const state = EditorState.create({ doc: toDoc(note) })
  const at = (line: number, word: string, end = false) => {
    let pos = 0
    for (let k = 0; k < line; k++) pos += state.doc.child(k).nodeSize
    const i = state.doc.child(line).textContent.indexOf(word)
    assert.ok(i >= 0, word)
    return pos + 1 + i + (end ? word.length : 0)
  }
  const tr = state.tr
  change(tr, at)
  carry(state.doc, tr.doc)
  return toText(tr.doc)
}

test('typing or deleting next to an address, a path or slashes leaves them byte for byte', () => {
  const note = [...LITERAL_LINES, '**đậm**   **x** và //y//:'].join('\n')
  const lines = note.split('\n')
  const expect = (n: number, line: string) => lines.map((l, k) => (k === n ? line : l)).join('\n')
  for (let n = 0; n < LITERAL_LINES.length; n++) {
    const first = lines[n].split(' ')[0]
    assert.equal(
      edited(note, (tr, at) => tr.insertText('!', at(n, 'nhé', true))),
      expect(n, lines[n].replace(/nhé$/, 'nhé!')),
    )
    assert.equal(
      edited(note, (tr, at) => tr.insertText('X', at(n, first) + 1)),
      expect(n, first[0] + 'X' + lines[n].slice(1)),
    )
    assert.equal(
      edited(note, (tr, at) => tr.delete(at(n, ' nhé'), at(n, ' nhé', true))),
      expect(n, lines[n].replace(/ nhé$/, '')),
    )
    // Bolding a word writes the line again; addresses and paths come out as they were.
    assert.equal(
      edited(note, (tr, at) => tr.addMark(at(n, 'nhé'), at(n, 'nhé', true), schema.marks.b.create())),
      expect(n, lines[n].replace(/nhé$/, '**nhé**')),
    )
  }
  // Marks around an edit keep their exact bytes, spaces between them too.
  assert.equal(
    edited(note, (tr, at) => tr.insertText('à', at(5, 'và', true))),
    expect(5, '**đậm**   **x** vàà //y//:'),
  )
  assert.equal(
    edited(note, (tr, at) => tr.insertText('ơ', at(5, 'đậm', true))),
    expect(5, '**đậmơ**   **x** và //y//:'),
    'typed at the end of bold stays inside it',
  )
})

test('an old version shows the stored text as it is: nothing in it is rewritten by opening it here', () => {
  const note = [...LITERAL_LINES, '**đậm** //nghiêng// __gạch__', '---'].join('\n')
  assert.equal(toText(toDoc(note)), note)
  assert.equal(noteText(parseNote(note)), note)
})
