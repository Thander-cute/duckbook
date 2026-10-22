// Day photos: prepared in the browser, stored by the local server as JPEG files named by their hash,
// and shown through in-memory blob URLs (fetched with the app header, forgotten on lock).

import { useEffect, useState } from 'react'
import { API_LEVEL } from './schema'
import { ApiError, OfflineError } from './api'
import { MAX_DAY_PHOTOS, editDay, getSession, getState, onSession, type DayPhoto } from './store'

const FULL_EDGE = 2048
const THUMB_EDGE = 480

async function encode(bitmap: ImageBitmap, edge: number, quality: number) {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  // Transparent images get a white page behind them rather than JPEG's black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality }), w, h }
}

async function upload(blob: Blob): Promise<string> {
  let res: Response
  try {
    res = await fetch('/api/photos', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Duckbook': '1', 'X-Duckbook-Api': String(API_LEVEL), 'Content-Type': 'image/jpeg' },
      body: blob,
    })
  } catch {
    throw new OfflineError()
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ApiError(res.status, json)
  return json.id as string
}

/** Decode (honouring the camera's orientation), scale, re-encode, upload. */
export async function preparePhoto(file: File): Promise<DayPhoto> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`${file.name || 'That file'} can’t be read as a photo here. JPEG, PNG and WebP work; iPhone HEIC photos need to be saved as JPEG first.`)
  }
  try {
    const full = await encode(bitmap, FULL_EDGE, 0.86)
    const thumb = await encode(bitmap, THUMB_EDGE, 0.8)
    const [fullId, thumbId] = await Promise.all([upload(full.blob), upload(thumb.blob)])
    return { full: fullId, thumb: thumbId, w: full.w, h: full.h }
  } finally {
    bitmap.close()
  }
}

/** Add photos to a day, up to the limit. Returns a message for files that were skipped or failed. */
export async function addPhotos(dayKey: string, files: File[]): Promise<string | null> {
  const room = MAX_DAY_PHOTOS - (getState().days[dayKey]?.photos?.length ?? 0)
  const images = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|heic)$/i.test(f.name))
  const take = images.slice(0, Math.max(0, room))
  const problems: string[] = []
  if (images.length > take.length) problems.push(`A day keeps up to ${MAX_DAY_PHOTOS} photos.`)
  for (const f of take) {
    try {
      const photo = await preparePhoto(f)
      editDay(dayKey, (d) => {
        const list = d.photos ?? []
        if (list.length < MAX_DAY_PHOTOS && !list.some((p) => p.full === photo.full)) d.photos = [...list, photo]
      })
    } catch (e) {
      problems.push((e as Error).message)
    }
  }
  return problems.length ? problems.join(' ') : null
}

export function removePhoto(dayKey: string, full: string) {
  editDay(dayKey, (d) => {
    const left = (d.photos ?? []).filter((p) => p.full !== full)
    if (left.length) d.photos = left
    else delete d.photos
  })
}

// ───────── showing them ─────────

const cache = new Map<string, Promise<string | null>>()
const urls = new Set<string>()

function load(id: string): Promise<string | null> {
  let p = cache.get(id)
  if (!p) {
    p = fetch(`/api/photos/${id}`, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Duckbook': '1' } })
      .then(async (r) => {
        if (!r.ok) {
          cache.delete(id)
          return null
        }
        const url = URL.createObjectURL(await r.blob())
        urls.add(url)
        return url
      })
      .catch(() => {
        cache.delete(id)
        return null
      })
    cache.set(id, p)
  }
  return p
}

// Locking forgets every photo this tab has shown.
onSession(() => {
  if (getSession().phase !== 'unlocked') forgetPhotos()
})

function forgetPhotos() {
  for (const u of urls) URL.revokeObjectURL(u)
  urls.clear()
  cache.clear()
}

/** A blob URL for a stored photo; `missing` when this computer doesn't have it. */
export function usePhoto(id: string | null | undefined) {
  const [state, setState] = useState<{ id: string; url: string | null; missing: boolean } | null>(null)
  useEffect(() => {
    if (!id) return
    let live = true
    void load(id).then((url) => live && setState({ id, url, missing: !url }))
    return () => {
      live = false
    }
  }, [id])
  return state && state.id === id ? state : { id, url: null, missing: false }
}
