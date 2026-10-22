import { useEffect, useState } from 'react'
import { useRoute, go, type View } from './lib/router'
import { addDays, addMonths, fmtLong, fmtMonth, fmtShort, isoWeek, monthKeyOf, todayKey, weekStart } from './lib/date'
import { boot, getSession, lock, useSaveStatus, useSession, useSettings } from './lib/store'
import { api } from './lib/api'
import { LEGACY_KEY, readLegacy, type LegacyInfo } from './lib/legacy'
import { LockScreen } from './components/LockScreen'
import { Banners, LoadingScreen, MigrationScreen, OfflineScreen, OutdatedScreen } from './components/Gates'
import { MonthView } from './views/MonthView'
import { WeekView } from './views/WeekView'
import { DayView } from './views/DayView'
import { ReflectView } from './views/ReflectView'
import { FocusView } from './views/FocusView'
import { PomodoroBar } from './components/PomodoroBar'
import { SettingsPage, type SettingsSection } from './components/SettingsPanel'

const TABS: { view: View; step: string; label: string; key: string }[] = [
  { view: 'month', step: '1', label: 'Month', key: 'M' },
  { view: 'week', step: '2·3', label: 'Week', key: 'W' },
  { view: 'day', step: '4', label: 'Day', key: 'D' },
  { view: 'reflect', step: '5', label: 'Reflect', key: 'R' },
]

/** Optional module tabs, shown only when turned on in Settings. */
const FOCUS_TAB = { view: 'focus' as View, step: '◎', label: 'Focus', key: 'F' }

function periodLabel(view: View, date: string) {
  if (view === 'month') return fmtMonth(monthKeyOf(date))
  if (view === 'day') return fmtLong(date)
  const mon = weekStart(date)
  const sun = addDays(mon, 6)
  const end = monthKeyOf(sun) === monthKeyOf(mon) ? sun.slice(8).replace(/^0/, '') : fmtShort(sun)
  return `Week ${isoWeek(mon)} · ${fmtShort(mon)} – ${end}`
}

function step(view: View, date: string, dir: 1 | -1) {
  if (view === 'month') return addMonths(date, dir)
  if (view === 'day') return addDays(date, dir)
  return addDays(date, 7 * dir)
}

function isCurrent(view: View, date: string) {
  const t = todayKey()
  if (view === 'month') return monthKeyOf(date) === monthKeyOf(t)
  if (view === 'day') return date === t
  return weekStart(date) === weekStart(t)
}

// Settings is a page you step into; remember where you came from (survives a reload of the tab).
const RETURN_KEY = 'duckbook:settings-return'
const SECTION_KEY = 'duckbook:settings-section'

function openSettings(from: { view: View; date: string }, section?: SettingsSection) {
  if (from.view !== 'settings') sessionStorage.setItem(RETURN_KEY, JSON.stringify(from))
  if (section) sessionStorage.setItem(SECTION_KEY, section)
  go('settings', from.date)
}

function leaveSettings(date: string) {
  try {
    const r = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? 'null') as { view: View; date: string } | null
    if (r && r.view !== 'settings') return go(r.view, r.date)
  } catch {}
  go('day', date)
}

function Notebook({ legacy, onLegacyChange }: { legacy: LegacyInfo | null; onLegacyChange: () => void }) {
  const { view, date } = useRoute()
  const settings = useSettings()
  const { status } = useSession()
  const [section, setSection] = useState<SettingsSection>(() => (sessionStorage.getItem(SECTION_KEY) as SettingsSection) || 'notebook')
  const inSettings = view === 'settings'
  useEffect(() => {
    if (inSettings) setSection((sessionStorage.getItem(SECTION_KEY) as SettingsSection) || 'notebook')
  }, [inSettings])
  const pinEnabled = !!status?.pinEnabled
  const focusOn = settings.modules.focusMap
  const tabs = focusOn ? [...TABS, FOCUS_TAB] : TABS

  // A turned-off module's page isn't reachable; its data stays untouched.
  useEffect(() => {
    if (view === 'focus' && !focusOn) go('week', date)
  }, [view, focusOn, date])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.defaultPrevented || el.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (inSettings) {
        if (e.key === 'Escape') leaveSettings(date)
        return
      }
      if (e.key === 'ArrowLeft') go(view, step(view, date, -1))
      else if (e.key === 'ArrowRight') go(view, step(view, date, 1))
      else if (e.key.toLowerCase() === 't') go(view, todayKey())
      else if (e.key.toLowerCase() === 'l' && pinEnabled) void lock()
      else {
        const tab = tabs.find((t) => t.key === e.key.toUpperCase())
        if (tab) go(tab.view, date)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, date, pinEnabled, focusOn, inSettings])

  useEffect(() => {
    document.documentElement.dataset.ink = settings.ink
  }, [settings.ink])

  return (
    <div className="app">
      <nav className="topbar">
        <a className="wordmark" href="#/" aria-label="duckbook, go to today">
          <em>duck</em>book
        </a>

        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.view}
              role="tab"
              aria-selected={view === t.view}
              className={`tab ${view === t.view ? 'is-active' : ''} ${t.view === 'focus' ? 'tab-module' : ''}`}
              onClick={() => go(t.view, date)}
              title={`${t.label} (${t.key})`}
            >
              <span className="step-num">{t.step}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="period">
          <SaveIndicator />
          {!inSettings && (
            <>
              <button className="icon-btn" onClick={() => go(view, step(view, date, -1))} aria-label="Previous" title="Previous (←)">
                ‹
              </button>
              <span className="period-label">{periodLabel(view, date)}</span>
              <button className="icon-btn" onClick={() => go(view, step(view, date, 1))} aria-label="Next" title="Next (→)">
                ›
              </button>
              <button className="today-btn" disabled={isCurrent(view, date)} onClick={() => go(view, todayKey())} title="Today (T)">
                Today
              </button>
            </>
          )}
          {pinEnabled && (
            <button className="icon-btn" onClick={() => void lock()} aria-label="Lock" title="Lock (L)">
              <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden>
                <rect x="4.5" y="9" width="11" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </button>
          )}
          <button
            className={`icon-btn ${inSettings ? 'is-on' : ''}`}
            onClick={() => (inSettings ? leaveSettings(date) : openSettings({ view, date }))}
            aria-label="Settings"
            title="Settings"
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
              <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </nav>

      <Banners legacy={legacy} onOpenSettings={() => openSettings({ view, date }, 'data')} />

      <main className={`desk view-${view}`} key={`${view}`}>
        {view === 'month' && <MonthView date={date} />}
        {view === 'week' && <WeekView date={date} />}
        {view === 'day' && <DayView date={date} />}
        {view === 'reflect' && <ReflectView date={date} />}
        {view === 'focus' && focusOn && <FocusView date={date} />}
        {inSettings && (
          <SettingsPage
            section={section}
            onSection={(s) => {
              sessionStorage.setItem(SECTION_KEY, s)
              setSection(s)
            }}
            onBack={() => leaveSettings(date)}
            legacy={legacy}
            onLegacyChange={onLegacyChange}
          />
        )}
      </main>

      <PomodoroBar />
    </div>
  )
}

