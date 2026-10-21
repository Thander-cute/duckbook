import { useTimer, remainingMs, togglePause, stop, startFocus, endBreak } from '../lib/timer'

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A quiet pill at the bottom of the desk; only exists while a pomodoro is in play. */
export function PomodoroBar() {
  const t = useTimer()
  if (t.phase === 'idle' && !t.taskId) return null

  if (t.phase === 'idle') {
    return (
      <div className="pomo-bar is-idle" role="status">
        <span className="pomo-label">
          Break’s over. Another round of <em>{t.label}</em>?
        </span>
        <button className="pomo-btn" onClick={() => startFocus(t.dayKey!, t.taskId!, t.label)}>
          Start
        </button>
        <button className="pomo-btn ghost" onClick={stop}>
          Done for now
        </button>
      </div>
    )
  }

  return (
    <div className={`pomo-bar phase-${t.phase} ${t.paused ? 'is-paused' : ''}`} role="timer">
      <span className="pomo-dot" aria-hidden />
      <span className="pomo-phase">{t.phase === 'focus' ? 'Focus' : 'Break'}</span>
      <span className="pomo-label">{t.phase === 'focus' ? t.label : 'Stand up, breathe, look away.'}</span>
      <span className="pomo-time">{fmt(remainingMs(t))}</span>
      <button className="pomo-btn ghost" onClick={togglePause}>
        {t.paused ? 'Resume' : 'Pause'}
      </button>
      {t.phase === 'focus' ? (
        <button className="pomo-btn ghost" onClick={stop}>
          Stop
        </button>
      ) : (
        <button className="pomo-btn ghost" onClick={endBreak}>
          Skip
        </button>
      )}
    </div>
  )
}
