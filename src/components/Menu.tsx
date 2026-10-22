import { useEffect, useRef, useState } from 'react'
import { Popover } from './Popover'

export interface MenuOption<T> {
  value: T
  label: string
  hint?: string
}

/** A choice from a short list, in the notebook's own style instead of the browser's dropdown. */
export function Menu<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: T
  options: MenuOption<T>[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (open) (list.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? list.current?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus()
  }, [open])

  const pick = (v: T) => {
    setOpen(false)
    if (v !== value) onChange(v)
    btn.current?.focus()
  }

  return (
    <>
      <button
        ref={btn}
        className={`menu-btn ${open ? 'is-open' : ''} ${className}`}
        aria-label={`${label}: ${current?.label ?? ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            e.stopPropagation()
            setOpen(true)
          }
        }}
      >
        {current?.label ?? label}
        <span className="menu-caret" aria-hidden>
          ⌄
        </span>
      </button>
      {open && btn.current && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} label={label} className="menu-pop">
          <div
            ref={list}
            role="menu"
            aria-label={label}
            onKeyDown={(e) => {
              const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
              const i = items.indexOf(document.activeElement as HTMLElement)
              let next = -1
              if (e.key === 'ArrowDown') next = (i + 1) % items.length
              else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length
              else if (e.key === 'Home') next = 0
              else if (e.key === 'End') next = items.length - 1
              else if (e.key.length === 1) next = items.findIndex((el) => el.textContent?.trim().toLowerCase().startsWith(e.key.toLowerCase()))
              if (next < 0) return
              e.preventDefault()
              e.stopPropagation()
              items[next].focus()
            }}
          >
            {options.map((o) => (
              <button key={String(o.value)} role="menuitemradio" aria-checked={o.value === value} className="menu-item" onClick={() => pick(o.value)}>
                <span className="menu-check" aria-hidden>
                  {o.value === value ? '✓' : ''}
                </span>
                <span>{o.label}</span>
                {o.hint && <span className="menu-hint">{o.hint}</span>}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}
