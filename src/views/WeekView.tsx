import { WeekStepper } from '../components/DateStepper'
import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Check, Label, Line, Page, PageTitle, Spread, Write } from '../components/ui'
import { HabitMark } from '../components/HabitMark'
import { WEEKDAYS_MIN, todayKey, weekDays, weekStart } from '../lib/date'
import { href } from '../lib/router'
import { WorkMeta } from '../components/WorkMeta'
import { dropPencil, editWeek, ideaOfWeekTask, keepPencil, renameWeekTask, setWeekTaskDone, uid, useAutoCopyNote, usePencil, useStore, useWeekWithSeed, type Quadrant, type WeekTask } from '../lib/store'
import { CARE, type Suggestion, type Suggestions } from '../lib/weekCopy'

const Q_INFO: Record<Quadrant, { title: string; hint: string }> = {
  A: { title: 'Important & urgent', hint: 'Do first' },
  B: { title: 'Important, not urgent', hint: 'Schedule this week' },
  C: { title: 'Urgent, not important', hint: 'Delegate or do quickly' },
  D: { title: 'Neither', hint: 'Drop, or only after the rest' },
}

const DRAG_TYPE = 'application/x-duckbook-task'

export function WeekView({ date }: { date: string }) {
  const monday = weekStart(date)
  const week = useWeekWithSeed(monday)
  const pencil = usePencil(monday)
  const unsorted = week.tasks.filter((t) => !t.q)

  return (
    <Spread>
      <Page side="left" className="week-notes">
        <PageTitle step="2" caps="WEEKLY" italic="notes" />

        <Line label="Biggest goal of the week:" value={week.goal} onChange={(v) => editWeek(monday, (w) => void (w.goal = v))} />

        <DropZone q={null} monday={monday} className="brain-dump">
          <Label info="Is it important? Is it urgent? Drag each task into a box on the right.">Tasks of the week</Label>
          <ul className="dump-list">
            {unsorted.map((t) => (
              <WeekTaskItem key={t.id} monday={monday} task={t} sortable />
            ))}
            {pencil.tasks
              .filter((c) => !c.q)
              .map((c) => (
                <PencilTask key={c.key} monday={monday} c={c} />
              ))}
          </ul>
          <AddTask monday={monday} q={null} placeholder="Add a task…" />
        </DropZone>

        <Label>Notes</Label>
        <Write className="dotgrid notes week-free" value={week.notes} onChange={(v) => editWeek(monday, (w) => void (w.notes = v))} rows={10} ariaLabel="Weekly notes" />
      </Page>

      <Page side="right" className="week-plan">
        <PageTitle step="3" caps="WEEKLY" italic="planning">
          <div className="title-tools">
            <WeekStepper view="week" date={date} />
          </div>
        </PageTitle>

        <div className="matrix">
          <div />
          <div className="axis axis-top">Important</div>
          <div className="axis axis-top">Not important</div>
          <div className="axis axis-side">
            <span>Urgent</span>
          </div>
          <Quad q="A" monday={monday} tasks={week.tasks} pencil={pencil} />
          <Quad q="C" monday={monday} tasks={week.tasks} pencil={pencil} />
          <div className="axis axis-side">
            <span>Not urgent</span>
          </div>
          <Quad q="B" monday={monday} tasks={week.tasks} pencil={pencil} />
          <Quad q="D" monday={monday} tasks={week.tasks} pencil={pencil} />
        </div>

        <KeepAll monday={monday} pencil={pencil} />

        <HabitTracker monday={monday} />

        <label className="line">
          <span className="line-label">Self-care:</span>
          <span className="line-field">
            <Write
              value={week.selfCare}
              onChange={(v) => editWeek(monday, (w) => void (w.selfCare = v))}
              placeholder={pencil.selfCare !== null && !week.selfCare ? undefined : 'a long bath, a walk, an early night…'}
              singleLine
              ariaLabel="Self-care:"
            />
            {!week.selfCare && pencil.selfCare !== null && (
              <button className="pencil-care" aria-label={`Suggestion from last week for Self-care: ${pencil.selfCare}. Press to keep it.`} onClick={() => void keepPencil(monday, [CARE])}>
                {pencil.selfCare}
              </button>
            )}
          </span>
        </label>
      </Page>
    </Spread>
  )
}

