import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { markSeen, useTourSeen } from '../lib/tour'

type Step = { target: string; title: string; text: string }

// First-visit tips, one short tour per page. The pages themselves stay free of how-to text.
export const TOURS: Record<string, Step[]> = {
  month: [
    { target: '.theme', title: 'Name the month', text: 'A word, a feeling, a direction. Your weekly reflection holds it up as a mirror.' },
    { target: '.cal-3', title: 'Notes across days', text: 'Drag from one day to another to draw a line, then write on it. A line can run into next month.' },
    { target: '.cal-wk', title: 'Each week at a glance', text: 'The week number opens that week. Once a week has a goal or a reflection, a small mark here lets you peek at it.' },
  ],
  week: [
    { target: '.brain-dump', title: 'Empty your head', text: 'Jot down every task for the week here: meetings, deadlines, ideas. Press Enter after each one.' },
    { target: '.matrix', title: 'Sort what matters', text: 'Drag each task into a box. Important and urgent goes in A, important but not urgent in B. Start with A, make room for B.' },
    { target: '.habits', title: 'Habits', text: 'Add a few habits and tick each day you keep them.' },
  ],
  day: [
    { target: '.tasks', title: 'A few tasks for today', text: 'Press Enter to add one. The numbers are pomodoros: estimate, then fill a circle per focus block.' },
    { target: '.pull', title: 'From your plan', text: 'Tasks planned for today, or waiting in A and B this week. Click one to add it to today.' },
    { target: '.day-photos', title: 'Keep a photo', text: 'Up to three a day. Click to choose, or drop or paste one in. The month page marks the day.' },
  ],
  reflect: [
    { target: '.prompt', title: 'Look at the week', text: 'Four short prompts: how it felt, what went well, what you learned, what to change.' },
    { target: '.sentences', title: 'Seven sentences', text: 'Your one-sentence days, gathered from each Day page.' },
    { target: '.month-mirror', title: 'Hold it to the month', text: 'Do this week’s actions still fit the month’s theme and goals?' },
  ],
  focus: [
    { target: '.focus-board .pad', title: 'Write an idea', text: 'Type it and press Enter to tear the note off the pad.' },
    { target: '.canvas', title: 'Place it', text: 'Drag notes onto the map: higher matters more, further right is easier. Drag one back to the tray to take it off.' },
    { target: '.filters', title: 'Follow through', text: 'Select a note to start it, give it a date or plan it into a week. Filter by state here.' },
  ],
}

export function Tour({ page }: { page: string }) {
  const seen = useTourSeen(page)
  const steps = TOURS[page]
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [closing, setClosing] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(0)
  const active = !!steps && !seen
  const shown = useRef(false)
  shown.current = !!rect

  useEffect(() => {
    setI(0)
    setClosing(false)
  }, [page, active])

  // Find this step's target once the page has drawn; skip steps whose target isn't there.
  useEffect(() => {
    if (!active) return setRect(null)
    let el: Element | null = null
    const measure = () => el && setRect(el.getBoundingClientRect())
    const t = setTimeout(
      () => {
        let n = i
        while (n < steps.length && !(el = document.querySelector(steps[n].target))) n++
        if (n >= steps.length) return markSeen(page)
        if (n !== i) return setI(n)
        el!.scrollIntoView({ block: 'nearest' })
        measure()
      },
      shown.current ? 0 : 200,
    )
    addEventListener('resize', measure)
    addEventListener('scroll', measure, true)
    return () => {
      clearTimeout(t)
      removeEventListener('resize', measure)
      removeEventListener('scroll', measure, true)
    }
  }, [active, i, page, steps])

  // Measured before paint, so the card never shows at a guessed spot first.
  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight)
  }, [rect, i])

  // Fade out, then remember.
  const close = (...pages: string[]) => {
    setClosing(true)
    setTimeout(() => markSeen(...pages), 220)
  }
  const last = !!steps && i >= steps.length - 1
  const next = () => (last ? close(page) : setI(i + 1))
  const skip = () => close(...Object.keys(TOURS))

  useEffect(() => {
    if (!active || !rect || closing) return
    // Capture phase, so Enter or arrows don't also flip the page underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(page)
      else if (e.key === 'Enter' || e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') setI(Math.max(0, i - 1))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  })

  if (!active || !rect) return null
  const step = steps[i]
  const pad = 6
  const below = rect.bottom + 14 + cardH < innerHeight - 8
  const top = below ? rect.bottom + 14 : Math.max(8, rect.top - 14 - cardH)
  const left = Math.min(Math.max(12, rect.left), innerWidth - 332)

  return createPortal(
    <div className={`tour ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={`Tour: ${step.title}`}>
      <div className="tour-ring" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div ref={card} className={`tour-card ${cardH ? 'is-placed' : ''}`} style={{ left, top }}>
        <div key={i} className="tour-body">
          <div className="tour-count">
            {i + 1} / {steps.length}
          </div>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
        </div>
        <div className="tour-actions">
          <button className="text-link" onClick={skip}>
            Skip tour
          </button>
          <button className="tour-next" onClick={next} autoFocus>
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
