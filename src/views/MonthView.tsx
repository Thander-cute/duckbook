import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { LANE, SpanEditor, placeSpans, rangeLabel } from '../components/Spans'
import { Check, Label, Page, Spread, Write } from '../components/ui'
import { MONTHS_SHORT, WEEKDAYS, addDays, daysInMonth, fmtShort, isoWeek, monthGrid, monthKeyOf, pad, todayKey, weekStart } from '../lib/date'
import { go, href } from '../lib/router'
import { editMonth, editSpans, uid, useMonth, useSpans, useStore } from '../lib/store'

const MOODS = [1, 2, 3, 4, 5]

/** Where a line starts in the cycle of three hand-drawn strokes; stable per line. */
const pen = (id: string) => [...id].reduce((h, c) => h + c.charCodeAt(0), 0) % 3

/** The calendar day under the pointer, if any. A line's words run over neighbouring days, so look past them. */
const dayAt = (x: number, y: number) =>
  document
    .elementsFromPoint(x, y)
    .find((el) => !el.closest('.span-label, .span-pop'))
    ?.closest<HTMLElement>('[data-day]')?.dataset.day ?? null

/** A press on a day number: a click opens the day, a drag draws a line to another day. */
interface Draw {
  from: string
  to: string
  pointerId: number
  x: number
  y: number
  active: boolean
}

/** A press on a line's words: a click opens its editor, a drag slides the words along the line. */
interface Slide {
  id: string
  at: string
  pointerId: number
  x: number
  y: number
  active: boolean
}

