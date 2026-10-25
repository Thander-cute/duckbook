import type { ReactNode } from 'react'
import { Check, Info, Label, Page, PageTitle, Spread, Write } from '../components/ui'
import { HabitMark } from '../components/HabitMark'
import { WEEKDAYS, WEEKDAYS_MIN, fmtMonth, monthKeyOf, weekDays, weekStart } from '../lib/date'
import { href } from '../lib/router'
import { editMonth, editWeek, useMonth, useStore, useWeekWithSeed, type Reflection } from '../lib/store'

export const PROMPTS: { key: keyof Omit<Reflection, 'more' | 'reviewed'>; title: string; q: string; icon: ReactNode }[] = [
  {
    key: 'checkin',
    title: 'Check-in',
    q: 'How did I feel this week?',
    icon: <path d="M10 16 C4 12 2.5 9 2.5 6.8 A3.6 3.6 0 0 1 10 5 A3.6 3.6 0 0 1 17.5 6.8 C17.5 9 16 12 10 16 Z" />,
  },
  {
    key: 'success',
    title: 'Success',
    q: 'What am I proud of?',
    icon: <path d="M10 2.5 L12.2 7.3 L17.4 7.8 L13.5 11.3 L14.6 16.4 L10 13.8 L5.4 16.4 L6.5 11.3 L2.6 7.8 L7.8 7.3 Z" />,
  },
  {
    key: 'lesson',
    title: 'Lesson',
    q: 'What did I learn?',
    icon: (
      <>
        <path d="M7 13 C5 11.5 4.5 9.8 4.5 8.5 A5.5 5.5 0 0 1 15.5 8.5 C15.5 9.8 15 11.5 13 13 Z" />
        <path d="M7.5 15.5 H12.5 M8.5 17.5 H11.5" />
      </>
    ),
  },
  {
    key: 'future',
    title: 'Future',
    q: 'How can I improve next week?',
    icon: (
      <>
        <path d="M10 17.5 V8" />
        <path d="M10 10 C10 6 7 4.5 3.5 4.5 C3.5 8 6 10 10 10 Z" />
        <path d="M10 8.5 C10 5 12.5 3 16.5 3 C16.5 6.5 14 8.5 10 8.5 Z" />
      </>
    ),
  },
]

export function ReflectView({ date }: { date: string }) {
  const monday = weekStart(date)
  const week = useWeekWithSeed(monday)
  const r = week.reflection
  const set = (k: keyof Reflection, v: string | boolean) => editWeek(monday, (w) => void ((w.reflection as Record<string, unknown>)[k] = v))

  return (
    <Spread>
      <Page side="left" className="reflect">
        <PageTitle step="5" caps="WEEKLY" italic="reflection" />

        {PROMPTS.map((p) => (
          <fieldset key={p.key} className="prompt">
            <legend>
              <span className="prompt-title">{p.title}:</span> <span className="prompt-q">{p.q}</span>
            </legend>
            <svg className="prompt-icon" viewBox="0 0 20 20" aria-hidden>
              {p.icon}
            </svg>
            <Write value={r[p.key]} onChange={(v) => set(p.key, v)} ariaLabel={p.q} />
          </fieldset>
        ))}

        <Label>Space for more reflection</Label>
        <Write className="dotgrid notes" value={r.more} onChange={(v) => set('more', v)} rows={4} ariaLabel="More reflection" />

        <div className="review-check">
          <label>
            <Check checked={r.reviewed} onChange={(v) => set('reviewed', v)} label="Reviewed the monthly pages" />
            <span>Reviewed the monthly pages</span>
          </label>
          <Info text="Do this week’s actions still fit your theme and goals? They’re on the right." />
        </div>
      </Page>

      <Page side="right" className="lookback">
        <header className="companion-head">
          <span className="caps-word small-caps">Look back</span>
        </header>
        <SevenSentences monday={monday} />
        <DoneThisWeek monday={monday} />
        <MonthMirror monday={monday} />
      </Page>
    </Spread>
  )
}

function SevenSentences({ monday }: { monday: string }) {
  const days = useStore((s) => s.days)
  const keys = weekDays(monday)
  return (
    <div className="sentences">
      <Label>The week in seven sentences</Label>
      <ol>
        {keys.map((k, i) => (
          <li key={k}>
            <a href={href('day', k)} className="sent-day">
              {WEEKDAYS[i].slice(0, 3)}
            </a>
            {days[k]?.sentence ? <span className="ink">{days[k].sentence}</span> : <span className="muted dots" aria-label="No sentence" />}
          </li>
        ))}
      </ol>
    </div>
  )
}

function DoneThisWeek({ monday }: { monday: string }) {
  const week = useWeekWithSeed(monday)
  const days = useStore((s) => s.days)
  const keys = weekDays(monday)
  const done = week.tasks.filter((t) => t.done)
  const dayOnly = keys.flatMap((k) => (days[k]?.tasks ?? []).filter((t) => t.done && !t.weekTaskId))
  const pomos = keys.reduce((n, k) => n + (days[k]?.tasks ?? []).reduce((m, t) => m + t.pomos, 0), 0)
  const all = [...done.map((t) => ({ id: t.id, text: t.text, q: t.q })), ...dayOnly.map((t) => ({ id: t.id, text: t.text, q: null }))]

  return (
    <div className="done-week">
      <Label hint={pomos ? `${pomos} pomodoro${pomos > 1 ? 's' : ''} of focus` : undefined}>Done this week</Label>
      {all.length ? (
        <ul>
          {all.map((t) => (
            <li key={t.id}>
              {t.q ? <span className={`q-chip q-${t.q}`}>{t.q}</span> : <span className="q-chip q-none">·</span>}
              <span className="ink">{t.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing checked off yet, and that’s okay. Some weeks are for surviving.</p>
      )}

      {week.habits.length > 0 && (
        <div className="habit-mini">
          <Label>Habits</Label>
          {week.habits.map((h) => (
            <div key={h.id} className="habit-mini-row">
              <span className="ink">{h.name}</span>
              {h.days.map((on, i) => (
                <span key={i} className="mini-dot" title={WEEKDAYS_MIN[i]}>
                  <HabitMark on={on} seed={h.id + i} />
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MonthMirror({ monday }: { monday: string }) {
  // A week can straddle two months; reflect against the month where most of it lives (Thursday's).
  const mk = monthKeyOf(weekDays(monday)[3])
  const month = useMonth(mk)
  return (
    <div className="month-mirror">
      <Label hint={fmtMonth(mk)}>
        <a href={href('month', `${mk}-01`)}>This month will be</a>
      </Label>
      <p className="theme-echo ink">{month.theme || <span className="muted">No theme yet · <a href={href('month', `${mk}-01`)}>Month →</a></span>}</p>
      <ol className="goals-echo">
        {month.goals.map((g, i) =>
          g.text ? (
            <li key={i} className={g.done ? 'is-done' : ''}>
              <span className="goal-n">{i + 1}</span>
              <span className="ink">{g.text}</span>
              <Check checked={g.done} onChange={(v) => editMonth(mk, (m) => void (m.goals[i].done = v))} label={`Goal ${i + 1} done`} />
            </li>
          ) : null,
        )}
      </ol>
    </div>
  )
}
