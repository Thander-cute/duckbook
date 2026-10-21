import { useLayoutEffect, useRef, type ReactNode, type KeyboardEvent } from 'react'

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

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="label">
      <span>{children}</span>
      {hint && <span className="label-hint">{hint}</span>}
    </div>
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
