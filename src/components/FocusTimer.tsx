import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../lib/store'
import { cancelSwitch, confirmSwitch, endBreak, remainingMs, setView, startFocus, stop, togglePause, useTimer, type TimerView } from '../lib/timer'

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const R = 46
const C = 2 * Math.PI * R

function Ring({ progress, children }: { progress: number; children: ReactNode }) {
  return (
    <div className="ft-ring">
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle className="ft-track" cx="50" cy="50" r={R} />
        <circle className="ft-fill" cx="50" cy="50" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
      </svg>
      <div className="ft-ring-in">{children}</div>
    </div>
  )
}

const Icon = ({ d, label, onClick }: { d: string; label: string; onClick: () => void }) => (
  <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick}>
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d={d} />
    </svg>
  </button>
)

const MINI = 'M3 9.5h10'
const EXPAND = 'M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9'
const FULL = 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10'
const UNFULL = 'M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5'

// Where the small card sits, from the bottom-right corner; kept in this browser.
const SPOT_KEY = 'duckbook:timer-spot'
const readSpot = () => {
  try {
    const v = JSON.parse(localStorage.getItem(SPOT_KEY) ?? 'null')
    return v && typeof v.right === 'number' && typeof v.bottom === 'number' ? (v as { right: number; bottom: number }) : { right: 22, bottom: 22 }
  } catch {
    return { right: 22, bottom: 22 }
  }
}

/** Drag the small card anywhere by its edge; a plain click still opens the timer. */
function useSpot() {
  const [spot, setSpot] = useState(readSpot)
  const [dragging, setDragging] = useState(false)
  const moved = useRef(false)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const start = { x: e.clientX, y: e.clientY, ...spot }
    const box = e.currentTarget.getBoundingClientRect()
    moved.current = false
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!moved.current && Math.hypot(dx, dy) < 4) return
      moved.current = true
      setDragging(true)
      setSpot({ right: Math.min(Math.max(8, start.right - dx), innerWidth - box.width - 8), bottom: Math.min(Math.max(8, start.bottom - dy), innerHeight - box.height - 8) })
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      setDragging(false)
      setSpot((s) => {
        try {
          localStorage.setItem(SPOT_KEY, JSON.stringify(s))
        } catch {
          // Storage off: the spot lasts until reload.
        }
        return s
      })
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  // A drag that ends over a button must not also press it.
  const onClickCapture = (e: ReactMouseEvent) => {
    if (moved.current) {
      e.stopPropagation()
      e.preventDefault()
      moved.current = false
    }
  }
  return { spot, dragging, onPointerDown, onClickCapture }
}

/**
 * The running pomodoro, over the notebook. Overlay: a card in the middle and the notebook dimmed.
 * Mini: a small card in a corner. Full: only the task and the clock, in OS fullscreen.
 */
