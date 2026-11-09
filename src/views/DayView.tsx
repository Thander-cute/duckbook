import { DateStepper } from '../components/DateStepper'
import { DayPhotos } from '../components/Photos'
import { useState } from 'react'
import { Check, Label, Line, Page, PageTitle, Spread, Write } from '../components/ui'
import { InkDot } from '../components/InkDot'
import { DayOccasions } from '../components/Occasions'
import { useOccasionsOf } from '../lib/occasions'
import { HabitMark } from '../components/HabitMark'
import { WEEKDAYS_MIN, fmtShort, monthKeyOf, weekDays, weekStart, weekdayIndex } from '../lib/date'
import { href } from '../lib/router'
import { editDay, editWeek, ideaOfDayTask, markStarted, renameDayTask, setDayTaskDone, uid, useDay, useMonth, useSettings, useStore, useWeekWithSeed, type DayTask } from '../lib/store'
import { WorkMeta } from '../components/WorkMeta'
import { noteFor } from '../lib/quotes'
import { startFocus, useTimer } from '../lib/timer'

const SOFT_LIMIT = 5

export function DayView({ date }: { date: string }) {
  const day = useDay(date)
  const { focusMin } = useSettings()
  const [draft, setDraft] = useState('')
  const wd = weekdayIndex(date)
  const occasions = useOccasionsOf()(date)

  const add = (text: string, weekTaskId?: string) => {
    if (!text.trim()) return
    editDay(date, (d) => void d.tasks.push({ id: uid(), text: text.trim(), estimate: 1, pomos: 0, done: false, weekTaskId }))
  }

  const planned = day.tasks.reduce((n, t) => n + t.estimate, 0)
  const doneP = day.tasks.reduce((n, t) => n + t.pomos, 0)

  return (
    <Spread>
      <Page side="left" className="day-page">
        <div className="day-head">
          <div className="weekday-row" aria-label="Day of week">
            {WEEKDAYS_MIN.map((w, i) => (
              <a key={w} href={href('day', weekDays(weekStart(date))[i])} className={`wd ${i === wd ? 'is-on' : ''}`}>
                {w}
              </a>
            ))}
          </div>
          <DateStepper view="day" date={date}>
            <div className="date-field">
              Date: <span className="ink">{fmtShort(date)}</span>
            </div>
          </DateStepper>
        </div>

        <PageTitle step="4" caps="DAILY" italic="planning" />
        <p className="day-note">{noteFor(date)}</p>
        <DayOccasions items={occasions} />

        <Line label="Today I am grateful for:" value={day.grateful} onChange={(v) => editDay(date, (d) => void (d.grateful = v))} />

        <div className="tasks">
          <div className="tasks-head">
            <Label>Tasks of the day</Label>
            <span className="est-head" title="Estimated pomodoros">
              <TomatoIcon />
            </span>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="circle-num">
                {i + 1}
              </span>
            ))}
          </div>

          {day.tasks.map((t) => (
            <TaskRow key={t.id} date={date} task={t} />
          ))}

          <div className="task-add">
            <span className="bullet" aria-hidden>
              +
            </span>
            <Write
              value={draft}
              onChange={setDraft}
              placeholder={day.tasks.length >= SOFT_LIMIT ? 'Five is plenty. Still add another?' : 'Add a task…'}
              singleLine
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add(draft)
                  setDraft('')
                }
              }}
            />
          </div>

          {planned > 0 && (
            <p className="muted small tasks-sum">
              {doneP} of {planned} pomodoros · about {fmtHours(planned * focusMin)} of focus planned
            </p>
          )}
        </div>

        <Label>Notes</Label>
        <Write className="dotgrid notes" value={day.notes} onChange={(v) => editDay(date, (d) => void (d.notes = v))} rows={6} ariaLabel="Notes" />

        <div className="page-foot">
          <Line label="My day in one sentence:" value={day.sentence} onChange={(v) => editDay(date, (d) => void (d.sentence = v))} />
        </div>
      </Page>

      <Page side="right" className="companion">
        <WeekCompanion date={date} />
      </Page>
    </Spread>
  )
}

