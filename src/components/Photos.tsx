import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fmtLong, fmtShort } from '../lib/date'
import { addPhotos, removePhoto, usePhoto } from '../lib/photos'
import { href } from '../lib/router'
import { MAX_DAY_PHOTOS, useDay, type DayPhoto } from '../lib/store'
import { Label } from './ui'

export interface Shown {
  day: string
  photo: DayPhoto
}

const tilt = (id: string) => ((parseInt(id.slice(0, 4), 16) % 7) - 3) * 0.6

function Thumb({ photo, alt }: { photo: DayPhoto; alt: string }) {
  const t = usePhoto(photo.thumb)
  if (t.missing) return <span className="photo-missing">Not on this computer</span>
  return t.url ? <img src={t.url} alt={alt} draggable={false} /> : <span className="photo-loading" aria-hidden />
}

/** The Day page's keepsakes: up to three photos, added by click, drop, or paste. */
export function DayPhotos({ date }: { date: string }) {
  const photos = useDay(date).photos ?? []
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const room = MAX_DAY_PHOTOS - photos.length - busy

  const add = async (files: File[]) => {
    if (!files.length) return
    setError(null)
    setBusy(Math.min(files.length, Math.max(room, 0)))
    const msg = await addPhotos(date, files)
    setBusy(0)
    setError(msg)
  }

  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      void add(files)
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  })

  return (
    <section
      className={`day-photos ${dropping ? 'is-dropping' : ''}`}
      aria-label="Photos of the day"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        void add([...e.dataTransfer.files])
      }}
    >
      <Label hint={`keep up to ${MAX_DAY_PHOTOS} from today`}>Photos</Label>
      <div className="photo-row">
        {photos.map((p, i) => (
          <figure key={p.full} className="polaroid" style={{ rotate: `${tilt(p.full)}deg` }}>
            <button className="polaroid-img" onClick={() => setViewing(i)} aria-label={`Open photo ${i + 1} of ${photos.length}`}>
              <Thumb photo={p} alt={`Photo ${i + 1} from ${fmtShort(date)}`} />
            </button>
            {confirm === p.full ? (
              <span className="polaroid-confirm">
                <button
                  className="text-btn"
                  onClick={() => {
                    removePhoto(date, p.full)
                    setConfirm(null)
                  }}
                >
                  Remove
                </button>
                <button className="text-btn" onClick={() => setConfirm(null)}>
                  Keep
                </button>
              </span>
            ) : (
              <button className="polaroid-x" aria-label={`Remove photo ${i + 1}`} title="Remove this photo" onClick={() => setConfirm(p.full)}>
                ✕
              </button>
            )}
          </figure>
        ))}
        {Array.from({ length: busy }, (_, i) => (
          <figure key={`busy-${i}`} className="polaroid is-busy" aria-label="Adding a photo">
            <span className="polaroid-img">
              <span className="photo-loading" />
            </span>
          </figure>
        ))}
        {room > 0 && (
          <button className="polaroid is-add" onClick={() => input.current?.click()}>
            <span className="polaroid-img">
              <span className="add-plus" aria-hidden>
                +
              </span>
              <span>Add a photo</span>
              <span className="add-hint">or drop / paste one here</span>
            </span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Choose photos"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void add(files)
        }}
      />
      {error && (
        <p className="photo-error" role="alert">
          {error}
        </p>
      )}
      {viewing !== null && photos[viewing] && <PhotoViewer items={photos.map((photo) => ({ day: date, photo }))} start={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}

/** A photo laid over the page: ‹ › or the arrow keys step through, Esc or a click outside closes. */
export function PhotoViewer({ items, start, onClose, showDayLink = false }: { items: Shown[]; start: number; onClose: () => void; showDayLink?: boolean }) {
  const [i, setI] = useState(start)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const item = items[Math.min(i, items.length - 1)]
  const full = usePhoto(item?.photo.full)
  const thumb = usePhoto(item?.photo.thumb)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    closeBtn.current?.focus()
    const key = (e: KeyboardEvent) => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
      if (e.key === 'Escape') close.current()
      else if (step) setI((x) => (x + step + items.length) % items.length)
      else return
      // These keys belong to the viewer, not to the notebook's page turning behind it.
      e.preventDefault()
      e.stopPropagation()
    }
    addEventListener('keydown', key, true)
    return () => {
      removeEventListener('keydown', key, true)
      back?.focus()
    }
  }, [items.length])

  if (!item) return null
  const src = full.url ?? thumb.url
  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Photo from ${fmtLong(item.day)}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button ref={closeBtn} className="viewer-close" aria-label="Close" onClick={onClose}>
        ✕
      </button>
      {items.length > 1 && (
        <button className="viewer-nav prev" aria-label="Previous photo" onClick={() => setI((x) => (x - 1 + items.length) % items.length)}>
          ‹
        </button>
      )}
      <figure className="viewer-mount" onClick={(e) => e.stopPropagation()}>
        {full.missing && thumb.missing ? (
          <div className="viewer-missing">This photo isn’t on this computer.</div>
        ) : src ? (
          <img src={src} alt={`Photo from ${fmtLong(item.day)}`} style={{ aspectRatio: `${item.photo.w} / ${item.photo.h}` }} />
        ) : (
          <div className="viewer-missing" style={{ aspectRatio: `${item.photo.w} / ${item.photo.h}` }} />
        )}
        <figcaption>
          <span className="ink">{fmtLong(item.day)}</span>
          {items.length > 1 && (
            <span className="muted">
              {i + 1} / {items.length}
            </span>
          )}
          {showDayLink && (
            <a className="text-link" href={href('day', item.day)} onClick={onClose}>
              Open day →
            </a>
          )}
        </figcaption>
      </figure>
      {items.length > 1 && (
        <button className="viewer-nav next" aria-label="Next photo" onClick={() => setI((x) => (x + 1) % items.length)}>
          ›
        </button>
      )}
    </div>,
    document.body,
  )
}

/** The small picture mark in a month cell's top-right corner. */
export function PhotoMark({ count, day, onOpen }: { count: number; day: string; onOpen: () => void }) {
  return (
    <button className="photo-mark" onClick={onOpen} aria-label={`Photos from ${fmtShort(day)} (${count})`} title={`${count} photo${count > 1 ? 's' : ''}`}>
      <svg viewBox="0 0 16 13" aria-hidden>
        <rect x="1" y="1.5" width="14" height="10.5" rx="1.6" />
        <circle cx="5.2" cy="5" r="1.3" />
        <path d="M1.6 11 L6 7.2 L8.6 9.4 L11 7.4 L14.6 10.6" />
      </svg>
      {count > 1 && <span>{count}</span>}
    </button>
  )
}
