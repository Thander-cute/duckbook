import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Info } from './ui'
import { DISC_STEP, moveLine, segments, toMix, withType, withoutType, type Segment } from '../lib/disc'
import type { DiscMix, DiscType } from '../lib/schema'

export const DISC: Record<DiscType, { name: string; line: string }> = {
  D: { name: 'Dominance', line: 'direct, decisive, wants results' },
  I: { name: 'Influence', line: 'warm, talkative, wants connection' },
  S: { name: 'Steadiness', line: 'calm, patient, wants stability' },
  C: { name: 'Conscientiousness', line: 'careful, exact, wants quality' },
}
const TYPES = Object.keys(DISC) as DiscType[]

// A stand-in until DISC has its own page.
const ABOUT = 'DISC describes how someone tends to act through four styles. Most people are a mix of them; the largest colour is their main style.'

const describe = (items: Segment[]) => items.map(([k, v]) => `${DISC[k].name} ${v}%`).join(', ')

/** Dots in the Contacts list, the largest share first. */
export function DiscDots({ mix }: { mix: DiscMix }) {
  const items = segments(mix)
  if (!items.length) return null
  return (
    <span className="disc-dots" role="img" aria-label={`DISC: ${describe(items)}`} title={describe(items)}>
      {items.map(([k]) => (
        <i key={k} className={`disc-${k.toLowerCase()}`} />
      ))}
    </span>
  )
}

/** Pick colours above; only picked ones appear in the bar below, and the lines between them drag. */
export function DiscEditor({ mix, onChange }: { mix: DiscMix; onChange: (next: DiscMix) => void }) {
  const bar = useRef<HTMLDivElement>(null)
  // While a line is held the bar keeps its order; it sorts itself on release.
  const [held, setHeld] = useState<Segment[] | null>(null)
  const items = held ?? segments(mix)
  const main = items[0]
  const shareOf = (t: DiscType) => items.find(([k]) => k === t)?.[1]

  const at = (e: ReactPointerEvent) => {
    const r = bar.current!.getBoundingClientRect()
    return ((e.clientX - r.left) / r.width) * 100
  }
  let start = 0
  const lines = items.slice(0, -1).map(([, v]) => (start += v))

  const onKey = (e: KeyboardEvent, i: number) => {
    const by = e.key === 'ArrowLeft' ? -DISC_STEP : e.key === 'ArrowRight' ? DISC_STEP : 0
    if (!by) return
    e.preventDefault()
    e.stopPropagation()
    setHeld(moveLine(items, i, lines[i] + by))
  }
  const commit = () => {
    if (!held) return
    onChange(toMix(held))
    setHeld(null)
  }

  return (
    <div className="disc">
      <div className="disc-head">
        <span className="line-label">DISC</span>
        <Info text={ABOUT} />
      </div>
      <div className={`disc-chips ${items.length >= 2 ? 'has-main-and-second' : ''}`}>
        {TYPES.map((t) => {
          const on = t in mix
          return (
            <button key={t} className={`disc-chip disc-${t.toLowerCase()} ${on ? 'is-on' : ''}`} aria-pressed={on} title={`${DISC[t].name}: ${DISC[t].line}`} onClick={() => onChange(on ? withoutType(mix, t) : withType(mix, t))}>
              <i aria-hidden />
              {DISC[t].name}
              {on && <span className="disc-chip-share">{shareOf(t)}%</span>}
            </button>
          )
        })}
      </div>
      {items.length > 0 && (
        <>
          <div className={`disc-bar ${held ? 'is-held' : ''}`} ref={bar}>
            {items.map(([k, v]) => (
              <div key={k} className={`disc-seg disc-${k.toLowerCase()}`} style={{ width: `${v}%` }} title={`${DISC[k].name} ${v}%`} />
            ))}
            {lines.map((pos, i) => (
              <div
                key={items[i][0]}
                className="disc-line-grip"
                style={{ left: `${pos}%` }}
                role="separator"
                aria-orientation="vertical"
                tabIndex={0}
                aria-label={`Between ${DISC[items[i][0]].name} and ${DISC[items[i + 1][0]].name}`}
                aria-valuenow={items[i][1]}
                aria-valuemin={DISC_STEP}
                aria-valuemax={100}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setHeld(items)
                }}
                onPointerMove={(e) => held && setHeld(moveLine(held, i, at(e)))}
                onPointerUp={commit}
                onPointerCancel={() => setHeld(null)}
                onKeyDown={(e) => onKey(e, i)}
                onKeyUp={commit}
                onBlur={commit}
              />
            ))}
          </div>
          <p className="muted small disc-summary">
            Mostly {DISC[main[0]].name}: {DISC[main[0]].line}.
          </p>
        </>
      )}
    </div>
  )
}
