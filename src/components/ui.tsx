import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react'

/** A textarea that grows with its content — the app's universal "place to write". */
export function Write({
  value,
  onChange,
  placeholder,
  className = '',
  rows = 1,
  onKeyDown,
  autoFocus,
  ariaLabel,
  singleLine,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  rows?: number
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  autoFocus?: boolean
  ariaLabel?: string
  singleLine?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      className={`write ink ${className}`}
      value={value}
      rows={rows}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      autoFocus={autoFocus}
      spellCheck={false}
      onChange={(e) => onChange(singleLine ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
      onKeyDown={(e) => {
        if (singleLine && e.key === 'Enter' && !onKeyDown) {
          e.preventDefault()
          ;(e.target as HTMLTextAreaElement).blur()
        }
        onKeyDown?.(e)
      }}
    />
  )
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`check ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <svg viewBox="0 0 16 16" aria-hidden>
        <path d="M3.5 8.5 L7 12 L13.5 3.5" />
      </svg>
    </button>
  )
}

/** Page heading in the book's voice: a numbered circle, CAPS word, italic word. */
export function PageTitle({ step, caps, italic, children }: { step?: string; caps: string; italic: string; children?: ReactNode }) {
  return (
    <header className="page-title">
      <h2>
        {step && <span className="step-num">{step}</span>}
        <span className="caps-word">{caps}</span> <em>{italic}</em>
      </h2>
      {children}
    </header>
  )
}

export function Label({ children, hint, info }: { children: ReactNode; hint?: string; info?: string }) {
  return (
    <div className="label">
      <span>
        {children}
        {info && <Info text={info} />}
      </span>
      {hint && <span className="label-hint">{hint}</span>}
    </div>
  )
}

/** A small (i): the how-to shows on hover or focus instead of always. */
export function Info({ text }: { text: string }) {
  return (
    <span className="info" tabIndex={0} role="note" aria-label={text} data-tip={text}>
      i
    </span>
  )
}

/** The second step of removing something: a bin to confirm, an arrow to keep it. */
export function ConfirmRemove({ what, onRemove, onKeep, className = '' }: { what: string; onRemove: () => void; onKeep: () => void; className?: string }) {
  return (
    <span className={`confirm-remove ${className}`} role="group" aria-label={`Remove ${what}?`}>
      <button type="button" className="icon-btn is-danger" aria-label={`Remove ${what}`} title="Remove" onClick={onRemove} autoFocus>
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.8 7v4M9.2 7v4" />
        </svg>
      </button>
      <button type="button" className="icon-btn" aria-label="Keep it" title="Keep" onClick={onKeep}>
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7" />
        </svg>
      </button>
    </span>
  )
}

/** A labelled single line, like "Today I am grateful for: ________". */
export function Line({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="line">
      <span className="line-label">{label}</span>
      <Write value={value} onChange={onChange} placeholder={placeholder} singleLine ariaLabel={label} />
    </label>
  )
}

export function Spread({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`spread ${className}`}>
      {children}
      <div className="gutter" aria-hidden />
    </div>
  )
}

export function Page({ children, className = '', side }: { children: ReactNode; className?: string; side: 'left' | 'right' }) {
  return <section className={`page page-${side} ${className}`}>{children}</section>
}

/** − n + for a whole number. Typing is free; the value is kept in range when you leave the field. */
export function Stepper({ value, onChange, min, max, step = 1, label, unit }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string; unit?: string }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (v: number) => {
    const n = Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : value)))
    setDraft(String(n))
    if (n !== value) onChange(n)
  }
  return (
    <span className="stepper">
      <button type="button" aria-label={`Less ${label}`} disabled={value <= min} onClick={() => commit(value - step)}>
        −
      </button>
      <input
        inputMode="numeric"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
        onBlur={() => commit(parseInt(draft, 10))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            commit(value + (e.key === 'ArrowUp' ? step : -step))
          }
        }}
      />
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => commit(value + step)}>
        +
      </button>
      {unit && <span className="stepper-unit">{unit}</span>}
    </span>
  )
}
