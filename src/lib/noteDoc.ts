// A note's text as an editor document and back. The text stays what is stored and synced (see
// format.ts); the document is only how the editor holds it while open. A line nobody edited is
// written back exactly as it was read.

import { Schema, type Mark, type Node } from 'prosemirror-model'
import { lineChars, parseNote, RULE, writeLine, type Piece, type Style } from './format.ts'

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    // The section line keeps the dashes it was written with.
    rule: { group: 'block', attrs: { text: { default: '---' } }, parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'], leafText: () => '---' },
    text: {},
  },
  // Pasted inline styles become these tags first (the page's security policy blocks style attributes).
  marks: {
    u: { parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] },
    b: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    i: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
  },
})

const { paragraph, rule } = schema.nodes
const MARKS = { b: schema.marks.b, i: schema.marks.i, u: schema.marks.u }

// The exact line each paragraph was read from. Documents never change in place, so a paragraph that
// is still the same object is unedited.
const read = new WeakMap<Node, string>()
const written = new WeakMap<Node, string>()

const marksOf = (s: Style) => (['b', 'i', 'u'] as const).filter((m) => s[m]).map((m) => MARKS[m].create())

const paragraphOf = (pieces: Piece[]) => paragraph.create(null, pieces.filter((p) => !p.mark && p.text).map((p) => schema.text(p.text, marksOf(p))))

/** The document for a note's text. */
export function toDoc(text: string): Node {
  const lines = text.split('\n')
  const blocks = parseNote(text).map((l, n) => {
    if (l.rule) return rule.create({ text: l.text })
    const p = paragraphOf(l.pieces)
    read.set(p, lines[n])
    return p
  })
  return schema.nodes.doc.create(null, blocks)
}

const styleOf = (marks: readonly Mark[]): Style => ({
  b: marks.some((m) => m.type === MARKS.b) || undefined,
  i: marks.some((m) => m.type === MARKS.i) || undefined,
  u: marks.some((m) => m.type === MARKS.u) || undefined,
})

type Chars = { c: string; s: Style }[]
const sameStyle = (x: { s: Style }, y: { s: Style }) => !!x.s.b === !!y.s.b && !!x.s.i === !!y.s.i && !!x.s.u === !!y.s.u
const charsOf = (p: Node): Chars => {
  const out: Chars = []
  p.forEach((t) => {
    for (const c of t.text ?? '') out.push({ c, s: styleOf(t.marks) })
  })
  return out
}
/** Whether a line reads back as these characters with this formatting (a space's formatting can't be seen). */
function reads(line: string, chars: Chars, styles: Style[] = chars.map((x) => x.s)) {
  if (RULE.test(line)) return false
  const l = parseNote(line)[0]
  if (l.rule) return false
  const back = lineChars(l.pieces)
  return back.length === chars.length && back.every((x, k) => x.c === chars[k].c && (/\s/.test(x.c) || sameStyle(x, { s: styles[k] })))
}

/** The line, unless it would read back as other characters or other formatting. */
function checked(chars: Chars, escape: boolean): string | null {
  const { text, styles } = writeLine(chars, escape)
  // A paragraph of dashes is not a section line.
  const line = RULE.test(text) ? `\\${text}` : text
  const l = parseNote(line)[0]
  const back = lineChars(l.rule ? [{ text: line }] : l.pieces)
  const ok = back.length === chars.length && back.every((x, k) => x.c === chars[k].c && sameStyle(x, { s: styles[k] }))
  return ok ? line : null
}

/** Marks to take off or put on so the editor shows what its text reads back as. Null when the characters differ. */
export function markFixes(doc: Node, back: Node): { from: number; to: number; mark: Mark; on: boolean }[] | null {
  const out: { from: number; to: number; mark: Mark; on: boolean }[] = []
  const a: { node: Node; pos: number }[] = []
  const b: { node: Node; pos: number }[] = []
  doc.forEach((n, pos) => a.push({ node: n, pos }))
  back.forEach((n, pos) => b.push({ node: n, pos }))
  if (a.length !== b.length) return null
  for (let k = 0; k < a.length; k++) {
    if (a[k].node.type !== b[k].node.type) return null
    if (a[k].node.type === rule) continue
    const mine: { c: string; marks: readonly Mark[]; pos: number }[] = []
    a[k].node.forEach((t, offset) => {
      let at = a[k].pos + 1 + offset
      for (const c of t.text ?? '') {
        mine.push({ c, marks: t.marks, pos: at })
        at += c.length
      }
    })
    const theirs: { c: string; marks: readonly Mark[] }[] = []
    b[k].node.forEach((t) => {
      for (const c of t.text ?? '') theirs.push({ c, marks: t.marks })
    })
    if (mine.length !== theirs.length) return null
    for (let i = 0; i < mine.length; i++) if (mine[i].c !== theirs[i].c) return null
    for (const m of ['b', 'i', 'u'] as const) {
      let run: { from: number; to: number; on: boolean } | null = null
      const flush = () => {
        if (run) out.push({ ...run, mark: MARKS[m].create() })
        run = null
      }
      for (let i = 0; i < mine.length; i++) {
        const has = mine[i].marks.some((x) => x.type === MARKS[m])
        const want = theirs[i].marks.some((x) => x.type === MARKS[m])
        if (has === want) {
          flush()
          continue
        }
        const from = mine[i].pos
        const to = from + mine[i].c.length
        if (run && run.on === !has && run.to === from) run.to = to
        else {
          flush()
          run = { from, to, on: !has }
        }
      }
      flush()
    }
  }
  return out
}

