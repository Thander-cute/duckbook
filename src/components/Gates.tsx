import type { SettingsSection } from './SettingsPanel'
import { useEffect, useState } from 'react'
import { API_LEVEL, boot, reloadAll, useAutoCopyNote, useSaveStatus, useSession, useStore, resolveConflict } from '../lib/store'
import { migrateLegacy, type LegacyInfo } from '../lib/legacy'
import type { Summary } from '../lib/schema'
import { api } from '../lib/api'
import { useUpdates } from '../lib/updates'

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
export const describe = (s: Summary) => `${plural(s.days, 'day')}, ${plural(s.weeks, 'week')}, ${plural(s.months, 'month')}`

export function LoadingScreen() {
  return <div className="lock-shell" aria-busy="true" />
}

const IN_DESKTOP_APP = navigator.userAgent.includes('Electron')

/** The local server isn't answering. Keep trying quietly; never show an empty notebook instead. */
export function OfflineScreen() {
  useEffect(() => {
    const t = setInterval(() => void boot(), 3000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="lock-shell">
      <div className="lock-card wide">
        <div className="wordmark">
          <em>duck</em>book
        </div>
        {IN_DESKTOP_APP ? (
          <>
            <p>duckbook’s storage stopped responding.</p>
            <p className="muted small">This window reconnects by itself. If it stays like this, close duckbook and open it again; saved pages are safe.</p>
          </>
        ) : (
          <>
            <p>The duckbook server on this computer isn’t running.</p>
            <p className="muted small">
              Open <strong>Duckbook</strong> from your desktop shortcut (or <code>Duckbook.cmd</code> in the project folder). This page reconnects by itself.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/** This page is newer than the background server still running. Nothing can be edited until it restarts. */
export function OutdatedScreen() {
  const { status } = useSession()
  const pageIsOlder = (status?.apiLevel ?? 0) > API_LEVEL
  useEffect(() => {
    const t = setInterval(() => void boot(), 3000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="lock-shell">
      <div className="lock-card wide">
        <div className="wordmark">
          <em>duck</em>book
        </div>
        {pageIsOlder ? (
          <>
            <p>duckbook was updated. This tab still has the old version.</p>
            <p className="muted small">Reload this tab to continue. Nothing was changed.</p>
          </>
        ) : (
          <>
            <p>duckbook was updated, but its background server is still running the old version.</p>
            <p className="muted small">
              Open <strong>Duckbook</strong> again (desktop shortcut or <code>Duckbook.cmd</code>): it restarts the server for you. This page continues by itself once
              the new server is up. Nothing was changed.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Desktop app with an empty notebook: start fresh, or bring pages over from the browser version.
 * The browser version's pages are only looked at after the person asks for it.
 */
export function DesktopWelcome({ onDone }: { onDone: () => void }) {
  type Preview = { found: boolean; summary: Summary | null; photos: number; webServerRunning: boolean }
  const [p, setP] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ summary: Summary; photosCopied: number } | null>(null)
  const [error, setError] = useState('')

  const look = async () => {
    setBusy(true)
    setError('')
    try {
      setP(await api<Preview>('GET', '/api/import/web/preview'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const bring = async () => {
    setBusy(true)
    setError('')
    try {
      setResult(await api<{ summary: Summary; photosCopied: number }>('POST', '/api/import/web', {}))
      await reloadAll()
    } catch (e) {
      setError((e as Error).message)
      void look()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lock-shell">
      <div className="lock-card wide">
        <div className="wordmark">
          <em>duck</em>book
        </div>
        {result ? (
          <>
            <p>
              Brought over and verified: <strong>{describe(result.summary)}</strong>, {plural(result.photosCopied, 'photo')}.
            </p>
            <p className="muted small">This app now keeps its own copy. The browser version still has its pages, untouched.</p>
            <button className="pomo-btn" onClick={onDone}>
              Open my notebook
            </button>
          </>
        ) : !p ? (
          <>
            <p>This notebook is empty.</p>
            <p className="muted small">
              If you used duckbook in the browser on this computer, you can bring those pages and photos into this app. The browser version is only read, never
              changed. You can also do this later in Settings → Data.
            </p>
            {error && (
              <p className="lock-error" role="alert">
                {error}
              </p>
            )}
            <div className="row-btns center">
              <button className="pomo-btn" disabled={busy} onClick={() => void look()}>
                {busy ? 'Looking…' : 'Look for my browser pages'}
              </button>
              <button className="pomo-btn ghost-dark" disabled={busy} onClick={onDone}>
                Start with an empty notebook
              </button>
            </div>
          </>
        ) : !p.found ? (
          <>
            <p>No pages from the browser version were found on this computer.</p>
            <button className="pomo-btn" onClick={onDone}>
              Start with an empty notebook
            </button>
          </>
        ) : (
          <>
            {p.summary ? (
              <p>
                The browser version on this computer holds <strong>{describe(p.summary)}</strong> and {plural(p.photos, 'photo')}.
              </p>
            ) : (
              <p>The browser version’s pages are on this computer.</p>
            )}
            {p.webServerRunning ? (
              <p className="lock-error" role="alert">
                The browser version is running right now, so its pages aren’t read while they might change. Close its server window first, then check again.
              </p>
            ) : (
              <p className="muted small">They’re copied into this app and checked. The browser version keeps its own copy.</p>
            )}
            {error && !p.webServerRunning && (
              <p className="lock-error" role="alert">
                {error}
              </p>
            )}
            <div className="row-btns center">
              <button className="pomo-btn" disabled={busy} onClick={() => void (p.webServerRunning ? look() : bring())}>
                {busy ? 'Working…' : p.webServerRunning ? 'Check again' : 'Bring them over'}
              </button>
              <button className="pomo-btn ghost-dark" disabled={busy} onClick={onDone}>
                Start with an empty notebook
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** First run with an empty database and pages still in this browser: ask before anything else. */
export function MigrationScreen({ legacy, onDone, onSkip }: { legacy: LegacyInfo; onDone: () => void; onSkip: () => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Summary | null>(null)
  const [error, setError] = useState('')

  const move = async () => {
    setBusy(true)
    setError('')
    try {
      setResult(await migrateLegacy(false))
      await reloadAll()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lock-shell">
      <div className="lock-card wide">
        <div className="wordmark">
          <em>duck</em>book
        </div>
        {result ? (
          <>
            <p>
              Moved and verified: <strong>{describe(result)}</strong>.
            </p>
            <p className="muted small">
              Your pages now live in the duckbook database on this computer. The old copy is still kept in this browser; you can remove it later in Settings.
            </p>
            <button className="pomo-btn" onClick={onDone}>
              Open my notebook
            </button>
          </>
        ) : legacy.error ? (
          <>
            <p>Pages from the earlier version were found in this browser, but they couldn’t be read.</p>
            <p className="muted small">{legacy.error} Nothing was changed. The old copy stays in this browser.</p>
            <button className="pomo-btn ghost-dark" onClick={onSkip}>
              Continue with an empty notebook
            </button>
          </>
        ) : (
          <>
            <p>
              Your existing pages are stored in this browser: <strong>{describe(legacy.summary!)}</strong>.
            </p>
            <p className="muted small">
              Move them into the duckbook database on this computer, which is safer than browser storage and is backed up automatically. The browser copy is kept until
              you remove it.
            </p>
            {error && (
              <p className="lock-error" role="alert">
                {error}
              </p>
            )}
            <div className="row-btns center">
              <button className="pomo-btn" disabled={busy} onClick={move}>
                {busy ? 'Moving…' : 'Move my pages'}
              </button>
              <button className="pomo-btn ghost-dark" disabled={busy} onClick={onSkip}>
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function Banners({ legacy, onOpenSettings }: { legacy: LegacyInfo | null; onOpenSettings: (section: SettingsSection) => void }) {
  const save = useSaveStatus()
  const copyNote = useAutoCopyNote()
  const { status } = useSession()
  const empty = useStore((s) => !Object.keys(s.days).length && !Object.keys(s.weeks).length && !Object.keys(s.months).length)
  return (
    <>
      {status?.docCount === 0 && empty && legacy === null && (
        <div className="banner">
          <span>
            This notebook is empty. If you used duckbook before in a different browser, open <strong>http://localhost:5317</strong> in that browser to move your
            pages in.
          </span>
        </div>
      )}
      {save.kind === 'conflict' && (
        <div className="banner is-warn" role="alert">
          <span>Some pages were changed in another tab or window since you opened them.</span>
          <button className="text-btn" onClick={() => void resolveConflict('theirs')} title="Discards this tab’s unsaved edits">
            Use the saved version
          </button>
          <button className="text-btn" onClick={() => void resolveConflict('mine')} title="Overwrites what was saved elsewhere on these pages">
            Keep this tab’s
          </button>
        </div>
      )}
      {save.kind === 'error' && (
        <div className="banner is-warn" role="alert">
          <span>{save.message}</span>
        </div>
      )}
      {copyNote?.kind === 'failed' && (
        <div className="banner is-warn" role="alert">
          <span>{copyNote.message}</span>
        </div>
      )}
      <UpdateBanner onOpenSettings={() => onOpenSettings('updates')} />
      {legacy && !legacy.migrated && !legacy.error && (
        <div className="banner">
          <span>This browser still holds pages from the earlier version that differ from your database.</span>
          <button className="text-btn" onClick={() => onOpenSettings('data')}>
            Review in Settings
          </button>
        </div>
      )}
    </>
  )
}

const UPDATE_SEEN = 'duckbook:update-seen'

/** Desktop only: a new version is out. Once dismissed, quiet until the next version. */
function UpdateBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const u = useUpdates()
  const [seen, setSeen] = useState(() => sessionStorage.getItem(UPDATE_SEEN))
  if (!u?.version || !['available', 'ready'].includes(u.status) || seen === u.version) return null
  const later = () => {
    sessionStorage.setItem(UPDATE_SEEN, u.version!)
    setSeen(u.version!)
  }
  return (
    <div className="banner" role="status">
      <span>{u.status === 'ready' ? `Duckbook ${u.version} is downloaded and ready to install.` : `Duckbook ${u.version} is available.`}</span>
      <button className="text-btn" onClick={onOpenSettings}>
        See what’s new
      </button>
      <button className="text-btn" onClick={later}>
        Later
      </button>
    </div>
  )
}
