// Optional 6-digit PIN privacy lock. This is an access lock for the running app, not encryption:
// the database on disk stays readable to anyone (or any program) with access to the user's files.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Store } from './db.ts'

interface PinRecord { salt: string; hash: string; N: number }

export const PIN_PATTERN = /^\d{6}$/
const SCRYPT_N = 1 << 15

const FREE_ATTEMPTS = 5
const FIRST_LOCKOUT_MS = 30_000
const MAX_LOCKOUT_MS = 15 * 60_000

function hashPin(pin: string, salt: Buffer, N: number) {
  return scryptSync(pin, salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

export class Auth {
  private store: Store
  private sessions = new Map<string, number>() // token → last activity (ms)
  private failures = 0
  private lockedUntil = 0
  /** Test hook: overrides the idle timeout in ms. */
  idleOverrideMs: number | null = null

  constructor(store: Store) {
    this.store = store
  }

  get enabled() {
    return !!this.store.getMeta<PinRecord>('pin')
  }

  get autoLockMin(): number {
    return this.store.getMeta<number>('auto_lock_min') ?? 15
  }

  private idleMs() {
    return this.idleOverrideMs ?? (this.autoLockMin > 0 ? this.autoLockMin * 60_000 : Infinity)
  }

  /** True if the request may read or change private data. Refreshes the session's activity. */
  allows(token: string | undefined): boolean {
    if (!this.enabled) return true
    if (!token) return false
    const last = this.sessions.get(token)
    if (last === undefined) return false
    if (Date.now() - last > this.idleMs()) {
      this.sessions.delete(token)
      return false
    }
    this.sessions.set(token, Date.now())
    return true
  }

  retryAfterMs() {
    return Math.max(0, this.lockedUntil - Date.now())
  }

  /** Check a PIN with attempt limiting. Returns a new session token on success. */
  unlock(pin: unknown): { ok: true; token: string } | { ok: false; retryAfterMs: number } {
    const wait = this.retryAfterMs()
    if (wait > 0) return { ok: false, retryAfterMs: wait }
    if (!this.verify(pin)) {
      this.failures++
      if (this.failures >= FREE_ATTEMPTS) {
        const ms = Math.min(MAX_LOCKOUT_MS, FIRST_LOCKOUT_MS * 2 ** (this.failures - FREE_ATTEMPTS))
        this.lockedUntil = Date.now() + ms
      }
      return { ok: false, retryAfterMs: this.retryAfterMs() }
    }
    this.failures = 0
    this.lockedUntil = 0
    return { ok: true, token: this.newSession() }
  }

  private verify(pin: unknown) {
    const rec = this.store.getMeta<PinRecord>('pin')
    if (!rec || typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
      if (rec) hashPin('000000', Buffer.from(rec.salt, 'base64'), rec.N) // keep timing similar for malformed input
      return false
    }
    const expected = Buffer.from(rec.hash, 'base64')
    return timingSafeEqual(hashPin(pin, Buffer.from(rec.salt, 'base64'), rec.N), expected)
  }

  newSession() {
    const token = randomBytes(32).toString('base64url')
    this.sessions.set(token, Date.now())
    return token
  }

  /** Lock every tab: forget all sessions. */
  lockAll() {
    this.sessions.clear()
  }

  /** Set, change, or remove the PIN. Changing or removing requires the current PIN. */
  setPin(current: unknown, next: string | null): { ok: true; token: string | null } | { ok: false; error: string; retryAfterMs?: number } {
    if (this.enabled) {
      const r = this.unlock(current)
      if (!r.ok) return { ok: false, error: r.retryAfterMs ? 'Too many tries. Wait a moment.' : 'Current PIN is not right.', retryAfterMs: r.retryAfterMs }
    }
    if (next === null) {
      this.store.setMeta('pin', null)
      this.lockAll()
      return { ok: true, token: null }
    }
    if (!PIN_PATTERN.test(next)) return { ok: false, error: 'PIN must be exactly 6 digits.' }
    const salt = randomBytes(16)
    this.store.setMeta('pin', { salt: salt.toString('base64'), hash: hashPin(next, salt, SCRYPT_N).toString('base64'), N: SCRYPT_N } satisfies PinRecord)
    this.lockAll()
    return { ok: true, token: this.newSession() }
  }

  setAutoLock(min: number) {
    this.store.setMeta('auto_lock_min', Math.max(0, Math.min(240, Math.round(min))))
  }
}
