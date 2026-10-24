import { InkDot } from './InkDot'
import { useHabitMark } from '../lib/habitMark'
import { hatchPath, tickPath } from '../lib/penMarks'

/** A habit's day: the printed circle, empty or written on in the style chosen in Settings (ink dot, shaded, ticked). */
export function HabitMark({ on, seed }: { on: boolean; seed: string }) {
  const style = useHabitMark()
  if (!on) return <span className="pomo-ring" />
  if (style === 'dot') return <InkDot seed={seed} />
  return (
    <svg className={`ink-dot habit-${style}`} viewBox="0 0 20 20" aria-hidden>
      <circle className="habit-print" cx="10" cy="10" r="8.5" />
      <path d={style === 'hatch' ? hatchPath(seed) : tickPath(seed)} />
    </svg>
  )
}
