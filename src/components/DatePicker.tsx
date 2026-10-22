import { useEffect, useRef, useState } from 'react'
import { MONTHS, WEEKDAYS_MIN, addDays, addMonths, fmtShort, monthKeyOf, todayKey, weekStart } from '../lib/date'
import { Popover } from './Popover'

/**
 * A month of days on paper, Monday first like the notebook. Picking a day applies it at once, so a
 * half-typed date can never reach the data. `range` tints the days between two ends.
 */
function Calendar({ value, onPick, onClear, range }: { value: string | null; onPick: (d: string) => void; onClear?: () => void; range?: [string, string] }) {
  const today = todayKey()
  const [focus, setFocus] = useState(value ?? today)
  const [month, setMonth] = useState(monthKeyOf(value ?? today))
  const grid = useRef<HTMLDivElement>(null)

  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus({ preventScroll: true })
  }, [focus, month])

  const first = weekStart(`${month}-01`)
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i))
  const weeks = days[35].slice(0, 7) === month ? 6 : 5
  const [y, m] = month.split('-').map(Number)

  const go = (d: string) => {
    setFocus(d)
    setMonth(monthKeyOf(d))
  }
  const shift = (n: number) => {
    const next = addMonths(`${month}-01`, n)
    setMonth(monthKeyOf(next))
    setFocus(monthKeyOf(focus) === monthKeyOf(next) ? focus : next)
  }

  return (
    <div className="dp" data-month={month}>
      <div className="dp-head">
        <button className="dp-nav" aria-label="Previous month" onClick={() => shift(-1)}>
          ‹
        </button>
        <span className="dp-title">
          {MONTHS[m - 1]} <span className="dp-year">{y}</span>
        </span>
        <button className="dp-nav" aria-label="Next month" onClick={() => shift(1)}>
          ›
        </button>
      </div>
      <div className="dp-grid" role="grid" ref={grid}>
        {WEEKDAYS_MIN.map((w) => (
          <span key={w} className="dp-wd" aria-hidden>
            {w}
          </span>
        ))}
        {days.slice(0, weeks * 7).map((d) => {
          const inRange = range && d >= range[0] && d <= range[1]
          return (
            <button
              key={d}
              data-date={d}
              tabIndex={d === focus ? 0 : -1}
              aria-label={fmtShort(d)}
              aria-pressed={d === value}
              className={[
                'dp-day',
                monthKeyOf(d) !== month && 'is-out',
                d === today && 'is-today',
                d === value && 'is-on',
                inRange && 'in-range',
                range && d === range[0] && 'range-start',
                range && d === range[1] && 'range-end',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onPick(d)}
              onKeyDown={(e) => {
                const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
                if (step) go(addDays(d, step))
                else if (e.key === 'PageUp') go(addMonths(d, -1))
                else if (e.key === 'PageDown') go(addMonths(d, 1))
                else if (e.key === 'Home') go(weekStart(d))
                else if (e.key === 'End') go(addDays(weekStart(d), 6))
                else return
                // Keys here move through the calendar, not the notebook behind it.
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              {Number(d.slice(8))}
            </button>
          )
        })}
      </div>
      <div className="dp-foot">
        {onClear && value ? (
          <button className="dp-link" onClick={onClear}>
            No date
          </button>
        ) : (
          <span />
        )}
        <button className="dp-link" onClick={() => onPick(today)}>
          Today
        </button>
      </div>
    </div>
  )
}

/**
 * A date shown as a small chip; clicking it opens the calendar. `placeholder` shows when empty.
 * Used for planned dates (clearable) and for the ends of a span (always set).
 */
export function DateChip({
  value,
  onChange,
  placeholder = '+ date',
  label,
  className = '',
  clearable = true,
  range,
}: {
  value: string | null
  onChange: (d: string | null) => void
  placeholder?: string
  label: string
  className?: string
  clearable?: boolean
  range?: [string, string]
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const done = (d: string | null) => {
    setOpen(false)
    if (d !== value) onChange(d)
    btn.current?.focus()
  }
  return (
    <>
      <button
        ref={btn}
        className={`date-chip ${value ? 'has-date' : ''} ${open ? 'is-open' : ''} ${className}`}
        aria-label={value ? `${label}: ${fmtShort(value)}, change` : label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        {value ? fmtShort(value) : placeholder}
      </button>
      {open && btn.current && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} label={label} className="dp-pop">
          <Calendar value={value} onPick={done} onClear={clearable ? () => done(null) : undefined} range={range} />
        </Popover>
      )}
    </>
  )
}