/** Keep every pencil line of the week at once. Also says when the automatic copy waits for Drive, for this week only. */
function KeepAll({ monday, pencil }: { monday: string; pencil: Suggestions }) {
  const waiting = useAutoCopyNote()?.kind === 'waiting' && monday === weekStart(todayKey())
  const keys = [...pencil.tasks.map((c) => c.key), ...(pencil.selfCare !== null ? [CARE] : [])]
  if (!keys.length && !waiting) return null
  return (
    <p className="pencil-all-row">
      {keys.length > 0 && (
        <button className="pencil-all" onClick={() => void keepPencil(monday, keys)}>
          keep all from last week
        </button>
      )}
      {waiting && <span className="pencil-wait">Automatic copy is waiting for a Drive sync</span>}
    </p>
  )
}

const HOLD_MS = 500
const DRAG_PX = 24
const SLOP_PX = 10
const STRIKE_MS = 420

/**
 * A line from last week, in pencil, until it is kept. A plain click keeps it. The small pencil × at
 * the end, drawing a horizontal line across it, or pressing and holding drops it on this device;
 * Delete drops a focused line. The strike is drawn over the text, so the line never changes size.
 */
function PencilTask({ monday, c }: { monday: string; c: Suggestion }) {
  const [dropping, setDropping] = useState(false)
  const press = useRef<{ x: number; y: number; hold: number } | null>(null)
  const dropTimer = useRef(0)
  const suppressClick = useRef(false)

  const cancelPress = () => {
    if (!press.current) return
    window.clearTimeout(press.current.hold)
    press.current = null
  }

  const drop = () => {
    if (dropping) return
    cancelPress()
    suppressClick.current = true
    // The line is crossed out, then fades (styles.css); it leaves the list when the fade ends.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return void dropPencil(monday, c.key)
    setDropping(true)
    dropTimer.current = window.setTimeout(() => dropPencil(monday, c.key), STRIKE_MS)
  }

  useEffect(
    () => () => {
      window.clearTimeout(dropTimer.current)
      if (press.current) window.clearTimeout(press.current.hold)
    },
    [],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dropping || e.button !== 0) return
    suppressClick.current = false
    e.currentTarget.focus({ preventScroll: true })
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { x: e.clientX, y: e.clientY, hold: window.setTimeout(drop, HOLD_MS) }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p || dropping) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return
    // Travel means it is a drag, not a hold; a mostly horizontal stroke drops the line.
    window.clearTimeout(p.hold)
    p.hold = 0
    if (Math.abs(dx) >= DRAG_PX && Math.abs(dx) > Math.abs(dy)) drop()
  }

  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (!dropping) void keepPencil(monday, [c.key])
  }

  return (
    <li className={`pencil-task ${dropping ? 'is-dropping' : ''}`}>
      <button
        className="pencil-keep"
        aria-label={`Suggestion from last week: ${c.text}. Press to keep it; drag across, hold, or press Delete to drop it.`}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => cancelPress()}
        onPointerCancel={() => cancelPress()}
        onKeyDown={(e) => {
          if (e.key !== 'Delete' && e.key !== 'Backspace') return
          e.preventDefault()
          drop()
        }}
      >
        {c.text}
      </button>
      <button className="pencil-drop" title="Drop this suggestion" aria-label={`Drop the suggestion: ${c.text}`} onClick={drop}>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
          <path d="M2.6 2.9C4.1 4.3 5.9 6.2 9.5 9.3" />
          <path d="M9.6 2.7C8.1 4.2 6.2 6.1 2.4 9.6" />
        </svg>
      </button>
    </li>
  )
}