function TaskRow({ date, task: t }: { date: string; task: DayTask }) {
  const timer = useTimer()
  const active = timer.phase !== 'idle' && timer.taskId === t.id
  const idea = useStore((s) => ideaOfDayTask(s, t))
  const set = (fn: (x: DayTask) => void) =>
    editDay(date, (d) => {
      const x = d.tasks.find((y) => y.id === t.id)
      if (x) fn(x)
    })

  return (
    <div className={`task-row ${t.done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
      <Check checked={t.done} onChange={(v) => setDayTaskDone(date, t.id, v)} label={`Mark “${t.text}” done`} />
      <div className="task-text">
        <Write
          value={t.text}
          onChange={(v) => renameDayTask(date, t.id, v)}
          singleLine
          ariaLabel="Task"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLTextAreaElement).blur()
            }
            if (e.key === 'Backspace' && !t.text) {
              e.preventDefault()
              editDay(date, (d) => void (d.tasks = d.tasks.filter((y) => y.id !== t.id)))
            }
          }}
        />
        <WorkMeta idea={idea} returnDate={date} />
        {!t.done && (
          <button
            className="play"
            onClick={() => {
              markStarted(date, t.id)
              startFocus(date, t.id, t.text || 'Untitled task')
            }} title="Start a pomodoro" aria-label="Start a pomodoro">
            <svg viewBox="0 0 10 10" aria-hidden>
              <path d="M2.5 1.5 L8.5 5 L2.5 8.5 Z" />
            </svg>
          </button>
        )}
        <button className="remove" onClick={() => editDay(date, (d) => void (d.tasks = d.tasks.filter((y) => y.id !== t.id)))} aria-label="Remove task" title="Remove">
          ×
        </button>
      </div>
      <div className="est" title="Estimated pomodoros">
        <button onClick={() => set((x) => void (x.estimate = Math.max(1, x.estimate - 1)))} aria-label="Fewer">
          −
        </button>
        <span>{t.estimate}</span>
        <button onClick={() => set((x) => void (x.estimate = Math.min(10, x.estimate + 1)))} aria-label="More">
          +
        </button>
      </div>
      {Array.from({ length: 10 }, (_, i) => (
        <button
          key={i}
          className={`pomo ${i < t.estimate ? 'is-planned' : ''}`}
          onClick={() => set((x) => void (x.pomos = x.pomos > i ? i : i + 1))}
          aria-label={`Pomodoro ${i + 1}${i < t.pomos ? ', done' : ''}`}
        >
          {i < t.pomos ? <InkDot seed={t.id + i} /> : <span className="pomo-ring" />}
        </button>
      ))}
    </div>
  )
}

function WeekCompanion({ date }: { date: string }) {
  const monday = weekStart(date)
  const week = useWeekWithSeed(monday)
  const day = useDay(date)
  const month = useMonth(monthKeyOf(date))
  const wd = weekdayIndex(date)
  const onToday = new Set(day.tasks.map((t) => t.weekTaskId).filter(Boolean))
  const calendar = month.cells[date]

  const focusOn = useSettings().modules.focusMap
  // Select a stable slice of state, then derive (a fresh array from a selector would re-render forever).
  const ideas = useStore((s) => s.focus.ideas)
  const plannedToday = focusOn ? week.tasks.filter((t) => !t.done && t.q !== 'A' && t.q !== 'B' && t.ideaId && ideas.find((i) => i.id === t.ideaId)?.date === date) : []
  const groups = [
    { q: 'planned' as const, tasks: plannedToday },
    ...(['A', 'B'] as const).map((q) => ({ q, tasks: week.tasks.filter((t) => t.q === q && !t.done) })),
  ]

  return (
    <>
      <header className="companion-head">
        <span className="caps-word small-caps">This week</span>
        <a href={href('week', date)} className="text-link">
          Open week →
        </a>
      </header>

      <Line label="Biggest goal of the week:" value={week.goal} onChange={(v) => editWeek(date, (w) => void (w.goal = v))} />

      {calendar && (
        <div className="calendar-note">
          <Label>On the calendar</Label>
          <p className="ink">{calendar}</p>
        </div>
      )}

      <div className="pull">
        <Label>Pick from your plan</Label>
        {groups.every((g) => !g.tasks.length) && (
          <p className="muted small empty-hint">
            Nothing waiting · <a href={href('week', date)}>Week →</a>
          </p>
        )}
        {groups.map(
          (g) =>
            g.tasks.length > 0 && (
              <ul key={g.q} className="pull-list">
                {g.tasks.map((t) => {
                  const added = onToday.has(t.id)
                  return (
                    <li key={t.id}>
                      <button
                        className={`pull-item ${added ? 'is-added' : ''}`}
                        disabled={added}
                        onClick={() =>
                          editDay(date, (d) => void d.tasks.push({ id: uid(), text: t.text, estimate: 1, pomos: 0, done: false, weekTaskId: t.id }))
                        }
                      >
                        <span className={`q-chip q-${g.q}`} title={g.q === 'planned' ? 'Planned for today on the Focus Map' : undefined}>
                          {g.q === 'planned' ? '◎' : g.q}
                        </span>
                        <span className="ink">{t.text}</span>
                        <span className="pull-act">{added ? 'on today' : '+ today'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ),
        )}
      </div>

      {week.habits.length > 0 && (
        <div className="habits-today">
          <Label>Habits today</Label>
          <ul>
            {week.habits.map((h, i) => (
              <li key={h.id}>
                <button
                  className="habit-toggle"
                  onClick={() => editWeek(date, (w) => void (w.habits[i].days[wd] = !w.habits[i].days[wd]))}
                  aria-pressed={h.days[wd]}
                >
                  <HabitMark on={h.days[wd]} seed={h.id + wd} />
                  <span className="ink">{h.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DayPhotos date={date} />

      <div className="companion-foot">
        <a href={href('reflect', date)} className="text-link">
          Weekly reflection →
        </a>
      </div>
    </>
  )
}

const fmtHours = (min: number) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`
}

function TomatoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
      <circle cx="10" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M10 4.5 V2.5 M7.5 5 Q10 6.5 12.5 5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}
