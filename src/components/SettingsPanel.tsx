import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '../lib/api'
import { flush, lock, reloadAll, reloadStatus, update, useSession, useSettings } from '../lib/store'
import { migrateLegacy, removeLegacy, type LegacyInfo } from '../lib/legacy'
import { todayKey } from '../lib/date'
import type { Summary } from '../lib/schema'
import { describe } from './Gates'
import { Menu } from './Menu'
import { getPaper, setPaper } from '../lib/paper'
import { setHabitMark, useHabitMark } from '../lib/habitMark'
import { resetTour } from '../lib/tour'
import { HabitMark } from './HabitMark'
import { Stepper } from './ui'
import { setDefaultView, useDefaultView, type TimerView } from '../lib/timer'
import { loadSync, syncAction, syncNow, useSync } from '../lib/sync'

interface Backup { file: string; kind: string; createdAt: string; docs: number; bytes: number; verified: boolean }

const KIND: Record<string, string> = {
  auto: 'Automatic',
  manual: 'Manual',
  'pre-import': 'Before import',
  'pre-migration': 'Before moving browser pages',
  'pre-restore': 'Before restore',
  'pre-sync': 'Before taking the Drive notebook',
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export type SettingsSection = 'notebook' | 'timer' | 'keys' | 'privacy' | 'data' | 'addons'

const TIMER_VIEWS: { key: TimerView; label: string }[] = [
  { key: 'overlay', label: 'Over the page' },
  { key: 'mini', label: 'Small' },
  { key: 'full', label: 'Full screen' },
]

// Thin ink icons for the index, one per section.
const ICONS: Record<SettingsSection, string> = {
  notebook: 'M4 3.5h8.5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4zM4 3.5v13M7 7h4',
  timer: 'M10 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM10 8v3l2 1.5M8.5 3h3',
  keys: 'M3 6.5h14v8H3zM6 9.5h.01M9 9.5h.01M12 9.5h.01M14.5 9.5h.01M7 12h6',
  privacy: 'M5.5 9h9v7.5h-9zM7.5 9V6.8a2.5 2.5 0 0 1 5 0V9',
  data: 'M10 3.5c3.3 0 6 1 6 2.2v8.6c0 1.2-2.7 2.2-6 2.2s-6-1-6-2.2V5.7c0-1.2 2.7-2.2 6-2.2zM4 5.7c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2M4 10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2',
  addons: 'M10 3.5l1.6 4.4 4.4 1.6-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6z',
}

const GROUPS: { title: string; items: { key: SettingsSection; label: string }[] }[] = [
  { title: 'Notebook', items: [{ key: 'notebook', label: 'Look & feel' }, { key: 'timer', label: 'Focus timer' }, { key: 'keys', label: 'Shortcuts' }] },
  { title: 'This computer', items: [{ key: 'privacy', label: 'Privacy' }, { key: 'data', label: 'Data' }] },
  { title: 'Extras', items: [{ key: 'addons', label: 'Add-ons' }] },
]
const LABEL = Object.fromEntries(GROUPS.flatMap((g) => g.items.map((x) => [x.key, x.label]))) as Record<SettingsSection, string>

/** One setting: what it is on the left, the control on the right. */
function Row({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="sd-row">
      <div className="sd-row-text">
        <div className="sd-row-title">{title}</div>
        {help && <p className="sd-row-help">{help}</p>}
      </div>
      <div className="sd-row-control">{children}</div>
    </div>
  )
}

/** Settings as a dialog over the page you came from; ✕ or Esc returns to it. */
export function SettingsPage({
  section,
  onSection,
  onBack,
  legacy,
  onLegacyChange,
}: {
  section: SettingsSection
  onSection: (s: SettingsSection) => void
  onBack: () => void
  legacy: LegacyInfo | null
  onLegacyChange: () => void
}) {
  const s = useSettings()
  const [tourMsg, setTourMsg] = useState('')
  const [paper, setPaperState] = useState(getPaper)
  const habitMark = useHabitMark()
  const timerView = useDefaultView()
  const { status } = useSession()
  const current = LABEL[section] ? section : 'notebook'

  return (
    <div className="settings-dialog">
      <div className="sd-backdrop" onClick={onBack} />
      <section className="sheet settings" role="dialog" aria-modal="true" aria-label="Settings">
        <nav className="sd-nav" aria-label="Settings sections">
          <div className="sd-title">Settings</div>
          {GROUPS.map((g) => (
            <div key={g.title} className="sd-group">
              <div className="sd-group-title">{g.title}</div>
              {g.items.map((x) => (
                <button key={x.key} className={`sd-tab ${current === x.key ? 'is-on' : ''}`} aria-current={current === x.key ? 'page' : undefined} onClick={() => onSection(x.key)}>
                  <svg viewBox="0 0 20 20" aria-hidden>
                    <path d={ICONS[x.key]} />
                  </svg>
                  {x.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sd-body">
          <header className="sd-head">
            <h2>{LABEL[current]}</h2>
            <button className="icon-btn sd-close" onClick={onBack} aria-label="Close settings" title="Close (Esc)">
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </header>

          {current === 'notebook' && (
            <>
              <Row title="Ink" help="How your own writing looks on every page.">
                <div className="seg">
                  {(['serif', 'hand'] as const).map((ink) => (
                    <button key={ink} className={s.ink === ink ? 'is-on' : ''} onClick={() => update((st) => void (st.settings.ink = ink))} data-ink-sample={ink}>
                      {ink === 'serif' ? 'Serif' : 'Handwritten'}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="Paper" help="Blue ink on white, or cream paper on a linen desk. Kept in this browser, lock screen included.">
                <div className="seg">
                  {(['white', 'cream'] as const).map((p) => (
                    <button key={p} className={paper === p ? 'is-on' : ''} onClick={() => (setPaper(p), setPaperState(p))}>
                      <span className={`swatch swatch-${p}`} aria-hidden />
                      {p === 'white' ? 'White' : 'Cream'}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="Habit marks" help="How a done day looks in the habit tracker.">
                <div className="seg seg-marks">
                  {(['dot', 'hatch', 'tick'] as const).map((m) => (
                    <button key={m} className={habitMark === m ? 'is-on' : ''} onClick={() => setHabitMark(m)}>
                      <HabitMark on seed={`sample-${m}`} as={m} />
                      {m === 'dot' ? 'Ink dot' : m === 'hatch' ? 'Hatched' : 'Tick'}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="Tour" help={tourMsg || 'A few tips the first time you open each page.'}>
                <button className="text-btn" onClick={() => (resetTour(), setTourMsg('Each page shows its tour again on your next visit.'))}>
                  Show the tour again
                </button>
              </Row>
            </>
          )}

          {current === 'timer' && (
            <>
              <Row title="Focus" help="One block fills one circle on the Day page. Changes apply to the next block.">
                <Stepper label="minutes of focus" unit="min" value={s.focusMin} min={5} max={90} step={5} onChange={(v) => update((st) => void (st.settings.focusMin = v))} />
              </Row>
              <Row title="Break">
                <Stepper label="minutes of break" unit="min" value={s.breakMin} min={1} max={30} onChange={(v) => update((st) => void (st.settings.breakMin = v))} />
              </Row>
              <Row title="Open the timer" help="Over the page, small in a corner, or full screen. You can switch while it runs.">
                <div className="seg">
                  {TIMER_VIEWS.map((v) => (
                    <button key={v.key} className={timerView === v.key ? 'is-on' : ''} onClick={() => setDefaultView(v.key)}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </Row>
            </>
          )}

          {current === 'keys' && (
            <dl className="keys">
              <dt>← →</dt>
              <dd>Previous / next</dd>
              <dt>T</dt>
              <dd>Today</dd>
              <dt>M W D R</dt>
              <dd>Month, Week, Day, Reflect</dd>
              {s.modules.focusMap && (
                <>
                  <dt>F</dt>
                  <dd>Focus Map</dd>
                </>
              )}
              {status?.pinEnabled && (
                <>
                  <dt>L</dt>
                  <dd>Lock now</dd>
                </>
              )}
              <dt>Space</dt>
              <dd>Pause or resume the timer</dd>
              <dt>Esc</dt>
              <dd>Close settings, or make the timer small</dd>
            </dl>
          )}

          {current === 'privacy' && <PrivacyLock pinEnabled={!!status?.pinEnabled} autoLockMin={status?.autoLockMin ?? 15} />}

          {current === 'data' && (
            <>
              <SyncSection />
              <Backups />
              <DataSection dataDir={status?.dataDir} quarantineCount={status?.quarantineCount ?? 0} />
              {status?.desktop?.webImport && <FromBrowserVersion />}
              {legacy && <OldBrowserCopy legacy={legacy} onChange={onLegacyChange} />}
            </>
          )}

          {current === 'addons' && (
            <Row title="Focus Map" help="Sticky notes on an impact × difficulty map; plan the good ones into a week. Turning it off hides it and keeps your ideas.">
              <label className="module-toggle switch">
                <input type="checkbox" role="switch" checked={s.modules.focusMap} onChange={(e) => update((st) => void (st.settings.modules.focusMap = e.target.checked))} aria-label="Focus Map" />
                <span className="switch-track" aria-hidden />
              </label>
            </Row>
          )}
        </div>
      </section>
    </div>
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
            <div className="inline-select">
              Lock after
              <Menu
                label="Lock after"
                value={autoLockMin}
                options={[...[1, 5, 15, 30, 60].map((m) => ({ value: m, label: `${m} min idle` })), { value: 0, label: 'only when I lock' }]}
                onChange={(m) => void setAuto(m)}
              />
            </div>
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

function SyncSection() {
  const st = useSync()
  const [inspect, setInspect] = useState<{ hasNotebook: boolean; localPages: number } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'leave' | 'merge' | null>(null)
  const connected = !!st?.google.connected && !st.google.needsReconnect

  useEffect(() => void loadSync().catch(() => {}), [])
  // While Google's page is open in the browser, watch for the sign-in to land.
  useEffect(() => {
    if (!st?.google.connecting) return
    const t = window.setInterval(() => void loadSync().catch(() => {}), 2000)
    return () => window.clearInterval(t)
  }, [st?.google.connecting])
  useEffect(() => {
    if (!connected || st?.joined) return setInspect(null)
    void api<{ hasNotebook: boolean; localPages: number }>('POST', '/api/sync/inspect').then(setInspect, (e) => setMsg((e as Error).message))
  }, [connected, st?.joined])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setMsg('')
    try {
      await fn()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const connect = () =>
    run(async () => {
      const { authUrl } = await api<{ authUrl: string }>('POST', '/api/sync/connect')
      window.open(authUrl, '_blank', 'noopener')
      await loadSync()
    })
  const join = (mode: 'start' | 'replace' | 'merge') =>
    run(async () => {
      if (!(await flush())) throw new Error('Some edits aren’t saved yet (see the message at the top). Resolve that first, so nothing typed is lost.')
      const r = await syncAction<{ backup: string | null }>('/api/sync/join', { mode })
      if (mode !== 'start') await reloadAll()
      setConfirm(null)
      setMsg(r.backup ? 'This notebook now matches Drive. Your previous pages are in a “Before taking the Drive notebook” backup.' : 'Sync is on.')
    })
  const leave = (signOut: boolean) =>
    run(async () => {
      await syncAction('/api/sync/leave', { signOut })
      setConfirm(null)
      setMsg(signOut ? 'Sync is off and Google is signed out. Your pages stay here and in Drive.' : 'Sync is off. Your pages stay here and in Drive.')
    })

  if (!st) return null
  const g = st.google
  return (
    <div className="setting sync-setting">
      <div className="label">Sync with Google Drive</div>
      {!g.configured ? (
        <p className="muted small">Keeps this notebook the same on your other computers through your Google Drive. This copy of duckbook was built without a Google client, so it can’t connect yet.</p>
      ) : !connected ? (
        <>
          <p className="muted small">
            {g.needsReconnect ? 'Google access has ended. Connect again to keep syncing.' : 'Sign in with Google in your browser. duckbook only sees the files it makes in your Drive.'}
          </p>
          <div className="row-btns">
            <button className="text-btn" disabled={busy || g.connecting} onClick={() => void connect()}>
              {g.connecting ? 'Waiting for Google…' : g.needsReconnect ? 'Reconnect Google Drive…' : 'Connect Google Drive…'}
            </button>
          </div>
          {g.connectError && <p className="small setting-msg">{g.connectError}</p>}
        </>
      ) : !st.joined ? (
        <>
          <p className="muted small">Not encrypted: your pages are kept in a “Duckbook Sync” folder in your Google Drive, readable by Google and by anyone with your Google account.</p>
          {inspect && !inspect.hasNotebook && (
            <div className="row-btns">
              <button className="text-btn" disabled={busy} onClick={() => void join('start')}>
                Start syncing this notebook
              </button>
            </div>
          )}
          {inspect?.hasNotebook && (
            <>
              <p className="muted small">
                Your Drive already has a duckbook notebook.{' '}
                {inspect.localPages ? 'Take it here (this computer’s pages are backed up first), or merge both.' : 'Take it to this computer.'}
              </p>
              <div className="row-btns">
                <button className="text-btn" disabled={busy} onClick={() => void join('replace')}>
                  Use the notebook from Drive
                </button>
                {inspect.localPages > 0 && (
                  <button className="text-btn" disabled={busy} onClick={() => setConfirm('merge')}>
                    Merge both…
                  </button>
                )}
              </div>
              {confirm === 'merge' && (
                <p className="small setting-msg">
                  Pages from both are combined. Where both have different text in the same box, both texts are kept, one after the other.{' '}
                  <button className="text-btn" disabled={busy} onClick={() => void join('merge')}>
                    Merge
                  </button>{' '}
                  <button className="text-btn" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </p>
              )}
            </>
          )}
          <div className="row-btns">
            <button className="text-btn" disabled={busy} onClick={() => void leave(true)}>
              Sign out of Google
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small sync-state">
            {st.running ? 'Syncing…' : st.error ? `Not synced: ${st.error}` : st.lastSync ? `Synced ${fmtTime(st.lastSync)}` : 'Waiting to sync…'} · Not encrypted
          </p>
          <div className="row-btns">
            <button className="text-btn" disabled={busy || st.running} onClick={() => void run(syncNow)}>
              Sync now
            </button>
            <button className="text-btn" disabled={busy} onClick={() => setConfirm('leave')}>
              Stop syncing…
            </button>
          </div>
          {confirm === 'leave' && (
            <p className="small setting-msg">
              Pages stay on this computer and in Drive; they just stop updating each other.{' '}
              <button className="text-btn" disabled={busy} onClick={() => void leave(false)}>
                Stop
              </button>{' '}
              <button className="text-btn" disabled={busy} onClick={() => void leave(true)}>
                Stop and sign out
              </button>{' '}
              <button className="text-btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </p>
          )}
        </>
      )}
      {msg && <p className="small setting-msg">{msg}</p>}
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
      if (!(await flush())) return setMsg('Some edits aren’t saved yet (see the message at the top). Resolve that first, so nothing typed is lost.')
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
          {list.map((b) => (
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
                <button className="text-btn restore-open" onClick={() => setConfirm(b.file)}>
                  Restore…
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirm && <p className="small setting-msg">Restoring replaces all current pages. They are backed up first.</p>}
      {msg && <p className="small setting-msg">{msg}</p>}
      {dir && (
        <details className="path">
          <summary>Show folder</summary>
          <p className="muted small">
            <code>{dir}</code>
            <br />
            Backups sit on this same computer: copy that folder elsewhere to survive a lost or broken disk.
          </p>
        </details>
      )}
    </div>
  )
}

function DataSection({ dataDir, quarantineCount }: { dataDir?: string; quarantineCount: number }) {
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
      if (!(await flush())) return setMsg('Some edits aren’t saved yet (see the message at the top). Resolve that first, so nothing typed is lost.')
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
        <details className="path">
          <summary>Show folder</summary>
          <p className="muted small">
            <code>{dataDir}</code>
          </p>
        </details>
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
      <p className="muted small">
        Exported files are plain, readable text. Keep them somewhere private. Day photos aren’t inside the export; they stay in the
        data folder’s <code>photos</code> folder, which backups rely on too.
        {quarantineCount > 0 && ` ${quarantineCount} odd values set aside during imports are included in the export.`}
      </p>
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

interface WebPreview { found: boolean; summary: Summary | null; photos: number; missingPhotos: number; webServerRunning: boolean; existingPages: number }

/** Desktop app only: bring the pages and photos over from the browser version's database, which is only read, and only once asked. */
function FromBrowserVersion() {
  const [preview, setPreview] = useState<WebPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState('')

  const check = async () => {
    setMsg('')
    try {
      setPreview(await api<WebPreview>('GET', '/api/import/web/preview'))
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  const bring = async () => {
    setBusy(true)
    setMsg('')
    try {
      if (!(await flush())) return setMsg('Some edits aren’t saved yet (see the message at the top). Resolve that first, so nothing typed is lost.')
      const r = await api<{ summary: Summary; photosCopied: number; backup: string | null }>('POST', '/api/import/web', { replace: true })
      await reloadAll()
      setMsg(
        `Brought over and verified: ${describe(r.summary)}, ${r.photosCopied} ${r.photosCopied === 1 ? 'photo' : 'photos'}.` +
          (r.backup ? ' Your previous desktop pages are in a “Before import” backup.' : '') +
          ' The browser version still has its own copy, untouched.',
      )
      setConfirm(false)
      void check()
    } catch (e) {
      setMsg(e instanceof ApiError && e.body.webServerRunning ? 'The browser version is still running. Close its server window first, then try again.' : (e as Error).message)
      void check()
    } finally {
      setBusy(false)
    }
  }

  const p = preview
  return (
    <div className="setting">
      <div className="label">From the browser version</div>
      {!p ? (
        <>
          <p className="muted small">This app keeps its own pages. It can copy in the pages and photos of the browser version on this computer; that version is only read.</p>
          <div className="row-btns">
            <button className="text-btn" onClick={() => void check()}>
              Look for the browser version’s pages…
            </button>
          </div>
        </>
      ) : !p.found ? (
        <p className="muted small">No pages from the browser version were found on this computer.</p>
      ) : (
        <>
          {p.summary ? (
            <p className="small">
              The browser version on this computer holds <strong>{describe(p.summary)}</strong> and {p.photos} {p.photos === 1 ? 'photo' : 'photos'}
              {p.missingPhotos ? ` (${p.missingPhotos} missing from its folder, so it can’t be brought over yet)` : ''}. This app keeps its own pages, separate from it.
            </p>
          ) : (
            <p className="small">The browser version’s pages are on this computer. This app keeps its own pages, separate from it.</p>
          )}
          {p.webServerRunning ? (
            <p className="small setting-msg">
              The browser version is running right now. Close its server window so nothing changes mid-copy, then{' '}
              <button className="text-link" onClick={() => void check()}>
                check again
              </button>
              .
            </p>
          ) : confirm ? (
            <div className="confirm-box">
              <p className="small">
                {p.existingPages ? 'This replaces every page in this app (backed up first). ' : ''}The browser version is only read, never changed.
              </p>
              <div className="row-btns">
                <button className="text-btn" disabled={busy} onClick={() => void bring()}>
                  {busy ? 'Bringing over…' : p.existingPages ? 'Replace my pages' : 'Bring them over'}
                </button>
                <button className="text-btn" disabled={busy} onClick={() => setConfirm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="row-btns">
              <button className="text-btn" onClick={() => setConfirm(true)}>
                Bring pages and photos over…
              </button>
            </div>
          )}
        </>
      )}
      <p className="muted small">Paper and habit-mark choices are kept per app; set them again here if you changed them in the browser.</p>
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
      if (!(await flush())) return setMsg('Some edits aren’t saved yet (see the message at the top). Resolve that first, so nothing typed is lost.')
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

