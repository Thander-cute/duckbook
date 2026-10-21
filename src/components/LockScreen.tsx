import { useEffect, useRef, useState } from 'react'
import { parkedCount, unlock, useSession } from '../lib/store'

/** Blank, softly blurred shell with a 6-digit PIN pad. No notebook content is mounted behind it. */
export function LockScreen() {
  const { status } = useSession()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [waitUntil, setWaitUntil] = useState(() => Date.now() + (status?.retryAfterMs ?? 0))
  const [now, setNow] = useState(Date.now())
  const input = useRef<HTMLInputElement>(null)

  const waiting = waitUntil > now
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [waiting])

  useEffect(() => input.current?.focus(), [busy, waiting])

  const submit = async (value: string) => {
    setBusy(true)
    const r = await unlock(value)
    setBusy(false)
    if (r.ok) return
    setPin('')
    setError(r.error)
    if (r.retryAfterMs) {
      setWaitUntil(Date.now() + r.retryAfterMs)
      setNow(Date.now())
    }
  }

  return (
    <div className="lock-shell" onClick={() => input.current?.focus()}>
      <div className="lock-card" role="dialog" aria-label="Unlock duckbook">
        <div className="wordmark">
          <em>duck</em>book
        </div>
        <label className="lock-label" htmlFor="pin">
          {waiting ? `Wait ${Math.ceil((waitUntil - now) / 1000)}s` : 'Enter your PIN'}
        </label>
        <div className={`pin-dots ${error && !pin ? 'is-wrong' : ''}`} aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={i < pin.length ? 'is-on' : ''} />
          ))}
        </div>
        <input
          ref={input}
          id="pin"
          className="pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          disabled={busy || waiting}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6)
            setPin(v)
            setError('')
            if (v.length === 6) void submit(v)
          }}
        />
        <p className="lock-error" role="alert">
          {error && !waiting ? error : ' '}
        </p>
        {parkedCount() > 0 && (
          <p className="muted small">
            {parkedCount()} edited {parkedCount() === 1 ? 'page' : 'pages'} will be saved after you unlock. Keep this tab open.
          </p>
        )}
      </div>
    </div>
  )
}
