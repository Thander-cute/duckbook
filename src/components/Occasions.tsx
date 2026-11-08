import { useState } from 'react'
import { ConfirmRemove, Write } from './ui'
import { Popover } from './Popover'
import { fmtShort } from '../lib/date'
import type { DayOccasion, OccasionKind } from '../lib/occasions'
import { editOccasions, uid } from '../lib/store'

/** Thin ink marks: a little cake for a birthday, a star for a holiday, a heart for a day you added. */
const PATHS: Record<OccasionKind, string> = {
  birthday: 'M3.5 17h13M5 17v-6.5h10V17M5 13.5c1.7 1.2 3.3 1.2 5 0 1.7 1.2 3.3 1.2 5 0M10 10.5V7M10 5V3',
  holiday: 'M10 3.5l1.9 4.1 4.4.5-3.3 3 .9 4.4L10 13.3l-3.9 2.2.9-4.4-3.3-3 4.4-.5z',
  custom: 'M10 16s-5.5-3.4-5.5-7.2A2.9 2.9 0 0 1 10 7a2.9 2.9 0 0 1 5.5 1.8C15.5 12.6 10 16 10 16z',
}

export function OccasionIcon({ kind }: { kind: OccasionKind }) {
  return (
    <svg className="occ-icon" viewBox="0 0 20 20" aria-hidden>
      <path d={PATHS[kind]} />
    </svg>
  )
}

/** The day's occasions on one line at the top of a Month cell, or a + on hover to add the first. */
export function CellOccasions({ items, nudge, canAdd, onOpen }: { items: DayOccasion[]; nudge: boolean; canAdd: boolean; onOpen: (at: HTMLElement) => void }) {
  const open = (e: { currentTarget: HTMLElement }) => onOpen(e.currentTarget.closest('.cal-cell')!.querySelector<HTMLElement>('.cal-num')!)
  if (!items.length) {
    if (!canAdd) return null
    return (
      <button className={`cal-day-add ${nudge ? 'has-photo' : ''}`} tabIndex={-1} aria-label="Add a day to remember" title="Remember this day every year" onClick={open}>
        +
      </button>
    )
  }
  const first = items[0]
  return (
    <button className={`cal-occ is-${first.kind} ${nudge ? 'has-photo' : ''}`} title={items.map((o) => o.label).join('\n')} aria-label={items.map((o) => o.label).join(', ')} onClick={open}>
      <OccasionIcon kind={first.kind} />
      <span>{first.short ?? first.label}</span>
      {items.length > 1 && <span className="cal-occ-more">+{items.length - 1}</span>}
    </button>
  )
}

/** What a day is remembered for, opened from its Month cell. Own days are written and removed here. */
export function DayCard({ date, items, canAdd, anchor, onClose }: { date: string; items: DayOccasion[]; canAdd: boolean; anchor: HTMLElement; onClose: () => void }) {
  const [draft, setDraft] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const add = () => {
    const name = draft.trim()
    if (!name) return
    const [, m, d] = date.split('-').map(Number)
    editOccasions((f) => void f.days.push({ id: uid(), name, day: d, month: m }))
    setDraft('')
  }
  return (
    <Popover anchor={anchor} onClose={onClose} className="day-card" label={`Days to remember on ${fmtShort(date)}`}>
      <div className="wk-pop-head">{fmtShort(date)}</div>
      {items.length > 0 && (
        <ul className="day-card-list">
          {items.map((o, i) => (
            <li key={`${o.kind}-${o.id ?? i}`}>
              <OccasionIcon kind={o.kind} />
              {o.kind === 'custom' ? (
                <>
                  <Write value={o.label} onChange={(v) => editOccasions((f) => void (f.days.find((x) => x.id === o.id)!.name = v))} singleLine ariaLabel="Name of the day" />
                  {removing === o.id ? (
                    <ConfirmRemove what={o.label} onRemove={() => editOccasions((f) => void (f.days = f.days.filter((x) => x.id !== o.id)))} onKeep={() => setRemoving(null)} />
                  ) : (
                    <button className="span-x" aria-label={`Remove ${o.label}`} title="Remove" onClick={() => setRemoving(o.id!)}>
                      ✕
                    </button>
                  )}
                </>
              ) : (
                <span className="ink">{o.label}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <input
          className="day-card-add ink"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          onBlur={add}
          placeholder="Remember this day every year…"
          aria-label="Remember this day every year"
        />
      )}
    </Popover>
  )
}

/** The day's occasions written under the Day page title. */
export function DayOccasions({ items }: { items: DayOccasion[] }) {
  if (!items.length) return null
  return (
    <ul className="day-occasions" aria-label="Today">
      {items.map((o, i) => (
        <li key={`${o.kind}-${o.id ?? i}`} className={`is-${o.kind}`}>
          <OccasionIcon kind={o.kind} />
          {o.label}
        </li>
      ))}
    </ul>
  )
}
