import { useRef } from 'react'
import { getState, replaceState, update, useSettings, type State } from '../lib/store'
import { todayKey } from '../lib/date'

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  const fileRef = useRef<HTMLInputElement>(null)

  const exportData = () => {
    const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `duckbook-${todayKey()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importData = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as State
      if (!data || typeof data !== 'object' || !('days' in data)) throw new Error()
      if (confirm('Replace everything in this planner with the imported file?')) replaceState(data)
    } catch {
      alert('That file doesn’t look like a duckbook export.')
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="settings" aria-label="Settings">
        <header>
          <h2>
            <span className="caps-word">SETTINGS</span>
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="setting">
          <div className="label">Ink</div>
          <div className="seg">
            {(['serif', 'hand'] as const).map((ink) => (
              <button
                key={ink}
                className={s.ink === ink ? 'is-on' : ''}
                onClick={() => update((st) => void (st.settings.ink = ink))}
                data-ink-sample={ink}
              >
                {ink === 'serif' ? 'Serif' : 'Handwritten'}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <div className="label">Pomodoro</div>
          <div className="pomo-settings">
            <label>
              <input
                type="number"
                min={5}
                max={90}
                value={s.focusMin}
                onChange={(e) => update((st) => void (st.settings.focusMin = clamp(+e.target.value, 5, 90)))}
              />
              min focus
            </label>
            <label>
              <input
                type="number"
                min={1}
                max={30}
                value={s.breakMin}
                onChange={(e) => update((st) => void (st.settings.breakMin = clamp(+e.target.value, 1, 30)))}
              />
              min break
            </label>
          </div>
        </div>

        <div className="setting">
          <div className="label">Your pages</div>
          <p className="muted small">Everything stays in this browser. Export now and then to keep a copy.</p>
          <div className="row-btns">
            <button className="text-btn" onClick={exportData}>
              Export JSON
            </button>
            <button className="text-btn" onClick={() => fileRef.current?.click()}>
              Import…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])}
            />
          </div>
        </div>

        <div className="setting">
          <div className="label">Keys</div>
          <dl className="keys">
            <dt>← →</dt>
            <dd>Previous / next</dd>
            <dt>T</dt>
            <dd>Today</dd>
            <dt>M W D R</dt>
            <dd>Month, Week, Day, Reflect</dd>
          </dl>
        </div>
      </aside>
    </>
  )
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)
