import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A small paper card floating next to `anchor`. Rendered on <body> so tilted notes and sticky
 * columns can't clip or skew it. Closes on Escape or a press outside (the anchor toggles itself).
 */
export function Popover({ anchor, onClose, children, className = '', label, beside = false }: { anchor: HTMLElement; onClose: () => void; children: ReactNode; className?: string; label: string; beside?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.getBoundingClientRect()
      const el = box.current
      if (!el) return
      const { width: w, height: h } = el.getBoundingClientRect()
      if (beside) {
        setPos({ left: Math.min(a.right + 8, innerWidth - w - 8), top: Math.min(Math.max(8, a.top - 10), innerHeight - h - 8) })
        return
      }
      let top = a.bottom + 6
      if (top + h > innerHeight - 8 && a.top - h - 6 > 8) top = a.top - h - 6
      const left = Math.min(Math.max(8, a.left), innerWidth - w - 8)
      setPos({ left, top })
    }
    place()
    addEventListener('resize', place)
    addEventListener('scroll', place, true)
    return () => {
      removeEventListener('resize', place)
      removeEventListener('scroll', place, true)
    }
  }, [anchor, beside])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !anchor.contains(t)) close.current()
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [anchor])

  return createPortal(
    <div
      ref={box}
      className={`popover ${className}`}
      role="dialog"
      aria-label={label}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close.current()
          anchor.focus()
        }
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

/** Lets a surrounding "click outside closes me" handler ignore presses inside a popover. */
export const inPopover = (t: EventTarget | null) => t instanceof Element && !!t.closest('.popover')
