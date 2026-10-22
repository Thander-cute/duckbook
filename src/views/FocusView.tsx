import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { PageTitle, Write } from '../components/ui'
import { DateField } from '../components/WorkMeta'
import { fmtShort, isoWeek, weekStart } from '../lib/date'
import { href } from '../lib/router'
import { editFocus, editWork, planIdea, plannedWeeks, uid, useFocus, useStore, type Idea, type IdeaStatus } from '../lib/store'

// ───────── which idea is selected (shared so a week or day task can open its idea) ─────────

let selected: string | null = null
const selListeners = new Set<() => void>()
export function selectIdea(id: string | null) {
  selected = id
  selListeners.forEach((l) => l())
}
const useSelected = () =>
  useSyncExternalStore(
    (l) => {
      selListeners.add(l)
      return () => void selListeners.delete(l)
    },
    () => selected,
  )

// ───────── zones: left = hard, right = easy; top = high impact, bottom = low ─────────

const ZONES = [
  { key: 'big', name: 'Big bets', hint: 'High impact, hard', x: 0.25, y: 0.75 },
  { key: 'quick', name: 'Quick wins', hint: 'High impact, easy', x: 0.75, y: 0.75 },
  { key: 'letgo', name: 'Let go', hint: 'Low impact, hard', x: 0.25, y: 0.25 },
  { key: 'fill', name: 'Fill-ins', hint: 'Low impact, easy', x: 0.75, y: 0.25 },
] as const

export const zoneOf = (i: Pick<Idea, 'x' | 'y'>) => {
  if (i.x === null || i.y === null) return null
  return ZONES.find((z) => (z.x > 0.5) === (i.x! >= 0.5) && (z.y > 0.5) === (i.y! >= 0.5))!
}

const STATES: Record<IdeaStatus, { label: string }> = {
  idea: { label: 'Idea' },
  doing: { label: 'In progress' },
  done: { label: 'Completed' },
}

type Filter = 'open' | 'doing' | 'done' | 'all'
const FILTERS: { key: Filter; label: string; test: (i: Idea) => boolean }[] = [
  { key: 'open', label: 'Open', test: (i) => i.status !== 'done' },
  { key: 'doing', label: 'In progress', test: (i) => i.status === 'doing' },
  { key: 'done', label: 'Completed', test: (i) => i.status === 'done' },
  { key: 'all', label: 'All', test: () => true },
]

const clamp01 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000

function setPos(id: string, x: number | null, y: number | null) {
  editFocus((f) => {
    const it = f.ideas.find((i) => i.id === id)
    if (!it) return
    it.x = x === null ? null : clamp01(x)
    it.y = y === null ? null : clamp01(y)
  })
}

/** A small stable tilt per note, so the board looks hand-arranged. */
const tilt = (id: string) => {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0
  return ((Math.abs(h) % 7) - 3) * 0.45
}

const weekLabel = (monday: string) => `Wk ${isoWeek(monday)}`

// ───────── dragging whole notes ─────────

interface Drag {
  id: string
  pointerId: number
  startX: number
  startY: number
  offX: number
  offY: number
  width: number
  height: number
  left: number
  top: number
  active: boolean
  over: 'canvas' | 'tray' | null
}

