import { useState } from 'react'
import { fmtShort } from '../lib/date'
import { go } from '../lib/router'
import { editWork, useSettings, validDayKey, type Idea } from '../lib/store'
import { selectIdea } from '../views/FocusView'

/**
 * A planned-date field that only commits a finished date (on Enter or leaving the field).
 * Date inputs report half-typed years like 0202 while you type; those never reach the data.
 * Escape leaves without changing anything.
 */
export function DateField({ value, onCommit, onDone }: { value: string | null; onCommit: (date: string | null) => void; onDone: () => void }) {
  const [v, setV] = useState(value ?? '')
  const commit = () => {
    if (v === '' && value !== null) onCommit(null)
    else if (v !== '' && v !== value && validDayKey(v)) onCommit(v)
    onDone()
  }
  return (
    <input
      type="date"
      className="date-input"
      autoFocus
      aria-label="Planned date"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onDone()
        }
      }}
    />
  )
}

/**
 * The small Focus Map mark shown beside a linked week or day task: opens the idea, shows its state,
 * and edits its planned date in place. Hidden when the Focus Map add-on is off.
 */
export function WorkMeta({ idea, returnDate }: { idea: Idea | undefined; returnDate: string }) {
  const on = useSettings().modules.focusMap
  const [editing, setEditing] = useState(false)
  if (!idea || !on) return null
  return (
    <span className="work-meta">
      <button
        className="idea-mark"
        title={`From Focus Map: ${idea.text}`}
        aria-label="Open this idea on the Focus Map"
        onClick={() => {
          selectIdea(idea.id)
          go('focus', returnDate)
        }}
      >
        ◎
      </button>
      {idea.status === 'doing' && <span className="work-state">in progress</span>}
      {editing ? (
        <DateField value={idea.date} onCommit={(date) => editWork(idea.id, { date })} onDone={() => setEditing(false)} />
      ) : (
        <button className={`date-chip ${idea.date ? 'has-date' : ''}`} onClick={() => setEditing(true)} aria-label={idea.date ? `Planned ${fmtShort(idea.date)}, change` : 'Set a planned date'}>
          {idea.date ? fmtShort(idea.date) : '+ date'}
        </button>
      )}
    </span>
  )
}
