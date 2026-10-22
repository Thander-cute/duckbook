# Slice: notes for a stretch of days on the Month page

**Status:** done (2026-10-22)
**Decision link:** DECISIONS.md, 2026-10-22 "Month: notes for a range of days" (owner)

## Why (owner)
- Like the paper planner: draw a long line across days, then write a note for that stretch. The words can sit anywhere along it.
- A stretch may cross months, and its from/to days can be changed in a light editor.
- The line should look hand-drawn, with arrowheads at both ends.

## Design (Lead)

**Drawing**
- Press a day number and drag to another day. A click without a drag still opens the day.
- The line becomes a stretch and its editor opens for writing.

**Display**
- Lines sit at the foot of the cells, in lanes. Overlapping stretches stack, and each keeps its lane along its whole length.
- A line wraps with the weeks and crosses the spine (Wed → Thu) onto the right page.
- The strokes are hand-drawn. Each day gets one of three wavering pens, and every stroke starts and ends at the same height, so cells join without a step.
- Hand-drawn arrowheads mark the first and last day. A line coming from another month enters without one.

**Words**
- The words sit on one day and run along the line to the end of that row on that page.
- Drag them to slide along the line; they never leave it.
- Where the line wraps to a new row or page, the words echo faintly at its start.

**Editor**
- Click the words or the line to open it.
- Fields: the words, From → To (any dates, including other months; reversed ends are swapped), the number of days, and remove (with confirmation).
- Dates apply on Enter, on blur, or when the editor closes.

**Storage**
- A new `spans` page: `{ spans: [{ id, start, end, text, at }] }`, one entry per stretch however many months it touches.
- Strict saves refuse unreal days, `start > end`, and `at` outside the range. Lenient imports set them aside.
- The page is written only once used, so older backups and exports stay identical.
- `API_LEVEL` is 4.

## Out of scope
- Dragging a line's ends to resize it (use From/To).
- Colours.
- Showing stretches on Week and Day pages.
- Drawing with the keyboard (editing and opening work by keyboard).

## Done when
- [x] Browser: draw 13 → 16 without opening the day; write; slide the words to the 15th; move To into November; November shows it with its words; remove.
- [x] API: strict validation, crossing months, backup/restore, export, lenient import sets a broken range aside.
- [x] typecheck, `npm test` (16), build, browser checks (22), upgrade check from 88b9807.