export function FocusTimer() {
  const t = useTimer()
  const task = useStore((s) => (t.dayKey && t.taskId ? s.days[t.dayKey]?.tasks.find((x) => x.id === t.taskId) : undefined))
  const name = task?.text || t.label || 'Untitled task'
  const shown = t.phase !== 'idle' || !!t.taskId
  const view: TimerView = shown ? t.view : 'mini'
  const drag = useSpot()

  // Full screen follows the OS: leaving it (Esc) brings the card back.
  useEffect(() => {
    if (view !== 'full') {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      return
    }
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {})
    const onChange = () => !document.fullscreenElement && setView('overlay')
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [view])

  // Over the notebook, keys belong to the timer, so arrows don't turn pages underneath.
  useEffect(() => {
    if (!shown || view === 'mini') return
    const onKey = (e: KeyboardEvent) => {
      const onButton = !!(e.target as HTMLElement).closest('button')
      if (e.key === 'Tab' || ((e.key === 'Enter' || e.key === ' ') && onButton)) return
      if (e.key === 'Escape' && view === 'overlay') setView('mini')
      else if (e.key === ' ' && t.phase !== 'idle') togglePause()
      e.preventDefault()
      e.stopPropagation()
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [shown, view, t.phase])

  if (!shown) return null

  const ms = remainingMs(t)
  const progress = t.total ? 1 - ms / t.total : 0
  const planned = task ? Math.max(task.estimate, task.pomos) : 0

  const controls =
    t.phase === 'idle' ? (
      <div className="ft-actions">
        <button className="pomo-btn" onClick={() => startFocus(t.dayKey!, t.taskId!, name)}>
          Another round
        </button>
        <button className="pomo-btn ghost-dark" onClick={stop}>
          Done for now
        </button>
      </div>
    ) : (
      <div className="ft-actions">
        <button className="pomo-btn" onClick={togglePause}>
          {t.paused ? 'Resume' : 'Pause'}
        </button>
        {t.phase === 'focus' ? (
          <button className="pomo-btn ghost-dark" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="pomo-btn ghost-dark" onClick={endBreak}>
            Skip break
          </button>
        )}
      </div>
    )

  const switchAsk = t.switchTo && (
    <div className="ft-switch" role="alert">
      <span>
        Switch to <em>{t.switchTo.label}</em>? This block won’t count.
      </span>
      <span className="ft-switch-btns">
        <button className="pomo-btn" onClick={confirmSwitch}>
          Switch
        </button>
        <button className="pomo-btn ghost-dark" onClick={cancelSwitch}>
          Keep going
        </button>
      </span>
    </div>
  )

  const phaseLabel = t.phase === 'focus' ? 'Focus' : t.phase === 'break' ? 'Break' : 'Break’s over'
  const cls = `focus-timer ft-${view} phase-${t.phase} ${t.paused ? 'is-paused' : ''}`

  if (view === 'mini') {
    return createPortal(
      <div
        className={`${cls} ${drag.dragging ? 'is-dragging' : ''}`}
        role="timer"
        aria-label={`${phaseLabel}: ${name}`}
        style={{ right: drag.spot.right, bottom: drag.spot.bottom }}
        onPointerDown={drag.onPointerDown}
        onClickCapture={drag.onClickCapture}
      >
        <button className="ft-mini-main" onClick={() => setView('overlay')} title="Open the timer">
          <Ring progress={progress}>
            <span className="ft-dot" />
          </Ring>
          <span className="ft-mini-text">
            <span className="ft-mini-time">{t.phase === 'idle' ? '—' : fmt(ms)}</span>
            <span className="ft-mini-name">{t.phase === 'break' ? 'Break' : name}</span>
          </span>
        </button>
        {t.phase !== 'idle' && <Icon d={t.paused ? 'M5 3.5 12 8l-7 4.5Z' : 'M5.5 3.5v9M10.5 3.5v9'} label={t.paused ? 'Resume' : 'Pause'} onClick={togglePause} />}
        <Icon d={EXPAND} label="Open the timer" onClick={() => setView('overlay')} />
        {switchAsk}
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className={cls} role="dialog" aria-modal="true" aria-label={`${phaseLabel}: ${name}`}>
      {view === 'overlay' && <div className="ft-backdrop" onClick={() => setView('mini')} />}
      <div className="ft-card">
        <div className="ft-top">
          <span className="ft-phase">{phaseLabel}</span>
          <span className="ft-views">
            {view === 'overlay' && <Icon d={MINI} label="Make it small (Esc)" onClick={() => setView('mini')} />}
            {view === 'overlay' ? <Icon d={FULL} label="Full screen" onClick={() => setView('full')} /> : <Icon d={UNFULL} label="Leave full screen" onClick={() => setView('overlay')} />}
          </span>
        </div>
        <h2 className="ft-name ink">{t.phase === 'break' ? 'Stand up, breathe, look away.' : name}</h2>
        <Ring progress={t.phase === 'idle' ? 1 : progress}>
          <span className="ft-time">{t.phase === 'idle' ? '✓' : fmt(ms)}</span>
          {t.paused && <span className="ft-paused">paused</span>}
        </Ring>
        {planned > 0 && (
          <div className="ft-rounds" aria-label={`${task!.pomos} of ${planned} pomodoros done`}>
            {Array.from({ length: planned }, (_, i) => (
              <span key={i} className={i < task!.pomos ? 'is-done' : ''} />
            ))}
          </div>
        )}
        {t.phase === 'idle' && <p className="ft-note">Another round of {name}?</p>}
        {controls}
        {switchAsk}
      </div>
    </div>,
    document.body,
  )
}