function DropZone({ q, monday, className, children }: { q: Quadrant | null; monday: string; className: string; children: ReactNode }) {
  const [over, setOver] = useState(false)
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const id = e.dataTransfer.getData(DRAG_TYPE)
    if (!id) return
    editWeek(monday, (w) => {
      const t = w.tasks.find((x) => x.id === id)
      if (!t) return
      t.q = q
      // Move to the end so dropped tasks land at the bottom of their new home.
      w.tasks = [...w.tasks.filter((x) => x.id !== id), t]
    })
  }
  return (
    <div
      className={`${className} ${over ? 'is-over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={onDrop}
    >
      {children}
    </div>
  )
}

function Quad({ q, monday, tasks, pencil }: { q: Quadrant; monday: string; tasks: WeekTask[]; pencil: Suggestions }) {
  const mine = tasks.filter((t) => t.q === q)
  return (
    <DropZone q={q} monday={monday} className={`quad quad-${q}`}>
      <ul>
        {mine.map((t) => (
          <WeekTaskItem key={t.id} monday={monday} task={t} />
        ))}
        {pencil.tasks
          .filter((c) => c.q === q)
          .map((c) => (
            <PencilTask key={c.key} monday={monday} c={c} />
          ))}
      </ul>
      <AddTask monday={monday} q={q} placeholder="+" />
      <span className="quad-letter" title={`${Q_INFO[q].title}: ${Q_INFO[q].hint}`}>
        <b>{q}</b>
        <span className="quad-hint">{Q_INFO[q].hint}</span>
      </span>
    </DropZone>
  )
}

function WeekTaskItem({ monday, task: t, sortable }: { monday: string; task: WeekTask; sortable?: boolean }) {
  const set = (fn: (x: WeekTask) => void) =>
    editWeek(monday, (w) => {
      const x = w.tasks.find((y) => y.id === t.id)
      if (x) fn(x)
    })
  const remove = () => editWeek(monday, (w) => void (w.tasks = w.tasks.filter((y) => y.id !== t.id)))
  const idea = useStore((s) => ideaOfWeekTask(s, t))

  return (
    <li className={`wtask ${t.done ? 'is-done' : ''}`}>
      <span
        className="grip"
        draggable
        title="Drag to another box"
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, t.id)
          e.dataTransfer.effectAllowed = 'move'
          const li = e.currentTarget.closest('li')
          if (li) e.dataTransfer.setDragImage(li, 12, 12)
        }}
      >
        ⠿
      </span>
      <Write
        value={t.text}
        onChange={(v) => renameWeekTask(monday, t.id, v)}
        singleLine
        ariaLabel="Task"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLTextAreaElement).blur()
          }
          if (e.key === 'Backspace' && !t.text) {
            e.preventDefault()
            remove()
          }
        }}
      />
      <WorkMeta idea={idea} returnDate={monday} />
      {sortable ? (
        <span className="sort-chips">
          {(['A', 'B', 'C', 'D'] as const).map((q) => (
            <button key={q} className={`q-chip q-${q}`} onClick={() => set((x) => void (x.q = q))} title={`${Q_INFO[q].title}: ${Q_INFO[q].hint}`}>
              {q}
            </button>
          ))}
        </span>
      ) : (
        <Check checked={t.done} onChange={(v) => setWeekTaskDone(monday, t.id, v)} label={`Mark “${t.text}” done`} />
      )}
    </li>
  )
}

function AddTask({ monday, q, placeholder }: { monday: string; q: Quadrant | null; placeholder: string }) {
  const [text, setText] = useState('')
  return (
    <div className="add-task">
      <Write
        value={text}
        onChange={setText}
        placeholder={placeholder}
        singleLine
        ariaLabel={q ? `Add to ${q}` : 'Add a task of the week'}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (!text.trim()) return
          editWeek(monday, (w) => void w.tasks.push({ id: uid(), text: text.trim(), q, done: false }))
          setText('')
        }}
      />
    </div>
  )
}

function HabitTracker({ monday }: { monday: string }) {
  const week = useWeekWithSeed(monday)
  const [name, setName] = useState('')
  const days = weekDays(monday)
  const today = todayKey()

  return (
    <div className="habits">
      <div className="habit-row habit-head">
        <Label>Habit tracker</Label>
        {WEEKDAYS_MIN.map((w, i) => (
          <a key={w} href={href('day', days[i])} className={`wd-min ${days[i] === today ? 'is-today' : ''}`}>
            {w}
          </a>
        ))}
      </div>
      {week.habits.map((h, hi) => (
        <div className="habit-row" key={h.id}>
          <Write
            value={h.name}
            onChange={(v) => editWeek(monday, (w) => void (w.habits[hi].name = v))}
            singleLine
            ariaLabel="Habit"
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !h.name) {
                e.preventDefault()
                editWeek(monday, (w) => void w.habits.splice(hi, 1))
              }
            }}
          />
          {h.days.map((on, di) => (
            <button
              key={di}
              className="pomo habit-dot"
              aria-pressed={on}
              aria-label={`${h.name} on ${WEEKDAYS_MIN[di]}`}
              onClick={() => editWeek(monday, (w) => void (w.habits[hi].days[di] = !on))}
            >
              <HabitMark on={on} seed={h.id + di} />
            </button>
          ))}
        </div>
      ))}
      <div className="habit-row">
        <Write
          value={name}
          onChange={setName}
          placeholder={week.habits.length ? '+ habit' : 'Add a habit: exercise, read 10 pages…'}
          singleLine
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (!name.trim()) return
            editWeek(monday, (w) => void w.habits.push({ id: uid(), name: name.trim(), days: Array(7).fill(false) }))
            setName('')
          }}
        />
      </div>
    </div>
  )
}