/** One paragraph as a line: as read if unedited, otherwise written so it reads back the same. */
function lineOf(p: Node): string {
  const known = read.get(p) ?? written.get(p)
  if (known !== undefined) return known
  const chars = charsOf(p)
  const without = (m: keyof Style) => chars.map((x) => ({ c: x.c, s: { ...x.s, [m]: undefined } }))
  // Formatting the text can't hold (a * inside bold right at its edge, say): keep every character and
  // as much of the formatting as fits.
  const line =
    checked(chars, false) ??
    checked(chars, true) ??
    checked(without('b'), true) ??
    checked(without('i'), true) ??
    checked(without('u'), true) ??
    checked(chars.map((x) => ({ c: x.c, s: {} })), true) ??
    // Never reached in the tests; if it is, the characters are kept as they are.
    chars.map((x) => x.c).join('')
  written.set(p, line)
  return line
}

/** Where each character of a line sits in its text. */
function placesOf(line: string): number[] | null {
  const l = parseNote(line)[0]
  if (l.rule) return null
  const out: number[] = []
  let at = 0
  for (const p of l.pieces) {
    if (p.mark) at += p.text.length
    else
      for (const c of p.text) {
        out.push(at)
        at += c.length
      }
  }
  return out
}

/** The old line with only the edited characters replaced, if it then reads as the edited paragraph. */
function spliced(line: string, a: Chars, b: Chars): string | null {
  const at = placesOf(line)
  if (!at || at.length !== a.length) return null
  const same = (x: Chars[number], y: Chars[number]) => x.c === y.c && sameStyle(x, y)
  let k = 0
  while (k < a.length && k < b.length && same(a[k], b[k])) k++
  let m = 0
  while (m < a.length - k && m < b.length - k && same(a[a.length - 1 - m], b[b.length - 1 - m])) m++
  const put = b.slice(k, b.length - m)
  if (put.some((x) => !sameStyle(x, put[0]))) return null
  let from: number
  let to: number
  if (k < a.length - m) {
    const last = a.length - m - 1
    from = at[k]
    to = at[last] + a[last].c.length
  } else {
    // Typed between two characters: inside the formatting it shares with one of them.
    const before = a[k - 1]
    const after = a[k]
    if (before && sameStyle(before, put[0])) from = at[k - 1] + before.c.length
    else if (after && sameStyle(after, put[0])) from = at[k]
    else if (!before && !after) from = line.length
    else return null
    to = from
  }
  const out = line.slice(0, from) + put.map((x) => x.c).join('') + line.slice(to)
  return reads(out, b) ? out : null
}

/**
 * Carries an edit over to the text: when one paragraph changed, its old line with only the edited
 * characters replaced, so addresses, paths and marks around the edit keep their exact bytes.
 */
export function carry(prev: Node, next: Node) {
  const start = prev.content.findDiffStart(next.content)
  if (start === null) return
  const end = prev.content.findDiffEnd(next.content)!
  const overlap = start - Math.min(end.a, end.b)
  if (overlap > 0) {
    end.a += overlap
    end.b += overlap
  }
  const inside = (doc: Node, from: number, to: number) => {
    let found: Node | null = null
    doc.forEach((n, pos) => {
      if (pos < from && to < pos + n.nodeSize) found = n
    })
    return found as Node | null
  }
  const a = inside(prev, start, end.a)
  const b = inside(next, start, end.b)
  if (!a || !b || a.type !== paragraph || b.type !== paragraph || read.has(b) || written.has(b)) return
  const line = spliced(lineOf(a), charsOf(a), charsOf(b))
  if (line !== null) written.set(b, line)
}

/** The note's text for a document. */
export function toText(doc: Node): string {
  const lines: string[] = []
  doc.forEach((n) => lines.push(n.type === rule ? n.attrs.text : lineOf(n)))
  return lines.join('\n')
}
