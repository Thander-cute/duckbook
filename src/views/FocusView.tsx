import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { Label, Page, PageTitle, Spread, Write } from '../components/ui'
import { addDays, fmtShort, isoWeek, weekStart } from '../lib/date'
import { href } from '../lib/router'
import { editFocus, editWeek, uid, useFocus, useStore, type Idea } from '../lib/store'

// ───────── which idea is selected (shared so a week task can open its idea) ─────────

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

const clamp01 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000

function setPos(id: string, x: number | null, y: number | null) {
  editFocus((f) => {
    const it = f.ideas.find((i) => i.id === id)
    if (!it) return
    it.x = x === null ? null : clamp01(x)
    it.y = y === null ? null : clamp01(y)
  })
}

/** Weeks (Monday keys) that already hold a task made from each idea. */
function useIdeaWeeks() {
  return useStore((s) => s.weeks)
}

const weeksFor = (weeks: ReturnType<typeof useIdeaWeeks>, ideaId: string) =>
  Object.keys(weeks)
    .filter((k) => weeks[k].tasks.some((t) => t.ideaId === ideaId))
    .sort()

const weekName = (monday: string) => `Week ${isoWeek(monday)} · ${fmtShort(monday)} – ${fmtShort(addDays(monday, 6))}`

export function FocusView({ date }: { date: string }) {
  const focus = useFocus()
  const weeks = useIdeaWeeks()
  const sel = useSelected()
  const [draft, setDraft] = useState('')
  const monday = weekStart(date)
  const current = focus.ideas.find((i) => i.id === sel) ?? null

  const add = () => {
    const text = draft.trim()
    if (!text) return
    const id = uid()
    editFocus((f) => void f.ideas.push({ id, text, x: null, y: null, createdAt: new Date().toISOString() }))
    setDraft('')
    selectIdea(id)
  }

  return (
    <Spread>
      <Page side="left" className="focus-list">
        <PageTitle caps="FOCUS" italic="map" />
        <p className="page-sub">Ideas, not tasks yet. Place each one by how much it matters and how hard it is, then bring the worthwhile ones into a week.</p>

        <Label>Ideas</Label>
        <ul className="idea-list">
          {focus.ideas.map((idea) => {
            const z = zoneOf(idea)
            const inWeeks = weeksFor(weeks, idea.id)
            return (
              <li key={idea.id} className={`idea-row ${idea.id === sel ? 'is-selected' : ''}`} onClick={() => selectIdea(idea.id)}>
                <span className={`idea-dot ${z ? 'is-placed' : ''} ${inWeeks.length ? 'is-linked' : ''}`} aria-hidden />
                <Write
                  value={idea.text}
                  onChange={(v) => editFocus((f) => void (f.ideas.find((i) => i.id === idea.id)!.text = v))}
                  singleLine
                  ariaLabel="Idea"
                />
                <span className="idea-zone">{z ? z.name : 'not placed'}</span>
              </li>
            )
          })}
        </ul>
        <div className="add-task idea-add">
          <Write
            value={draft}
            onChange={setDraft}
            placeholder="Jot an idea, press Enter"
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

        {current && <IdeaDetail idea={current} monday={monday} inWeeks={weeksFor(weeks, current.id)} />}
      </Page>

      <Page side="right" className="focus-map-page">
        <FocusMap ideas={focus.ideas} selected={sel} linked={(id) => weeksFor(weeks, id).length > 0} />
        <p className="muted small map-hint">
          {current
            ? current.x === null
              ? 'Click the map to place the selected idea, or pick a zone on the left.'
              : 'Drag a dot, or focus it and use the arrow keys (Shift for small steps).'
            : 'Select an idea to place it.'}
        </p>
      </Page>
    </Spread>
  )
}

