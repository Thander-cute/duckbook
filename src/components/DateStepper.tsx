import type { ReactNode } from 'react'
import { go, type View } from '../lib/router'
import { addDays, addMonths, fmtShort, monthKeyOf, todayKey, weekStart } from '../lib/date'

export function stepDate(view: View, date: string, dir: 1 | -1) {
  if (view === 'month') return addMonths(date, dir)
  if (view === 'day') return addDays(date, dir)
  return addDays(date, 7 * dir)
}

function isCurrent(view: View, date: string) {
  const t = todayKey()
  if (view === 'month') return monthKeyOf(date) === monthKeyOf(t)
  if (view === 'day') return date === t
  return weekStart(date) === weekStart(t)
}

/**
 * The date written on a page, with small arrows to the page before or after. A small mark leads back
 * to today, only once you've left it; it keeps its place while hidden, so the arrows never move.
 */
export function DateStepper({ view, date, children }: { view: View; date: string; children: ReactNode }) {
  const unit = view === 'month' ? 'month' : view === 'day' ? 'day' : 'week'
  return (
    <div className="date-stepper" role="group" aria-label="Change date">
      <button className="today-btn tip" disabled={isCurrent(view, date)} onClick={() => go(view, todayKey())} aria-label="Back to today" data-tip="Back to today">
        <svg viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="5.5" />
          <circle className="today-dot" cx="8" cy="8" r="1.6" />
        </svg>
      </button>
      <button className="icon-btn tip" onClick={() => go(view, stepDate(view, date, -1))} aria-label={`Previous ${unit}`} data-tip={`Previous ${unit}`}>
        ‹
      </button>
      <button className="icon-btn tip" onClick={() => go(view, stepDate(view, date, 1))} aria-label={`Next ${unit}`} data-tip={`Next ${unit}`}>
        ›
      </button>
      {children}
    </div>
  )
}

/** A week's dates, stepped a week at a time. */
export function WeekStepper({ view, date }: { view: View; date: string }) {
  const monday = weekStart(date)
  return (
    <DateStepper view={view} date={date}>
      <div className="from-to">
        From: <span className="ink">{fmtShort(monday)}</span> &nbsp; To: <span className="ink">{fmtShort(addDays(monday, 6))}</span>
      </div>
    </DateStepper>
  )
}
