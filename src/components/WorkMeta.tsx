import { useState } from 'react'
import { fmtShort } from '../lib/date'
import { go } from '../lib/router'
import { editWork, useSettings, type Idea } from '../lib/store'
import { selectIdea } from '../views/FocusView'

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
        <input
          type="date"
          className="date-input"
          autoFocus
          aria-label="Planned date"
          value={idea.date ?? ''}
          onChange={(e) => editWork(idea.id, { date: e.target.value || null })}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && setEditing(false)}
        />
      ) : (
        <button className={`date-chip ${idea.date ? 'has-date' : ''}`} onClick={() => setEditing(true)} aria-label={idea.date ? `Planned ${fmtShort(idea.date)}, change` : 'Set a planned date'}>
          {idea.date ? fmtShort(idea.date) : '+ date'}
        </button>
      )}
    </span>
  )
}
