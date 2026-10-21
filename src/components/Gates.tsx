import { useEffect, useState } from 'react'
import { boot, reloadAll, useSaveStatus, resolveConflict } from '../lib/store'
import { migrateLegacy, type LegacyInfo } from '../lib/legacy'
import type { Summary } from '../lib/schema'

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
export const describe = (s: Summary) => `${plural(s.days, 'day')}, ${plural(s.weeks, 'week')}, ${plural(s.months, 'month')}`

export function LoadingScreen() {
  return <div className="lock-shell" aria-busy="true" />
}

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
        <p>The duckbook server on this computer isn’t running.</p>
        <p className="muted small">
          Open <strong>Duckbook</strong> from your desktop shortcut (or <code>Duckbook.cmd</code> in the project folder). This page reconnects by itself.
        </p>
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

export function Banners({ legacy, onOpenSettings }: { legacy: LegacyInfo | null; onOpenSettings: () => void }) {
  const save = useSaveStatus()
  return (
    <>
      {save.kind === 'conflict' && (
        <div className="banner is-warn" role="alert">
          <span>Some pages were changed in another tab or window since you opened them.</span>
          <button className="text-btn" onClick={() => void resolveConflict('theirs')}>
            Use the saved version
          </button>
          <button className="text-btn" onClick={() => void resolveConflict('mine')}>
            Keep this tab’s
          </button>
        </div>
      )}
      {save.kind === 'error' && (
        <div className="banner is-warn" role="alert">
          <span>{save.message}</span>
        </div>
      )}
      {legacy && !legacy.migrated && !legacy.error && (
        <div className="banner">
          <span>This browser still holds pages from the earlier version that differ from your database.</span>
          <button className="text-btn" onClick={onOpenSettings}>
            Review in Settings
          </button>
        </div>
      )}
    </>
  )
}
