import { useEffect, useRef, useState } from 'react'
import { addDays, fmtShort } from '../lib/date'
import { editSpans, validDayKey, type Span } from '../lib/store'
import { DateChip } from './DatePicker'
import { inPopover } from './Popover'
import { Write } from './ui'

/** Height of one line of span notes at the foot of a calendar cell. */
export const LANE = 19

export interface Placed {
  span: Span
  lane: number
}

/**
 * Give each span that touches [first, last] a lane, so overlapping lines sit one above another and
 * a line keeps its lane for its whole length.
 */
export function placeSpans(spans: Span[], first: string, last: string): Placed[] {
  const shown = spans
    .filter((s) => s.end >= first && s.start <= last)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.id.localeCompare(b.id))
  const ends: string[] = []
  return shown.map((span) => {
    let lane = ends.findIndex((e) => e < span.start)
    if (lane === -1) lane = ends.length
    ends[lane] = span.end
    return { span, lane }
  })
}

export const rangeLabel = (s: Pick<Span, 'start' | 'end'>) => (s.start === s.end ? fmtShort(s.start) : `${fmtShort(s.start)} – ${fmtShort(s.end)}`)

/** Change a span's days. Ends given the wrong way round are swapped; its words stay inside the range. */
export function setSpanRange(id: string, start: string, end: string) {
  if (!validDayKey(start) || !validDayKey(end)) return
  if (start > end) [start, end] = [end, start]
  editSpans((f) => {
    const s = f.spans.find((x) => x.id === id)
    if (!s) return
    s.start = start
    s.end = end
    if (s.at < start) s.at = start
    if (s.at > end) s.at = end
  })
}

/** The small editor for one span: its words, from and to, remove. */
export function SpanEditor({ span, alignRight, onClose }: { span: Span; alignRight: boolean; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [confirm, setConfirm] = useState(false)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !inPopover(e.target)) close.current()
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [])

  return (
    <div
      ref={box}
      className={`span-pop ${alignRight ? 'align-right' : ''}`}
      role="dialog"
      aria-label={`Note for ${rangeLabel(span)}`}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close.current()
        }
      }}
    >
      <Write
        value={span.text}
        onChange={(v) => editSpans((f) => void (f.spans.find((x) => x.id === span.id)!.text = v))}
        singleLine
        autoFocus
        ariaLabel="Note for these days"
        placeholder="What are these days for?"
        className="span-text"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            close.current()
          }
        }}
      />
      <div className="span-dates">
        <DateChip value={span.start} onChange={(d) => d && setSpanRange(span.id, d, span.end)} label="From" clearable={false} range={[span.start, span.end]} className="span-date" />
        <span className="muted">→</span>
        <DateChip value={span.end} onChange={(d) => d && setSpanRange(span.id, span.start, d)} label="To" clearable={false} range={[span.start, span.end]} className="span-date" />
        <span className="span-days muted small">{days(span.start, span.end)}</span>
        {confirm ? (
          <span className="remove-confirm">
            <button className="text-btn" onClick={() => editSpans((f) => void (f.spans = f.spans.filter((x) => x.id !== span.id)))}>
              Remove
            </button>
            <button className="text-btn" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="span-x" aria-label="Remove this line" title="Remove this line" onClick={() => setConfirm(true)}>
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

function days(start: string, end: string) {
  if (!validDayKey(start) || !validDayKey(end)) return ''
  const [a, b] = start <= end ? [start, end] : [end, start]
  let n = 1
  for (let d = a; d < b && n < 1000; d = addDays(d, 1)) n++
  return n === 1 ? '1 day' : `${n} days`
}
