// The earlier version kept everything in this browser's localStorage under `duckbook:v1`,
// tied to the exact origin http://localhost:5317. We only ever read that key, never write it.
// It is removed only when the user asks, after the database holds a verified copy.

import { api } from './api'
import { normalizeState, stateToDocs, summarize, type Summary } from './schema'

export const LEGACY_KEY = 'duckbook:v1'

export interface LegacyInfo {
  hash: string
  summary: Summary | null
  /** Set when the stored data can't be read as planner data. */
  error: string | null
  /** The database holds a verified copy of exactly this data. */
  migrated: boolean
}

async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function readLegacy(migratedHash: string | null | undefined): Promise<LegacyInfo | null> {
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return null
  const hash = await sha256(raw)
  try {
    const { state } = normalizeState(JSON.parse(raw))
    return { hash, summary: summarize(state), error: null, migrated: migratedHash === hash }
  } catch (e) {
    return { hash, summary: null, error: (e as Error).message, migrated: false }
  }
}

/**
 * Copy the legacy pages into the database, then check every page the server reports back against
 * what this browser holds. Throws if anything differs; the old key is left untouched either way.
 */
export async function migrateLegacy(replace: boolean): Promise<Summary> {
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) throw new Error('The old browser copy is gone.')
  const parsed = JSON.parse(raw)
  const expected = normalizeState(parsed).state
  const res = await api<{ docs: { key: string; value: unknown }[]; summary: Summary }>('POST', '/api/import', {
    data: parsed,
    source: 'legacy',
    sourceHash: await sha256(raw),
    replace,
  })
  const got = new Map(res.docs.map((d) => [d.key, JSON.stringify(d.value)]))
  for (const d of stateToDocs(expected)) {
    if (got.get(d.key) !== JSON.stringify(d.value)) throw new Error(`Verification failed for ${d.key}. Your old copy is untouched.`)
  }
  return res.summary
}

export function removeLegacy() {
  localStorage.removeItem(LEGACY_KEY)
}