function IdeaDetail({ idea, monday, inWeeks }: { idea: Idea; monday: string; inWeeks: string[] }) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const already = inWeeks.includes(monday)
  const z = zoneOf(idea)

  const promote = () => {
    if (already || !idea.text.trim()) return
    editWeek(monday, (w) => {
      if (w.tasks.some((t) => t.ideaId === idea.id)) return
      w.tasks.push({ id: uid(), text: idea.text.trim(), q: null, done: false, ideaId: idea.id })
    })
  }

  return (
    <div className="idea-detail">
      <Label hint={z ? z.hint : undefined}>Place it</Label>
      <div className="zone-pick" role="group" aria-label="Place in a zone">
        {ZONES.map((zone) => (
          <button key={zone.key} className={`zone-btn zone-${zone.key} ${z?.key === zone.key ? 'is-on' : ''}`} onClick={() => setPos(idea.id, zone.x, zone.y)} title={zone.hint}>
            {zone.name}
          </button>
        ))}
      </div>
      {z && (
        <button className="text-link" onClick={() => setPos(idea.id, null, null)}>
          take it off the map
        </button>
      )}

      <Label>Bring into a week</Label>
      <button className="pomo-btn promote" disabled={already || !idea.text.trim()} onClick={promote}>
        {already ? `Already in ${weekName(monday)}` : `Add to ${weekName(monday)}`}
      </button>
      <p className="muted small">Change the week with ‹ › at the top. It arrives unsorted in “Tasks of the week”, ready for the matrix.</p>
      {inWeeks.length > 0 && (
        <p className="small idea-weeks">
          In:{' '}
          {inWeeks.map((w, i) => (
            <span key={w}>
              {i > 0 && ', '}
              <a href={href('week', w)}>{weekName(w)}</a>
            </span>
          ))}
        </p>
      )}

      <div className="idea-remove">
        {confirmRemove ? (
          <>
            <span className="small">Remove this idea? Tasks already made from it stay in their weeks.</span>
            <button
              className="text-btn"
              onClick={() => {
                editFocus((f) => void (f.ideas = f.ideas.filter((i) => i.id !== idea.id)))
                selectIdea(null)
              }}
            >
              Remove
            </button>
            <button className="text-btn" onClick={() => setConfirmRemove(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="text-link" onClick={() => setConfirmRemove(true)}>
            remove idea…
          </button>
        )}
      </div>
    </div>
  )
}

function FocusMap({ ideas, selected: sel, linked }: { ideas: Idea[]; selected: string | null; linked: (id: string) => boolean }) {
  const area = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; moved: boolean } | null>(null)

  const toXY = (e: { clientX: number; clientY: number }) => {
    const r = area.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height) }
  }

  const onAreaClick = (e: MouseEvent) => {
    if (e.target !== area.current && !(e.target as HTMLElement).classList.contains('zone-label')) return
    if (!sel) return
    const { x, y } = toXY(e)
    setPos(sel, x, y)
  }

  const onPinKey = (idea: Idea, e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.01 : 0.05
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!d) return
    // Arrows move the dot here; they must not also flip the week in the top bar.
    e.preventDefault()
    e.stopPropagation()
    selectIdea(idea.id)
    setPos(idea.id, (idea.x ?? 0.5) + d[0], (idea.y ?? 0.5) + d[1])
  }

  return (
    <div className="focus-map-wrap">
      <span className="map-axis axis-top">High impact</span>
      <span className="map-axis axis-bottom">Low impact</span>
      <span className="map-axis axis-left">Hard</span>
      <span className="map-axis axis-right">Easy</span>
      <div ref={area} className={`focus-map ${sel ? 'has-selection' : ''}`} onClick={onAreaClick} aria-label="Focus Map">
        {ZONES.map((z) => (
          <span key={z.key} className={`zone-label zone-${z.key}`}>
            {z.name}
          </span>
        ))}
        {ideas.map((idea) => {
          const live = drag?.id === idea.id ? drag : null
          const x = live ? live.x : idea.x
          const y = live ? live.y : idea.y
          if (x === null || y === null) return null
          const z = zoneOf({ x, y })!
          return (
            <button
              key={idea.id}
              className={`pin ${idea.id === sel ? 'is-selected' : ''} ${linked(idea.id) ? 'is-linked' : ''}`}
              style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }}
              aria-label={`${idea.text || 'Untitled idea'}: ${z.name}. Arrow keys move it.`}
              title={idea.text}
              onKeyDown={(e) => onPinKey(idea, e)}
              onFocus={() => selectIdea(idea.id)}
              onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                selectIdea(idea.id)
                setDrag({ id: idea.id, x, y, moved: false })
              }}
              onPointerMove={(e) => {
                if (drag?.id !== idea.id) return
                setDrag({ id: idea.id, ...toXY(e), moved: true })
              }}
              onPointerUp={() => {
                if (drag?.id === idea.id && drag.moved) setPos(idea.id, drag.x, drag.y)
                setDrag(null)
              }}
              onPointerCancel={() => setDrag(null)}
            >
              <span className="pin-dot" />
              <span className="pin-label">{idea.text.length > 22 ? `${idea.text.slice(0, 21)}…` : idea.text}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