function SaveIndicator() {
  const s = useSaveStatus()
  const text = s.kind === 'saving' ? 'Saving…' : s.kind === 'conflict' ? 'Not saved: changed elsewhere' : s.kind === 'error' ? 'Not saved' : ''
  return (
    <span className={`save-status is-${s.kind}`} role="status" data-save={s.kind}>
      {text}
    </span>
  )
}

/** Locks after the chosen idle time, and keeps the server session alive while you're active. */
function useIdleLock(enabled: boolean, minutes: number) {
  useEffect(() => {
    if (!enabled) return
    // Activity in any duckbook tab counts, so an idle background tab never locks the one you're using.
    const channel = new BroadcastChannel('duckbook-activity')
    let last = Date.now()
    let lastShared = 0
    let lastPing = 0
    const pingEvery = minutes > 0 ? Math.min(60_000, (minutes * 60_000) / 3) : 60_000
    const active = () => {
      last = Date.now()
      if (last - lastShared > 2000) {
        lastShared = last
        channel.postMessage(last)
      }
      if (last - lastPing > pingEvery) {
        lastPing = last
        void api('POST', '/api/ping').catch(() => {})
      }
    }
    channel.onmessage = (e: MessageEvent<number>) => (last = Math.max(last, e.data))
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((ev) => window.addEventListener(ev, active, { passive: true }))
    const t = setInterval(() => {
      if (minutes > 0 && Date.now() - last >= minutes * 60_000) void lock()
    }, 5000)
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, active))
      clearInterval(t)
      channel.close()
    }
  }, [enabled, minutes])
}

export function App() {
  const { phase, status } = useSession()
  const [legacy, setLegacy] = useState<LegacyInfo | null | undefined>(undefined)
  // Decided once per session, so the "moved and verified" result stays on screen until dismissed.
  const [migration, setMigration] = useState<'unknown' | 'show' | 'done'>('unknown')

  useEffect(() => void boot(), [])

  // Read the marker at call time: callers may hold an older render's copy of this function.
  const checkLegacy = () => void readLegacy(getSession().status?.migration?.sourceHash).then(setLegacy)
  useEffect(() => {
    if (phase !== 'unlocked') return setLegacy(undefined)
    checkLegacy()
    // An old-version tab may still be writing to the browser copy.
    const onStorage = (e: StorageEvent) => e.key === LEGACY_KEY && checkLegacy()
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, status?.migration?.sourceHash])

  useEffect(() => {
    if (migration !== 'unknown' || legacy === undefined) return
    setMigration(legacy && !legacy.migrated && status?.docCount === 0 ? 'show' : 'done')
  }, [legacy, migration, status?.docCount])

  useIdleLock(phase === 'unlocked' && !!status?.pinEnabled, status?.autoLockMin ?? 0)

  if (phase === 'loading') return <LoadingScreen />
  if (phase === 'offline') return <OfflineScreen />
  if (phase === 'outdated') return <OutdatedScreen />
  if (phase === 'locked') return <LockScreen />
  if (legacy === undefined || migration === 'unknown') return <LoadingScreen />
  if (migration === 'show' && legacy) {
    return <MigrationScreen legacy={legacy} onDone={() => setMigration('done')} onSkip={() => setMigration('done')} />
  }
  return <Notebook legacy={legacy} onLegacyChange={checkLegacy} />
}
