import { lazy, Suspense } from 'react'
import type { NoteProps } from './NoteEditor'

// The editor and its fonts load only when a note is on screen.
const NoteEditor = lazy(() => import('./NoteEditor'))

/** A note with bold, italic, underline and section lines. Until the editor arrives, the text shows as it is stored. */
export function Note(props: NoteProps) {
  return (
    <Suspense fallback={<div className={`write ink ${props.className ?? ''} note-editor note-loading`}>{props.value}</div>}>
      <NoteEditor {...props} />
    </Suspense>
  )
}
