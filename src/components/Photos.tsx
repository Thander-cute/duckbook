import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { fmtLong, fmtShort } from '../lib/date'
import { addPhotos, removePhoto, usePhoto } from '../lib/photos'
import { href } from '../lib/router'
import { editDay, foldPhotoLines, MAX_DAY_PHOTOS, MAX_PHOTO_DESCRIPTION, MAX_PHOTO_LINES, MAX_PHOTO_TITLE, useDay, type DayPhoto } from '../lib/store'
import { ConfirmRemove, Label, Write } from './ui'

export interface Shown {
  day: string
  photo: DayPhoto
}

const tilt = (id: string) => ((parseInt(id.slice(0, 4), 16) % 7) - 3) * 0.6

/** A photo's title or description. Empty text removes the field, so the page is stored as before. */
function setPhotoText(day: string, full: string, field: 'title' | 'description', value: string) {
  editDay(day, (d) => {
    const photo = d.photos?.find((p) => p.full === full)
    if (!photo) return
    const text = field === 'title' ? value.replace(/\s+/g, ' ').slice(0, MAX_PHOTO_TITLE) : foldPhotoLines(value).slice(0, MAX_PHOTO_DESCRIPTION)
    if (text.trim()) photo[field] = text
    else delete photo[field]
  })
}

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
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
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
      // A title or note keeps pasted text as text; only a paste on the page adds a photo.
      if ((e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable], [role="textbox"]')) return
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
      <Label info={`Keep up to ${MAX_DAY_PHOTOS} photos from today`}>Photos</Label>
      <div className="photo-row">
        {photos.map((p, i) => (
          <figure key={p.full} className="polaroid" style={{ rotate: `${tilt(p.full)}deg` }}>
            <button className="polaroid-img" onClick={() => setViewing(i)} aria-label={`Open photo ${i + 1} of ${photos.length}`}>
              <Thumb photo={p} alt={`Photo ${i + 1} from ${fmtShort(date)}`} />
            </button>
            {editingTitle === p.full ? (
              <input
                className={`polaroid-title ${(p.title?.length ?? 0) > 24 ? 'is-long' : ''}`}
                autoFocus
                value={p.title ?? ''}
                maxLength={MAX_PHOTO_TITLE}
                placeholder="Add a title"
                aria-label={`Title for photo ${i + 1}`}
                onChange={(e) => setPhotoText(date, p.full, 'title', e.target.value)}
                onBlur={() => setEditingTitle(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                }}
              />
            ) : (
              <div
                className={`polaroid-title ${(p.title?.length ?? 0) > 24 ? 'is-long' : ''}`}
                role="textbox"
                tabIndex={0}
                aria-label={`Title for photo ${i + 1}${p.title ? `: ${p.title}` : ', empty. Click to write one'}`}
                onClick={() => setEditingTitle(p.full)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setEditingTitle(p.full)
                  }
                }}
              >
                {p.title ?? <span className="polaroid-title-hint">Add a title</span>}
              </div>
            )}
            {confirm === p.full ? (
              <ConfirmRemove
                what={`photo ${i + 1}`}
                className="polaroid-confirm"
                onRemove={() => {
                  removePhoto(date, p.full)
                  setConfirm(null)
                }}
                onKeep={() => setConfirm(null)}
              />
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

/**
 * A photo laid over the page: the print with its title, and beneath it its caption written straight
 * on the dimmed page. The top row holds the date, the count, the day link, the pencil and the close.
 * ‹ › or the arrow keys step through, Esc or a click outside closes; the pencil writes the caption.
 */
export function PhotoViewer({ items, start, onClose, showDayLink = false }: { items: Shown[]; start: number; onClose: () => void; showDayLink?: boolean }) {
  const [i, setI] = useState(start)
  const [editing, setEditing] = useState(false)
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
      // While the caption is being written, its keys belong to it: arrows move the caret, and
      // Escape leaves the caption rather than closing the photo.
      const typing = (e.target as HTMLElement | null)?.closest<HTMLElement>('input, textarea, [contenteditable]')
      if (typing) {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          typing.blur()
        }
        return
      }
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
      if (e.key === 'Escape') close.current()
      else if (step) {
        setEditing(false)
        setI((x) => (x + step + items.length) % items.length)
      } else return
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
  const { w, h } = item.photo
  // The print is sized from the photo's own shape, so it doesn't jump when the full image replaces the thumbnail.
  const size = { aspectRatio: `${w} / ${h}`, '--ar': w / h, '--w': `${w}px` } as CSSProperties
  const stepTo = (d: number) => {
    setEditing(false)
    setI((x) => (x + d + items.length) % items.length)
  }
  return createPortal(
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo from ${fmtLong(item.day)}`}
      onClick={(e) => !(e.target as Element).closest('.viewer-mount, .viewer-caption, .viewer-controls, button') && onClose()}
    >
      <div className="viewer-controls">
        <span className="viewer-date">{fmtLong(item.day)}</span>
        {items.length > 1 && (
          <span className="viewer-count">
            {i + 1} / {items.length}
          </span>
        )}
        {showDayLink && (
          <a className="viewer-link" href={href('day', item.day)} onClick={onClose}>
            Open day →
          </a>
        )}
        <button
          className="viewer-pencil"
          aria-label={editing ? 'Finish editing the description' : 'Edit the description'}
          aria-pressed={editing}
          title={editing ? 'Finish editing' : 'Edit the description'}
          // Keep the caption's caret while the button is pressed, so the click only ends editing.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEditing((x) => !x)}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M13.6 3.4 L16.6 6.4 L6.6 16.4 L3.2 16.8 L3.6 13.4 Z" />
            <path d="M11.8 5.2 L14.8 8.2" />
          </svg>
        </button>
        <button ref={closeBtn} className="viewer-close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      {items.length > 1 && (
        <button className="viewer-nav prev" aria-label="Previous photo" onClick={() => stepTo(-1)}>
          ‹
        </button>
      )}
      <figure className="viewer-mount">
        {full.missing && thumb.missing ? (
          <div className="viewer-missing" style={size}>
            This photo isn’t on this computer.
          </div>
        ) : src ? (
          <img src={src} alt={`Photo from ${fmtLong(item.day)}`} style={size} />
        ) : (
          <div className="viewer-missing" style={size} />
        )}
        {item.photo.title && <figcaption className="viewer-title">{item.photo.title}</figcaption>}
      </figure>
      {items.length > 1 && (
        <button className="viewer-nav next" aria-label="Next photo" onClick={() => stepTo(1)}>
          ›
        </button>
      )}
      <section className="viewer-caption" aria-label="Description">
        {editing ? (
          <>
            <Write
              className="viewer-note"
              value={item.photo.description ?? ''}
              onChange={(v) => setPhotoText(item.day, item.photo.full, 'description', v)}
              onBlur={() => setEditing(false)}
              // Enter stops at the fourth line; pasted breaks are folded by setPhotoText instead.
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (item.photo.description ?? '').split('\n').length >= MAX_PHOTO_LINES) e.preventDefault()
              }}
              placeholder="Write about this photo…"
              ariaLabel={`Description for the photo from ${fmtLong(item.day)}`}
              maxLength={MAX_PHOTO_DESCRIPTION}
              autoFocus
            />
            <span className="viewer-limit">
              {(item.photo.description ?? '').length} / {MAX_PHOTO_DESCRIPTION}
            </span>
          </>
        ) : (
          item.photo.description && <p className="viewer-text">{item.photo.description}</p>
        )}
      </section>
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