export function FocusView({ date }: { date: string }) {
  const focus = useFocus()
  const sel = useSelected()
  const [filter, setFilter] = useState<Filter>('all')
  const [draft, setDraft] = useState('')
  const [drag, setDragState] = useState<Drag | null>(null)
  // The live drag, read by the window listeners; state only drives the drawing.
  const live = useRef<Drag | null>(null)
  const setDrag = (d: Drag | null) => setDragState((live.current = d))
  const canvas = useRef<HTMLDivElement>(null)
  const tray = useRef<HTMLDivElement>(null)
  const viewWeek = weekStart(date)

  const shown = focus.ideas.filter(FILTERS.find((f) => f.key === filter)!.test)
  const placed = shown.filter((i) => i.x !== null && i.y !== null)
  const loose = shown.filter((i) => i.x === null || i.y === null)

  const add = () => {
    const text = draft.trim()
    if (!text) return
    const id = uid()
    editFocus((f) => void f.ideas.push({ id, text, x: null, y: null, status: 'idea', date: null, createdAt: new Date().toISOString() }))
    setDraft('')
    selectIdea(id)
    if (filter === 'done') setFilter('all')
  }

  // Bring a note opened from Week or Day into view.
  useEffect(() => {
    if (!sel) return
    const el = document.querySelector<HTMLElement>(`[data-note="${sel}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [sel])

  const startDrag = (idea: Idea, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('textarea, input, select, button, a')) return
    // No text selection sweeping across other notes while dragging; focus the note by hand instead.
    e.preventDefault()
    e.currentTarget.focus({ preventScroll: true })
    const r = e.currentTarget.getBoundingClientRect()
    selectIdea(idea.id)
    setDrag({ id: idea.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, width: r.width, height: r.height, left: r.left, top: r.top, active: false, over: null })
  }

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const hit = (el: HTMLElement | null, x: number, y: number) => {
      const r = el?.getBoundingClientRect()
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }
    const move = (e: PointerEvent) => {
      const drag = live.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const active = drag.active || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4
      if (!active) return
      e.preventDefault()
      const over = hit(tray.current, e.clientX, e.clientY) ? 'tray' : hit(canvas.current, e.clientX, e.clientY) ? 'canvas' : null
      setDrag({ ...drag, active, over, left: e.clientX - drag.offX, top: e.clientY - drag.offY })
    }
    const up = (e: PointerEvent) => {
      const drag = live.current
      if (!drag || e.pointerId !== drag.pointerId) return
      if (drag.active && drag.over === 'canvas' && canvas.current) {
        const r = canvas.current.getBoundingClientRect()
        // The note's center lands where it was let go.
        const cx = drag.left + drag.width / 2
        const cy = drag.top + drag.height / 2
        setPos(drag.id, (cx - r.left) / r.width, 1 - (cy - r.top) / r.height)
      } else if (drag.active && drag.over === 'tray') setPos(drag.id, null, null)
      setDrag(null)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging])

  const lifted = drag?.active ? focus.ideas.find((i) => i.id === drag.id) : undefined

  const note = (idea: Idea, where: 'canvas' | 'tray') => (
    <Note
      key={idea.id}
      idea={idea}
      where={where}
      selected={idea.id === sel}
      ghost={drag?.active === true && drag.id === idea.id}
      viewWeek={viewWeek}
      onPointerDown={(e) => startDrag(idea, e)}
    />
  )

  return (
    <section className="sheet focus-sheet">
      <header className="focus-head">
        <div>
          <PageTitle caps="FOCUS" italic="map" />
          <p className="page-sub">Place each idea by how much it matters and how hard it is.</p>
        </div>
        <div className="filters" role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.key} role="radio" aria-checked={filter === f.key} className={`filter ${filter === f.key ? 'is-on' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label} <span className="count">{focus.ideas.filter(f.test).length}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="focus-board">
        <aside ref={tray} className={`tray ${drag?.active && drag.over === 'tray' ? 'is-over' : ''}`} aria-label="Unplaced ideas">
          <div className="pad">
            <Write
              value={draft}
              onChange={setDraft}
              placeholder="Write an idea…"
              singleLine
              ariaLabel="New idea"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
            />
          </div>
          <p className="pad-hint">Enter to tear it off</p>
          <div className="tray-label">
            Tray <span>{loose.length ? 'drag onto the map' : ''}</span>
          </div>
          <div className="tray-notes">{loose.map((i) => note(i, 'tray'))}</div>
          {!loose.length && <p className="muted small tray-empty">Drag a note here to take it off the map.</p>}
        </aside>

        <div className="canvas-wrap">
          <span className="map-axis axis-top">High impact</span>
          <span className="map-axis axis-bottom">Low impact</span>
          <span className="map-axis axis-left">Hard</span>
          <span className="map-axis axis-right">Easy</span>
          <div
            ref={canvas}
            className={`canvas ${drag?.active && drag.over === 'canvas' ? 'is-over' : ''}`}
            aria-label="Impact and difficulty map"
            onPointerDown={(e) => e.target === e.currentTarget && selectIdea(null)}
          >
            {ZONES.map((z) => (
              <span key={z.key} className={`zone-label zone-${z.key}`}>
                {z.name}
              </span>
            ))}
            {placed.map((i) => note(i, 'canvas'))}
          </div>
        </div>
      </div>

      {lifted &&
        createPortal(
          <div className={`note lifted state-${lifted.status}`} style={{ left: drag!.left, top: drag!.top, width: drag!.width, minHeight: drag!.height }} aria-hidden>
            <div className="note-head" />
            <div className="note-text-static">{lifted.text}</div>
          </div>,
          document.body,
        )}
    </section>
  )
}

function Note({
  idea,
  where,
  selected,
  ghost,
  viewWeek,
  onPointerDown,
}: {
  idea: Idea
  where: 'canvas' | 'tray'
  selected: boolean
  ghost: boolean
  viewWeek: string
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const weeks = useStore((s) => s.weeks)
  const planned = plannedWeeks({ weeks } as Parameters<typeof plannedWeeks>[0], idea.id)
  const [editingDate, setEditingDate] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const target = idea.date ? weekStart(idea.date) : viewWeek
  const z = zoneOf(idea)
  const st = STATES[idea.status]

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const step = e.shiftKey ? 0.01 : 0.04
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (e.key === 'Escape') {
      e.stopPropagation()
      selectIdea(null)
      return e.currentTarget.blur()
    }
    if (!d) return
    // Arrows move the note; they must not also flip the week in the top bar.
    e.preventDefault()
    e.stopPropagation()
    setPos(idea.id, (idea.x ?? 0.5) + d[0], (idea.y ?? 0.5) + d[1])
  }

  const nextState = idea.status === 'idea' ? { to: 'doing' as const, label: 'Start' } : idea.status === 'doing' ? { to: 'done' as const, label: 'Complete' } : { to: 'doing' as const, label: 'Reopen' }
  const plannedIn = planned.length ? planned[planned.length - 1] : null
  // Near the top of the map the bar would cover the header, so it sits below the note there.
  const below = where === 'canvas' && idea.y! > 0.82

  return (
    <div
      data-note={idea.id}
      className={`note state-${idea.status} in-${where} ${selected ? 'is-selected' : ''} ${ghost ? 'is-ghost' : ''}`}
      style={{ ...(where === 'canvas' ? { left: `${idea.x! * 100}%`, top: `${(1 - idea.y!) * 100}%` } : {}), ['--tilt' as string]: `${tilt(idea.id)}deg` }}
      tabIndex={0}
      role="group"
      aria-label={`${idea.text || 'Untitled idea'}. ${st.label}${z ? `, ${z.name}` : ', in the tray'}. Arrow keys move it.`}
      onPointerDown={onPointerDown}
      onFocus={() => selectIdea(idea.id)}
      onKeyDown={onKey}
    >
      <div className="note-head" aria-hidden title="Drag to move" />
      {idea.status === 'done' && (
        <span className="stamp" aria-hidden>
          ✓
        </span>
      )}
      <Write value={idea.text} onChange={(v) => editWork(idea.id, { text: v })} ariaLabel="Idea" className="note-text" />

      {(idea.status !== 'idea' || idea.date || plannedIn) && (
        <div className="note-meta" aria-hidden>
          <span>{idea.status === 'doing' ? '◐ in progress' : idea.status === 'done' ? 'done' : ''}</span>
          <span>
            {idea.date && fmtShort(idea.date)}
            {plannedIn && <span className="note-wk">{weekLabel(plannedIn)}</span>}
          </span>
        </div>
      )}

      <div className={`note-bar ${below ? 'is-below' : ''}`} role="toolbar" aria-label="Idea actions">
        <button className="note-act" onClick={() => editWork(idea.id, { status: nextState.to })}>
          {nextState.label}
        </button>
        <span className="bar-sep" />
        {editingDate ? (
          <DateField value={idea.date} onCommit={(date) => editWork(idea.id, { date })} onDone={() => setEditingDate(false)} />
        ) : (
          <button className={`date-chip ${idea.date ? 'has-date' : ''}`} onClick={() => setEditingDate(true)} aria-label={idea.date ? `Planned ${fmtShort(idea.date)}, change` : 'Set a planned date'}>
            {idea.date ? fmtShort(idea.date) : '+ date'}
          </button>
        )}
        {planned.includes(target) ? (
          <a className="note-act is-planned" href={href('week', target)} title="Planned in this week">
            {weekLabel(target)} ↗
          </a>
        ) : (
          <button className="note-act" disabled={!idea.text.trim()} onClick={() => planIdea(idea.id, target)} title={planned.length ? `Planned in ${planned.map(weekLabel).join(', ')}` : undefined}>
            {planned.length ? `Move to ${weekLabel(target)}` : `Plan · ${weekLabel(target)}`}
          </button>
        )}
        <span className="bar-sep" />
        <select
          className="place-select"
          aria-label="Place"
          value={z ? z.key : where === 'tray' ? 'tray' : ''}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'tray') return setPos(idea.id, null, null)
            const zone = ZONES.find((x) => x.key === v)
            if (zone) setPos(idea.id, zone.x, zone.y)
          }}
        >
          <option value="tray">Tray</option>
          {ZONES.map((zone) => (
            <option key={zone.key} value={zone.key}>
              {zone.name}
            </option>
          ))}
        </select>
        {confirmRemove ? (
          <span className="remove-confirm">
            <button
              className="note-act"
              onClick={() => {
                editFocus((f) => void (f.ideas = f.ideas.filter((i) => i.id !== idea.id)))
                selectIdea(null)
              }}
            >
              Remove
            </button>
            <button className="note-act" onClick={() => setConfirmRemove(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="note-x" aria-label="Remove idea" title="Remove idea (planned tasks stay in their weeks)" onClick={() => setConfirmRemove(true)}>
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
