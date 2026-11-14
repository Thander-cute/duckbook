import { useEffect, useRef } from 'react'
import { Slice, type MarkType, type Node } from 'prosemirror-model'
import { EditorState, TextSelection, type Command } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark } from 'prosemirror-commands'
import { InputRule, inputRules, undoInputRule } from 'prosemirror-inputrules'
import 'prosemirror-view/style/prosemirror.css'
import '@fontsource/dancing-script/700.css'
import { carry, markFixes, schema, toDoc, toText } from '../lib/noteDoc'
import { merge3 } from '../lib/tree'

export interface NoteProps {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
  className?: string
}

const { b, i, u } = schema.marks
const { paragraph, rule } = schema.nodes

/** The caret's character offset in the note's text, newlines included. */
function textOffset(doc: Node, pos: number) {
  let out = 0
  doc.forEach((n, at) => {
    const len = n.type === rule ? (n.attrs.text as string).length : n.textContent.length
    if (at + n.nodeSize <= pos) out += len + 1
    else if (at <= pos && pos <= at + n.nodeSize) out += Math.max(0, Math.min(pos - at - 1, len))
  })
  return out
}

/** The position for a character offset in the note's text. */
function posOfTextOffset(doc: Node, offset: number) {
  let left = offset
  let out = -1
  doc.forEach((n, at) => {
    if (out >= 0) return
    const len = n.type === rule ? (n.attrs.text as string).length : n.textContent.length
    if (left <= len) out = n.type === rule ? at : at + 1 + left
    else left -= len + 1
  })
  return out >= 0 ? out : doc.content.size
}

/** Typing `**word**` (and the like) makes the word bold and leaves the marks out, as Notion does. */
const markRule = (re: RegExp, type: MarkType) =>
  new InputRule(re, (state, match, start, end) => {
    const from = start + match[1].length
    const marks = state.doc.resolve(from).marks().filter((m) => m.type !== type)
    return state.tr.replaceWith(from, end, schema.text(match[2], [...marks, type.create()])).removeStoredMark(type)
  })
const word = (d: string) => `([^${d}\\s](?:[^${d}]*[^${d}\\s])?)`
const rules = inputRules({
  rules: [
    markRule(new RegExp(`(^|[^*])\\*\\*${word('*')}\\*\\*$`), b),
    markRule(new RegExp(`(^|[^*\\p{L}\\p{N}])\\*${word('*')}\\*$`, 'u'), i),
    markRule(new RegExp(`(^|[^_])__${word('_')}__$`), u),
    markRule(new RegExp(`(^|[^_\\p{L}\\p{N}])_${word('_')}_$`, 'u'), i),
  ],
})

/** `---` then Enter: the dashes become a section line, and writing goes on below it. */
const sectionLine: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  const text = $from.parent.textContent
  if (!empty || $from.parent.type !== paragraph || !/^-{3,}$/.test(text) || $from.parentOffset !== text.length) return false
  if (dispatch) {
    const start = $from.before()
    const tr = state.tr.replaceWith(start, $from.after(), [rule.create({ text }), paragraph.create()])
    dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 2)).scrollIntoView())
  }
  return true
}

/** Text from outside: its lines as paragraphs, with formatting marks read unless pasted as plain text. */
function pastedText(text: string, plain: boolean) {
  const t = text.replace(/\r\n?/g, '\n')
  const doc = plain ? schema.nodes.doc.create(null, t.split('\n').map((l) => paragraph.create(null, l ? schema.text(l) : null))) : toDoc(t)
  const open = (n: Node | null) => (n?.type === paragraph ? 1 : 0)
  return new Slice(doc.content, open(doc.firstChild), open(doc.lastChild))
}

/**
 * Pasted HTML with its inline formatting turned into tags. The page's security policy blocks style
 * attributes, so they are renamed before anything parses them; style sheets are dropped.
 * ProseMirror reads what this returns.
 */
function pastedHTML(html: string) {
  // Even parsing alone would fetch images and try handlers, so those attributes are renamed first too.
  const safe = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) => tag.replace(/\s(on[a-z]+|src|srcset|href|action|formaction|poster|background|style)\s*=/gi, (_, a: string) => ` data-${a.toLowerCase()}=`))
  const doc = new DOMParser().parseFromString(safe, 'text/html')
  for (let el of [...doc.body.querySelectorAll('[data-style]')]) {
    const css = el.getAttribute('data-style')!.toLowerCase()
    el.removeAttribute('data-style')
    const weight = /font-weight\s*:\s*(\w+)/.exec(css)?.[1] ?? ''
    // Google Docs wraps whole pastes in <b style="font-weight:normal">.
    if (el.tagName === 'B' && /^(normal|lighter|[1-5]00)$/.test(weight)) {
      const span = doc.createElement('span')
      span.append(...el.childNodes)
      el.replaceWith(span)
      el = span
    }
    const tags = [/^(bold(er)?|[6-9]00)$/.test(weight) && 'strong', /font-style\s*:\s*italic/.test(css) && 'em', /text-decoration[^;]*underline/.test(css) && 'u']
    for (const t of tags) {
      if (!t) continue
      const wrap = doc.createElement(t)
      wrap.append(...el.childNodes)
      el.append(wrap)
    }
  }
  // Only text and its structure go on: nothing that loads, runs or carries attributes.
  for (const el of [...doc.body.querySelectorAll('script, style, link, meta, template, noscript, img, picture, svg, math, video, audio, iframe, object, embed, canvas, form, input, button, select, textarea')]) el.remove()
  for (const el of [...doc.body.querySelectorAll('*')]) for (const a of [...el.attributes]) el.removeAttribute(a.name)
  // A line break starts a new line here too.
  return doc.body.innerHTML.replace(/<br\s*\/?>/gi, '</p><p>')
}

