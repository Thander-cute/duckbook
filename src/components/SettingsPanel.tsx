import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { flush, lock, reloadAll, reloadStatus, update, useSession, useSettings } from '../lib/store'
import { migrateLegacy, removeLegacy, type LegacyInfo } from '../lib/legacy'
import { todayKey } from '../lib/date'
import type { Summary } from '../lib/schema'
import { describe } from './Gates'

interface Backup { file: string; kind: string; createdAt: string; docs: number; bytes: number; verified: boolean }

const KIND: Record<string, string> = {
  auto: 'Automatic',
  manual: 'Manual',
  'pre-import': 'Before import',
  'pre-migration': 'Before moving browser pages',
  'pre-restore': 'Before restore',
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function SettingsPanel({ onClose, legacy, onLegacyChange }: { onClose: () => void; legacy: LegacyInfo | null; onLegacyChange: () => void }) {
  const s = useSettings()
  const { status } = useSession()

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
              <button key={ink} className={s.ink === ink ? 'is-on' : ''} onClick={() => update((st) => void (st.settings.ink = ink))} data-ink-sample={ink}>
                {ink === 'serif' ? 'Serif' : 'Handwritten'}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <div className="label">Pomodoro</div>
          <div className="pomo-settings">
            <label>
              <input type="number" min={5} max={90} value={s.focusMin} onChange={(e) => update((st) => void (st.settings.focusMin = clamp(+e.target.value, 5, 90)))} />
              min focus
            </label>
            <label>
              <input type="number" min={1} max={30} value={s.breakMin} onChange={(e) => update((st) => void (st.settings.breakMin = clamp(+e.target.value, 1, 30)))} />
              min break
            </label>
          </div>
        </div>

        <PrivacyLock pinEnabled={!!status?.pinEnabled} autoLockMin={status?.autoLockMin ?? 15} />
        <Backups />
        <DataSection dataDir={status?.dataDir} />
        {legacy && <OldBrowserCopy legacy={legacy} onChange={onLegacyChange} />}

        <div className="setting">
          <div className="label">Keys</div>
          <dl className="keys">
            <dt>← →</dt>
            <dd>Previous / next</dd>
            <dt>T</dt>
            <dd>Today</dd>
            <dt>M W D R</dt>
            <dd>Month, Week, Day, Reflect</dd>
            {status?.pinEnabled && (
              <>
                <dt>L</dt>
                <dd>Lock now</dd>
              </>
            )}
          </dl>
        </div>
      </aside>
    </>
  )
}