export function MonthView({ date }: { date: string }) {
  const mk = monthKeyOf(date)
  const month = useMonth(mk)
  const rows = monthGrid(mk)
  const [year, mon] = mk.split('-').map(Number)
  const today = todayKey()
  const first = `${mk}-01`
  const last = `${mk}-${pad(daysInMonth(mk))}`
  const placed = placeSpans(useSpans(), first, last)
  const [open, setOpen] = useState<string | null>(null)
  const [draw, setDrawState] = useState<Draw | null>(null)
  const [slide, setSlideState] = useState<Slide | null>(null)
  // The live gesture, read by the window listeners; state only drives the drawing.
  const live = useRef<{ draw: Draw | null; slide: Slide | null; placed: typeof placed }>({ draw: null, slide: null, placed })
  live.current.placed = placed
  const setDraw = (d: Draw | null) => setDrawState((live.current.draw = d))
  const setSlide = (s: Slide | null) => setSlideState((live.current.slide = s))
  const swallowClick = useRef(false)

  // Lines in a week row reserve room at the foot of every cell in that row, so the rows line up.
  const rowLanes = rows.map((r) => {
    const days = r.filter(Boolean) as string[]
    return Math.max(0, ...placed.filter((p) => p.span.start <= days[days.length - 1] && p.span.end >= days[0]).map((p) => p.lane + 1))
  })

  const gesturing = !!draw || !!slide
  useEffect(() => {
    if (!gesturing) return
    const move = (e: PointerEvent) => {
      const { draw, slide, placed } = live.current
      const g = draw ?? slide
      if (!g) return
      if (e.pointerId !== g.pointerId) return
      const active = g.active || Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4
      if (!active) return
      const day = dayAt(e.clientX, e.clientY)
      if (draw) setDraw({ ...draw, active, to: day && day >= first && day <= last ? day : draw.to })
      else {
        const s = placed.find((p) => p.span.id === slide!.id)?.span
        const ok = s && day && day >= s.start && day <= s.end && day >= first && day <= last
        setSlide({ ...slide!, active, at: ok ? day : slide!.at })
      }
    }
    const up = (e: PointerEvent) => {
      const { draw, slide } = live.current
      const g = draw ?? slide
      if (!g) return
      if (e.pointerId !== g.pointerId) return
      if (draw) {
        swallowClick.current = draw.active
        if (draw.active && draw.to !== draw.from) {
          const [start, end] = draw.from < draw.to ? [draw.from, draw.to] : [draw.to, draw.from]
          const id = uid()
          editSpans((f) => void f.spans.push({ id, start, end, text: '', at: start }))
          setOpen(id)
        }
        setDraw(null)
      } else {
        const s = slide!
        if (!s.active) setOpen(s.id)
        else editSpans((f) => {
          const x = f.spans.find((y) => y.id === s.id)
          if (x) x.at = s.at
        })
        setSlide(null)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [gesturing, first, last])

  const drawing = draw?.active ? (draw.from < draw.to ? [draw.from, draw.to] : [draw.to, draw.from]) : null

  const cell = (key: string | null, i: number) => {
    if (!key) return <div key={`empty-${i}`} className="cal-cell is-empty" />
    const ri = Math.floor(i / 7)
    const ci = i % 7
    const sideEnd = ci < 3 ? 2 : 6
    const here = placed.filter((p) => p.span.start <= key && p.span.end >= key)
    return (
      <div
        key={key}
        data-day={key}
        className={`cal-cell ${key === today ? 'is-today' : ''} ${drawing && key >= drawing[0] && key <= drawing[1] ? 'is-drawing' : ''}`}
        style={rowLanes[ri] ? { paddingBottom: 10 + rowLanes[ri] * LANE } : undefined}
      >
        <a
          className="cal-num"
          href={href('day', key)}
          title={`Open ${fmtShort(key)} · drag to another day to note a stretch of days`}
          onPointerDown={(e: ReactPointerEvent) => {
            if (e.button !== 0) return
            e.preventDefault()
            setDraw({ from: key, to: key, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false })
          }}
          onClick={(e) => {
            if (swallowClick.current) e.preventDefault()
            swallowClick.current = false
          }}
          draggable={false}
        >
          {Number(key.slice(8))}
        </a>
        <Write value={month.cells[key] ?? ''} onChange={(v) => editMonth(mk, (m) => void (m.cells[key] = v))} ariaLabel={`Notes for ${fmtShort(key)}`} />
        {here.map(({ span, lane }) => {
          const at = slide?.id === span.id ? slide.at : span.at
          const anchor = at < first ? first : at > last ? last : at
          const isOpen = open === span.id
          // The words may run along the line to the end of this row on this page.
          let room = 1
          for (let d = addDays(key, 1), c = ci + 1; c <= sideEnd && d <= span.end && d <= last; d = addDays(d, 1), c++) room++
          return (
            <div key={span.id} className="span-bit" style={{ bottom: 9 + lane * LANE }}>
              <div
                className={`span-seg hand-${(pen(span.id) + Number(key.slice(8))) % 3} ${key === span.start ? 'is-start' : ''} ${key === span.end ? 'is-end' : ''} ${isOpen ? 'is-open' : ''}`}
                onClick={() => setOpen(span.id)}
                title={`${rangeLabel(span)}${span.text ? `: ${span.text}` : ''}`}
              />
              {key === anchor && (
                <button
                  className={`span-label ${span.text ? '' : 'is-empty'} ${slide?.id === span.id && slide.active ? 'is-sliding' : ''}`}
                  style={{ maxWidth: `calc(${room * 100}% + ${room - 1}px - 14px)` }}
                  aria-label={`Note for ${rangeLabel(span)}: ${span.text || 'empty'}. Open`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    e.stopPropagation()
                    setSlide({ id: span.id, at: anchor, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setOpen(span.id)
                    }
                  }}
                >
                  {span.text || '+ note'}
                </button>
              )}
              {key !== anchor && span.text && (key === span.start || key === first || ci === 0 || ci === 3) && !(anchor >= key && anchor <= addDays(key, room - 1)) && (
                <button className="span-label is-echo" style={{ maxWidth: `calc(${room * 100}% + ${room - 1}px - 14px)` }} tabIndex={-1} aria-hidden onClick={() => setOpen(span.id)}>
                  {span.text}
                </button>
              )}
              {key === anchor && isOpen &&<SpanEditor span={span} alignRight={ci >= 5 || ci === 2} onClose={() => setOpen(null)} />}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Spread className="month-spread">
      <Page side="left" className="month-left">
        <div className="month-head">
          <div className="month-picker" aria-label="Choose month">
            <span className="picker-year">{year}</span>
            {MONTHS_SHORT.map((m, i) => (
              <button
                key={m}
                className={`picker-m ${i + 1 === mon ? 'is-on' : ''}`}
                onClick={() => go('month', `${year}-${pad(i + 1)}-01`)}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="theme">
            <div className="line-label">This month will be:</div>
            <Write className="theme-input" value={month.theme} onChange={(v) => editMonth(mk, (m) => void (m.theme = v))} singleLine ariaLabel="Theme of the month" placeholder="a word, a feeling, a direction" />
          </div>
        </div>

        <div className="month-body">
          <MoodTracker mk={mk} />
          <div className="cal cal-3">
            {WEEKDAYS.slice(0, 3).map((w) => (
              <div key={w} className="cal-wd">
                {w}
              </div>
            ))}
            {rows.flatMap((r, ri) => r.slice(0, 3).map((k, ci) => cell(k, ri * 7 + ci)))}
          </div>
        </div>

        <Label>Notes</Label>
        <Write className="dotgrid notes month-notes" value={month.notes} onChange={(v) => editMonth(mk, (m) => void (m.notes = v))} rows={4} ariaLabel="Month notes" />
      </Page>

      <Page side="right" className="month-right">
        <div className="month-head">
          <div className="goals">
            <div className="goals-label">
              <span className="caps-word">GOALS</span>
              <em>of the month:</em>
            </div>
            <ol>
              {month.goals.map((g, i) => (
                <li key={i} className={g.done ? 'is-done' : ''}>
                  <span className="goal-n">{i + 1}</span>
                  <Write value={g.text} onChange={(v) => editMonth(mk, (m) => void (m.goals[i].text = v))} singleLine ariaLabel={`Goal ${i + 1}`} />
                  <Check checked={g.done} onChange={(v) => editMonth(mk, (m) => void (m.goals[i].done = v))} label={`Goal ${i + 1} done`} />
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="month-body">
          <div className="cal cal-4">
            {WEEKDAYS.slice(3).map((w) => (
              <div key={w} className="cal-wd">
                {w}
              </div>
            ))}
            {rows.flatMap((r, ri) => r.slice(3).map((k, ci) => cell(k, ri * 7 + ci + 3)))}
          </div>
        </div>

        <WeeksOfMonth rows={rows} />
      </Page>
    </Spread>
  )
}

function MoodTracker({ mk }: { mk: string }) {
  const month = useMonth(mk)
  const n = daysInMonth(mk)
  const today = todayKey()
  return (
    <div className="mood" aria-label="Mood tracker">
      <div className="mood-head">
        <em>mood</em>
        <span className="mood-scale" aria-hidden>
          <span>low</span>
          <span>high</span>
        </span>
      </div>
      <div className="mood-rows">
        {Array.from({ length: n }, (_, i) => {
          const key = `${mk}-${pad(i + 1)}`
          const v = month.moods[key]
          return (
            <div key={key} className={`mood-row ${key === today ? 'is-today' : ''}`}>
              <span className="mood-d">{i + 1}</span>
              {MOODS.map((m) => (
                <button
                  key={m}
                  className={`mood-dot ${v === m ? 'is-on' : ''}`}
                  aria-label={`Day ${i + 1} mood ${m} of 5`}
                  onClick={() => editMonth(mk, (d) => void (v === m ? delete d.moods[key] : (d.moods[key] = m)))}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeeksOfMonth({ rows }: { rows: (string | null)[][] }) {
  const weeks = useStore((s) => s.weeks)
  const mondays = rows.map((r) => weekStart(r.find(Boolean)!))
  return (
    <div className="weeks-of-month">
      <Label>Weeks</Label>
      <ul>
        {mondays.map((m) => (
          <li key={m}>
            <a href={href('week', m)}>
              <span className="wk-n">W{isoWeek(m)}</span>
              <span className="wk-range muted">
                {fmtShort(m)} – {fmtShort(addDays(m, 6))}
              </span>
              <span className="ink wk-goal">{weeks[m]?.goal || <span className="muted">no goal yet</span>}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
