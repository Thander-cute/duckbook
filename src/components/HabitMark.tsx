import { useId, useRef } from 'react'
import { InkDot } from './InkDot'
import { useHabitMark } from '../lib/habitMark'
import { hatchLines, tickLine, tickPath } from '../lib/penMarks'

/** A habit's day: the printed circle, empty or written on in the style chosen in Settings (ink dot, shaded, ticked). */
export function HabitMark({ on, seed }: { on: boolean; seed: string }) {
  const style = useHabitMark()
  const id = useId()
  // Marks already there when the page opens just sit there; a mark made now is drawn in.
  const wasOn = useRef(on)
  if (!on) wasOn.current = false
  const draw = !wasOn.current
  if (!on) return <span className="pomo-ring" />
  if (style === 'dot') return <InkDot seed={seed} />
  return (
    <svg className={`ink-dot habit-${style} ${draw ? 'is-drawn' : ''}`} viewBox="0 0 20 20" aria-hidden>
      <circle className="habit-print" cx="10" cy="10" r="8.5" />
      {style === 'hatch' ? (
        hatchLines(seed).map((d, i) => <path key={i} d={d} pathLength={1} style={{ animationDelay: `${i * 70}ms` }} />)
      ) : (
        <>
          {draw && (
            <mask id={id}>
              <path className="tick-pen" d={tickLine(seed)} pathLength={1} />
            </mask>
          )}
          <path d={tickPath(seed)} mask={draw ? `url(#${id})` : undefined} />
        </>
      )}
    </svg>
  )
}