function PinField({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <label className="pin-field">
      <span>{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </label>
  )
}

function PrivacyLock({ pinEnabled, autoLockMin }: { pinEnabled: boolean; autoLockMin: number }) {
  const [mode, setMode] = useState<'idle' | 'set' | 'change' | 'remove'>('idle')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [msg, setMsg] = useState('')

  const reset = () => {
    setMode('idle')
    setCurrent('')
    setNext('')
    setAgain('')
  }

  const save = async () => {
    if (mode !== 'remove' && (next.length !== 6 || next !== again)) return setMsg(next.length !== 6 ? 'Use exactly 6 digits.' : 'The two PINs don’t match.')
    try {
      await api('PUT', '/api/lock-settings', { currentPin: current || undefined, pin: mode === 'remove' ? null : next })
      setMsg(mode === 'remove' ? 'PIN removed.' : 'PIN saved.')
      reset()
      await reloadStatus()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const setAuto = async (min: number) => {
    await api('PUT', '/api/lock-settings', { autoLockMin: min })
    await reloadStatus()
  }

  return (
    <div className="setting">
      <div className="label">Privacy lock</div>
      {mode === 'idle' ? (
        pinEnabled ? (
          <>
            <div className="row-btns">
              <button className="text-btn" onClick={() => void lock()}>
                Lock now
              </button>
              <button className="text-btn" onClick={() => setMode('change')}>
                Change PIN
              </button>
              <button className="text-btn" onClick={() => setMode('remove')}>
                Turn off
              </button>
            </div>
            <label className="inline-select">
              Lock after
              <select value={autoLockMin} onChange={(e) => void setAuto(+e.target.value)}>
                {[1, 5, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} min idle
                  </option>
                ))}
                <option value={0}>only when I lock</option>
              </select>
            </label>
          </>
        ) : (
          <button className="text-btn" onClick={() => setMode('set')}>
            Set a 6-digit PIN
          </button>
        )
      ) : (
        <div className="pin-form">
          {mode !== 'set' && <PinField label="Current PIN" value={current} onChange={setCurrent} autoFocus />}
          {mode !== 'remove' && (
            <>
              <PinField label="New PIN" value={next} onChange={setNext} autoFocus={mode === 'set'} />
              <PinField label="Again" value={again} onChange={setAgain} />
            </>
          )}
          <div className="row-btns">
            <button className="text-btn" onClick={() => void save()}>
              {mode === 'remove' ? 'Turn off lock' : 'Save PIN'}
            </button>
            <button className="text-btn" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <p className="small setting-msg">{msg}</p>}
      <p className="muted small">
        The PIN hides your pages in the browser and is checked by the duckbook server. It is not encryption: anyone, or any program, that can open files on this
        computer can still read the database.
      </p>
    </div>
  )
}

function Backups() {
  const [list, setList] = useState<Backup[] | null>(null)
  const [dir, setDir] = useState('')
  const [msg, setMsg] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const r = await api<{ backups: Backup[]; dir: string }>('GET', '/api/backups')
    setList(r.backups)
    setDir(r.dir)
  }
  useEffect(() => void load().catch((e) => setMsg((e as Error).message)), [])

  const backUp = async () => {
    setBusy(true)
    try {
      await flush()
      await api('POST', '/api/backups')
      setMsg('Backup saved and verified.')
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (file: string) => {
    setBusy(true)
    try {
      await flush()
      const r = await api<{ summary: Summary }>('POST', '/api/backups/restore', { file })
      await reloadAll()
      setMsg(`Restored and verified: ${describe(r.summary)}. Your pages from just before are in a “Before restore” backup.`)
      setConfirm(null)
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setting">
      <div className="label">Backups</div>
      <p className="muted small">Automatic every few hours while pages change, and before any import or restore.</p>
      <div className="row-btns">
        <button className="text-btn" disabled={busy} onClick={() => void backUp()}>
          Back up now
        </button>
      </div>
      {list && list.length > 0 && (
        <ul className="backup-list">
          {list.slice(0, 12).map((b) => (
            <li key={b.file}>
              <span>
                {fmtTime(b.createdAt)}
                <span className="muted small"> · {KIND[b.kind] ?? b.kind} · {b.docs} pages</span>
              </span>
              {confirm === b.file ? (
                <span className="confirm">
                  <button className="text-btn" disabled={busy} onClick={() => void restore(b.file)}>
                    Restore
                  </button>
                  <button className="text-btn" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="text-link" onClick={() => setConfirm(b.file)}>
                  restore…
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirm && <p className="small setting-msg">Restoring replaces all current pages. They are backed up first.</p>}
      {msg && <p className="small setting-msg">{msg}</p>}
      {dir && (
        <p className="muted small path">
          Stored in <code>{dir}</code>. Backups sit on this same computer: copy that folder elsewhere to survive a lost or broken disk.
        </p>
      )}
    </div>
  )
}

function DataSection({ dataDir }: { dataDir?: string }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ data: unknown; summary: Summary; issueCount: number; existing: number } | null>(null)
  const [msg, setMsg] = useState('')

  const exportData = async () => {
    await flush()
    const data = await api('GET', '/api/export')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `duckbook-${todayKey()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const pick = async (file: File) => {
    setMsg('')
    try {
      const data = JSON.parse(await file.text())
      const r = await api<{ summary: Summary; issueCount: number; existingPages: number }>('POST', '/api/import/preview', { data })
      setPending({ data, summary: r.summary, issueCount: r.issueCount, existing: r.existingPages })
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'That file isn’t readable duckbook data.')
    }
  }

  const apply = async () => {
    try {
      await flush()
      const r = await api<{ summary: Summary }>('POST', '/api/import', { data: pending!.data, source: 'file', replace: true })
      await reloadAll()
      setMsg(`Imported: ${describe(r.summary)}. Your previous pages are in a “Before import” backup.`)
      setPending(null)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <div className="setting">
      <div className="label">Your pages</div>
      {dataDir && (
        <p className="muted small path">
          Database: <code>{dataDir}</code>
        </p>
      )}
      <div className="row-btns">
        <button className="text-btn" onClick={() => void exportData()}>
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
          onChange={(e) => {
            if (e.target.files?.[0]) void pick(e.target.files[0])
            e.target.value = ''
          }}
        />
      </div>
      <p className="muted small">Exported files are plain, readable text. Keep them somewhere private.</p>
      {pending && (
        <div className="confirm-box">
          <p className="small">
            File holds <strong>{describe(pending.summary)}</strong>
            {pending.issueCount ? `, with ${pending.issueCount} odd values that will be kept aside` : ''}.{' '}
            {pending.existing ? 'Importing replaces all current pages (backed up first).' : ''}
          </p>
          <div className="row-btns">
            <button className="text-btn" onClick={() => void apply()}>
              {pending.existing ? 'Replace my pages' : 'Import'}
            </button>
            <button className="text-btn" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <p className="small setting-msg">{msg}</p>}
    </div>
  )
}

function OldBrowserCopy({ legacy, onChange }: { legacy: LegacyInfo; onChange: () => void }) {
  const [msg, setMsg] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmMove, setConfirmMove] = useState(false)

  const move = async () => {
    try {
      await flush()
      const summary = await migrateLegacy(true)
      await reloadAll()
      setMsg(`Moved and verified: ${describe(summary)}. Your previous database pages are in a backup.`)
      setConfirmMove(false)
      onChange()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <div className="setting">
      <div className="label">Old browser copy</div>
      {legacy.error ? (
        <p className="small">Pages from the earlier version are in this browser but can’t be read ({legacy.error}). They are left untouched.</p>
      ) : legacy.migrated ? (
        <p className="small">Your earlier browser pages ({describe(legacy.summary!)}) are safely in the database. The old copy is still kept in this browser.</p>
      ) : (
        <p className="small">
          This browser holds pages from the earlier version ({describe(legacy.summary!)}) that are not what your database has.
        </p>
      )}
      <div className="row-btns">
        {!legacy.migrated && !legacy.error && (
          <button className="text-btn" onClick={() => setConfirmMove(true)}>
            Move them in…
          </button>
        )}
        {legacy.migrated && (
          <button className="text-btn" onClick={() => setConfirmRemove(true)}>
            Remove old copy…
          </button>
        )}
      </div>
      {confirmMove && (
        <div className="confirm-box">
          <p className="small">This replaces all pages in the database with the browser copy. Current database pages are backed up first.</p>
          <div className="row-btns">
            <button className="text-btn" onClick={() => void move()}>
              Replace with browser copy
            </button>
            <button className="text-btn" onClick={() => setConfirmMove(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirmRemove && (
        <div className="confirm-box">
          <p className="small">Delete the old copy from this browser? The database and its backups are not affected.</p>
          <div className="row-btns">
            <button
              className="text-btn"
              onClick={() => {
                removeLegacy()
                setConfirmRemove(false)
                onChange()
              }}
            >
              Remove
            </button>
            <button className="text-btn" onClick={() => setConfirmRemove(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <p className="small setting-msg">{msg}</p>}
    </div>
  )
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)