/**
 * A note with real bold, italic, underline and section lines, kept as plain text with marks (see
 * format.ts). Changes from elsewhere are patched in where they happened, so the cursor stays put.
 */
export default function NoteEditor({ value, onChange, ariaLabel, className = '' }: NoteProps) {
  const host = useRef<HTMLDivElement>(null)
  // The text the notebook holds, which the editor shows as soon as it can; and the text the editor
  // shows.
  const target = useRef(value)
  const shown = useRef(value)
  const catchUp = useRef(() => {})
  const change = useRef(onChange)
  change.current = onChange

  useEffect(() => {
    let timer = 0
    // Replace only what differs, so the cursor stays where it was; never under a word an input method
    // is still composing.
    const sync = () => {
      window.clearTimeout(timer)
      if (shown.current === target.current) return
      if (v.composing) return void (timer = window.setTimeout(sync, 80))
      const next = toDoc(target.current)
      const cur = v.state.doc
      shown.current = target.current
      const start = cur.content.findDiffStart(next.content)
      if (start === null) return
      const end = cur.content.findDiffEnd(next.content)!
      const overlap = start - Math.min(end.a, end.b)
      if (overlap > 0) {
        end.a += overlap
        end.b += overlap
      }
      const tr = v.state.tr.replace(start, end.a, next.slice(start, end.b))
      v.dispatch(tr.setMeta('remote', true).setMeta('addToHistory', false))
    }
    const v: EditorView = new EditorView(
      { mount: host.current! },
      {
        state: EditorState.create({
          doc: toDoc(shown.current),
          plugins: [
            rules,
            history(),
            keymap({ 'Mod-b': toggleMark(b), 'Mod-i': toggleMark(i), 'Mod-u': toggleMark(u), 'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo, Backspace: undoInputRule, Enter: sectionLine }),
            keymap(baseKeymap),
          ],
        }),
        attributes: { class: `write ink ${className} note-editor`, role: 'textbox', 'aria-multiline': 'true', 'aria-label': ariaLabel, spellcheck: 'false' },
        dispatchTransaction(tr) {
          const prev = v.state.doc
          let state = v.state.apply(tr)
          if (tr.docChanged && !tr.getMeta('remote')) {
            carry(prev, state.doc)
            // The editor shows exactly what the stored text reads back as: formatting the text
            // cannot hold is dropped, and text it cannot hold is shown as it reads back.
            let text = toText(state.doc)
            const back = toDoc(text)
            if (back.textContent !== state.doc.textContent) {
              const at = textOffset(state.doc, state.selection.head)
              const fix = state.tr.replaceWith(0, state.doc.content.size, back.content)
              fix.setSelection(TextSelection.near(fix.doc.resolve(posOfTextOffset(fix.doc, at))))
              fix.setMeta('addToHistory', false)
              state = state.apply(fix)
              text = toText(state.doc)
            } else {
              const fixes = markFixes(state.doc, back)
              if (fixes?.length) {
                const fix = state.tr
                for (const f of fixes) f.on ? fix.addMark(f.from, f.to, f.mark) : fix.removeMark(f.from, f.to, f.mark)
                fix.setMeta('addToHistory', false)
                state = state.apply(fix)
                text = toText(state.doc)
              }
            }
            v.updateState(state)
            const before = shown.current
            if (text === before) return
            shown.current = text
            // A change from elsewhere still waiting to be shown is kept in what is saved.
            const merged = target.current === before ? text : merge3(before, text, target.current)
            target.current = merged
            change.current(merged)
            if (merged !== text) sync()
            return
          }
          v.updateState(state)
        },
        clipboardTextSerializer: (slice) => slice.content.textBetween(0, slice.content.size, '\n'),
        clipboardTextParser: (text, _$context, plain) => pastedText(text, plain),
        transformPastedHTML: pastedHTML,
      },
    )
    catchUp.current = sync
    return () => {
      window.clearTimeout(timer)
      v.destroy()
    }
    // The editor is made once; a different note gets its own editor (see the key where it is used).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Text that changed elsewhere (another tab, another device). The notebook catching up with what
  // the editor already holds is not a change; any other text is, even if the editor wrote it before.
  useEffect(() => {
    if (value === target.current) return
    target.current = value
    catchUp.current()
  }, [value])

  return <div ref={host} />
}
