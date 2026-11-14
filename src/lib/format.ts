// Light formatting written into the text itself, so the stored note stays plain text that any
// version can show and sync can merge: **bold**, //italic//, __underline__, and a line of --- for a
// section break. Each mark has its own character, so marks side by side never run together.
// Web addresses, file links, Windows paths and network shares are always plain text, so their slashes
// and underscores are never marks. A backslash right before an exact pair (\** \// \__) keeps that pair
// as text and hides itself; every other backslash is ordinary text. Marks work within one line;
// anything that doesn't pair up is ordinary text. Shared by the browser and the server: no imports.

export interface Piece { text: string; b?: boolean; i?: boolean; u?: boolean; mark?: boolean }
export type NoteLine = { rule: true; text: string } | { rule: false; pieces: Piece[] }
export type Style = Pick<Piece, 'b' | 'i' | 'u'>

export const RULE = /^-{3,}[ \t\r]*$/
const DELIMS = '*/_'
const STYLE: Record<string, keyof Style> = { '*': 'b', '/': 'i', _: 'u' }
const space = (c: string | undefined) => c === undefined || /\s/.test(c)

// The rest of an address or path: up to the next space, leaving out marks that close right before it.
const TO_END = String.raw`\S*?(?=(?:\\?(?:\*\*|\/\/|__))*(?:\s|$))`
const START = String.raw`(?<![\p{L}\p{N}])`
const LITERAL = new RegExp(String.raw`${START}[a-z][a-z0-9+.-]*:\/\/${TO_END}|${START}www\.${TO_END}|${START}[a-z]:\\${TO_END}|(?<![^\s("'[<*/_])\\\\(?=[a-z0-9])${TO_END}`, 'giu')

/** Where the addresses and paths in a line are. */
export function literalSpans(s: string) {
  const out = new Uint8Array(s.length)
  for (const m of s.matchAll(LITERAL)) out.fill(1, m.index, m.index + m[0].length)
  return out
}

/** The note as lines of pieces. Joining every piece's text with newlines gives back the input exactly. */
export function parseNote(s: string): NoteLine[] {
  return s.split('\n').map((line): NoteLine => {
    if (RULE.test(line)) return { rule: true, text: line }
    // A section line kept as text.
    if (line[0] === '\\' && RULE.test(line.slice(1))) return { rule: false, pieces: [{ text: '\\', mark: true }, { text: line.slice(1) }] }
    return { rule: false, pieces: parseLine(line) }
  })
}

function parseLine(s: string): Piece[] {
  const literal = literalSpans(s)
  // Pairs a backslash keeps as text.
  const kept = new Set<number>()
  for (let k = 0; k < s.length; k++) {
    const c = s[k + 1]
    if (s[k] === '\\' && !literal[k] && c && DELIMS.includes(c) && s[k + 2] === c && s[k + 3] !== c) {
      kept.add(k + 1).add(k + 2)
      k += 2
    }
  }
  const text = (i: number) => kept.has(i) || literal[i] === 1
  const runAt = (i: number) => {
    const c = s[i]
    if (!DELIMS.includes(c) || text(i) || (s[i - 1] === c && !text(i - 1))) return 0
    let j = i
    while (s[j] === c && !text(j)) j++
    return j - i
  }
  // A delimiter is exactly two of its character, touching the text it wraps. `//` right after a colon
  // belongs to a web address, so it neither opens nor closes italic.
  const opens = (i: number, to: number) => runAt(i) === 2 && i + 2 < to && !space(s[i + 2]) && !(s[i] === '/' && s[i - 1] === ':')
  const closes = (j: number, c: string) => s[j] === c && runAt(j) === 2 && !space(s[j - 1]) && !(c === '/' && s[j - 1] === ':')

  const out: Piece[] = []
  const push = (text: string, style: Omit<Piece, 'text'>) => {
    if (!text) return
    const last = out[out.length - 1]
    const same = last && !!last.b === !!style.b && !!last.i === !!style.i && !!last.u === !!style.u && !!last.mark === !!style.mark
    if (same) last.text += text
    else out.push({ text, ...style })
  }
  // A search that found no closer from `from` up to `to` will find none from a later start either.
  const failed = new Map<string, { from: number; to: number }>()
  const walk = (from: number, to: number, style: Style) => {
    let done = from
    const flushTo = (i: number) => {
      for (let k = done; k < i; k++) {
        if (s[k] === '\\' && kept.has(k + 1)) push('\\', { ...style, mark: true })
        else push(s[k], style)
      }
      done = i
    }
    let i = from
    while (i < to) {
      const c = s[i]
      if (!opens(i, to) || style[STYLE[c]]) {
        i++
        continue
      }
      const f = failed.get(c)
      let close = -1
      if (!(f && f.from <= i && to <= f.to)) for (let j = i + 3; j < to - 1 && close < 0; j++) if (closes(j, c)) close = j
      if (close < 0) {
        if (!f || i < f.from || to > f.to) failed.set(c, { from: i, to })
        i += 2
        continue
      }
      flushTo(i)
      push(s.slice(i, i + 2), { ...style, mark: true })
      done = i + 2
      walk(i + 2, close, { ...style, [STYLE[c]]: true })
      push(s.slice(close, close + 2), { ...style, mark: true })
      i = done = close + 2
    }
    flushTo(to)
  }
  walk(0, s.length, {})
  return out
}

