import { InkDot } from './InkDot'
import { useHabitMark } from '../lib/habitMark'

function rng(seed: string) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), (h % 1000) / 1000)
}

/** A habit's day: an empty circle, or marked done in the style chosen in Settings (ink dot, hatched circle, ticked circle). */
export function HabitMark({ on, seed }: { on: boolean; seed: string }) {
  const style = useHabitMark()
  if (!on) return <span className="pomo-ring" />
  if (style === 'dot') return <InkDot seed={seed} />
  const r = rng(seed)
  if (style === 'hatch') {
    // Pen strokes from bottom-left to top-right, a little uneven, filling the circle.
    const d = Array.from({ length: 8 }, (_, i) => {
      const k = -12 + i * 4.4 + r() * 0.8
      return `M${(2 + k).toFixed(1)},${(18 + r() * 0.8).toFixed(1)} L${(18 + k).toFixed(1)},${(2 - r() * 0.8).toFixed(1)}`
    }).join(' ')
    return (
      <svg className="ink-dot habit-hatch" viewBox="0 0 20 20" aria-hidden>
        <clipPath id={`hb-${seed}`}>
          <circle cx="10" cy="10" r="8.6" />
        </clipPath>
        <circle cx="10" cy="10" r="8.6" />
        <path d={d} clipPath={`url(#hb-${seed})`} />
      </svg>
    )
  }
  const j = () => (r() - 0.5) * 1
  return (
    <svg className="ink-dot habit-tick" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="8.6" />
      <path d={`M${5.6 + j()},${10.4 + j()} Q7.4,11.8 ${8.8 + j()},${14 + j()} Q11,${8.6 + j()} ${14.8 + j()},${5.8 + j()}`} />
    </svg>
  )
}
