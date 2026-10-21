// Thin client for the local duckbook server (same origin).

export class ApiError extends Error {
  status: number
  body: Record<string, unknown>
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : `Request failed (${status}).`)
    this.status = status
    this.body = body
  }
}

/** The server could not be reached at all (not running, or the network stack refused). */
export class OfflineError extends Error {
  constructor() {
    super('The duckbook server on this computer isn’t responding.')
  }
}

let onLocked: () => void = () => {}
export const setLockedHandler = (fn: () => void) => (onLocked = fn)

export async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Duckbook': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new OfflineError()
  }
  let json: Record<string, unknown> = {}
  try {
    json = await res.json()
  } catch {
    /* non-JSON error page */
  }
  if (res.status === 401 && json.locked) onLocked()
  if (!res.ok) throw new ApiError(res.status, json)
  return json as T
}