export const noteText = (lines: NoteLine[]) => lines.map((l) => (l.rule ? l.text : l.pieces.map((p) => p.text).join(''))).join('\n')

const MARK: Record<keyof Style, string> = { b: '**', i: '//', u: '__' }
const ORDER: (keyof Style)[] = ['u', 'b', 'i']

/** The formatting a line of characters holds once spaces and colons are written as they read back. */
function stylesOf(chars: { c: string; s: Style }[]) {
  const st: Style[] = chars.map((x) => ({ b: x.s.b || undefined, i: x.s.i || undefined, u: x.s.u || undefined }))
  for (let a = 0; a < st.length; a++) {
    if (!space(chars[a].c)) continue
    let b = a
    while (b < st.length && space(chars[b].c)) b++
    const left = a > 0 ? st[a - 1] : {}
    const right = b < st.length ? st[b] : {}
    for (let k = a; k < b; k++) st[k] = { b: (left.b && right.b) || undefined, i: (left.i && right.i) || undefined, u: (left.u && right.u) || undefined }
    a = b - 1
  }
  // `//` neither closes nor opens right after a colon (that reads as a web address): a colon ending
  // italic stays upright, and one just before italic leans with it.
  for (let k = st.length - 1; k >= 0; k--) if (st[k].i && chars[k].c === ':' && !st[k + 1]?.i) st[k] = { ...st[k], i: undefined }
  for (let k = st.length - 1; k > 0; k--) if (st[k].i && !st[k - 1].i && chars[k - 1].c === ':') st[k - 1] = { ...st[k - 1], i: true }
  return st
}

/** The text for characters and their formatting, with a backslash before each pair marked in `esc`. */
function renderLine(chars: { c: string; s: Style }[], st: Style[], esc: boolean[]) {
  const ends = (i: number, m: keyof Style) => {
    let j = i
    while (j < st.length && st[j][m]) j++
    return j
  }
  let text = ''
  const styles: Style[] = []
  const stack: (keyof Style)[] = []
  // Where each escaped pair's backslash sits, so an escape that lands in an address or path is found.
  const at: number[] = new Array(chars.length).fill(-1)
  for (let i = 0; i <= chars.length; i++) {
    const want = i < chars.length ? st[i] : {}
    // Close from the top down to the lowest mark that stops here; the ones above it reopen.
    const low = stack.findIndex((m) => !want[m])
    if (low >= 0) {
      for (let k = stack.length - 1; k >= low; k--) text += MARK[stack[k]]
      stack.length = low
    }
    if (i === chars.length) break
    const c = chars[i].c
    if (!space(c)) {
      const open = ORDER.filter((m) => want[m] && !stack.includes(m)).sort((x, y) => ends(i, y) - ends(i, x))
      for (const m of open) {
        text += MARK[m]
        stack.push(m)
      }
    }
    styles.push({ b: stack.includes('b') || undefined, i: stack.includes('i') || undefined, u: stack.includes('u') || undefined })
    if (esc[i]) {
      at[i] = text.length
      text += '\\'
    }
    text += c
  }
  return { text, styles, at }
}

/**
 * One line of styled characters as text, marks nested so they stay open longest, and the formatting
 * that text really holds. A delimiter must touch the text it wraps, so a space keeps only what both
 * of its neighbours share, and a mark reopened after another closes waits for the next letter. With
 * `escape`, exact pairs get a backslash, except where it would be part of an address or path.
 */
export function writeLine(chars: { c: string; s: Style }[], escape: boolean): { text: string; styles: Style[] } {
  const st = stylesOf(chars)
  const pair = (i: number) => {
    const c = chars[i].c
    return DELIMS.includes(c) && chars[i + 1]?.c === c && chars[i - 1]?.c !== c && chars[i + 2]?.c !== c
  }
  const esc = chars.map((_, i) => escape && pair(i))
  let out = renderLine(chars, st, esc)
  // An escape inside an address or path would be shown as text; that pair is already literal there,
  // so the escape is dropped. One at a time: dropping an earlier escape can free a later one.
  for (let k = 0; k < 32; k++) {
    const literal = literalSpans(out.text)
    const swallowed = chars.findIndex((_, i) => esc[i] && literal[out.at[i]] === 1)
    if (swallowed < 0) break
    esc[swallowed] = false
    out = renderLine(chars, st, esc)
  }
  return { text: out.text, styles: out.styles }
}

/** The styled characters a line of text stands for. */
export function lineChars(pieces: Piece[]) {
  const out: { c: string; s: Style }[] = []
  for (const p of pieces) if (!p.mark) for (const c of p.text) out.push({ c, s: { b: !!p.b || undefined, i: !!p.i || undefined, u: !!p.u || undefined } })
  return out
}
