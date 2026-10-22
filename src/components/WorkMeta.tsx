import { go } from '../lib/router'
import { editWork, useSettings, type Idea } from '../lib/store'
import { DateChip } from './DatePicker'
import { selectIdea } from '../views/FocusView'

/**
 * The small Focus Map mark shown beside a linked week or day task: opens the idea, shows its state,
 * and edits its planned date in place. Hidden when the Focus Map add-on is off.
 */
export function WorkMeta({ idea, returnDate }: { idea: Idea | undefined; returnDate: string }) {
  const on = useSettings().modules.focusMap
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
      <DateChip value={idea.date} onChange={(date) => editWork(idea.id, { date })} label="Planned date" />
    </span>
  )
}
