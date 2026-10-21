import { Check, Label, Page, Spread, Write } from '../components/ui'
import { MONTHS_SHORT, WEEKDAYS, addDays, daysInMonth, fmtShort, isoWeek, monthGrid, monthKeyOf, pad, todayKey, weekStart } from '../lib/date'
import { go, href } from '../lib/router'
import { editMonth, useMonth, useStore } from '../lib/store'

const MOODS = [1, 2, 3, 4, 5]

export function MonthView({ date }: { date: string }) {
  const mk = monthKeyOf(date)
  const month = useMonth(mk)
  const rows = monthGrid(mk)
  const [year, mon] = mk.split('-').map(Number)
  const today = todayKey()

  const cell = (key: string | null, i: number) =>
    key ? (
      <div key={key} className={`cal-cell ${key === today ? 'is-today' : ''}`}>
        <a className="cal-num" href={href('day', key)} title={`Open ${fmtShort(key)}`}>
          {Number(key.slice(8))}
        </a>
        <Write value={month.cells[key] ?? ''} onChange={(v) => editMonth(mk, (m) => void (m.cells[key] = v))} ariaLabel={`Notes for ${fmtShort(key)}`} />
      </div>
    ) : (
      <div key={`empty-${i}`} className="cal-cell is-empty" />
    )

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
