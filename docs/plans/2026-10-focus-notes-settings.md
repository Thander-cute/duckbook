# Slice: Focus Map as sticky notes, Settings as a notebook page

**Status:** in progress
**Decision link:** DECISIONS.md, 2026-10-23 "Focus notes + Settings page" (owner approved)

## Why (owner-approved outcomes)
- Focus Map should feel like arranging paper sticky notes while staying practical: a wide impact/difficulty canvas, a small tray for unplaced ideas, writing directly on notes, and dragging whole notes.
- Each idea has an optional planned date and three states: Idea, In progress, Completed. Filters: Open / In progress / Completed / All.
- Planning an idea links it to one logical work item. Title, date, and progress stay consistent whether edited from Focus, Week, or Day.
- Settings moves from a sidebar to a dedicated paper page with tab navigation (Notebook, Focus timer, Privacy, Data, Add-ons) and returns to where you were.

## Design choices (Lead)

**One work item**
- The idea is the source of truth for title, state, and planned date.
- Planning creates (or moves) a single Week task linked by `ideaId`. Day tasks pulled from it keep linking through `weekTaskId`.
- Any edit to one of these goes through `editWork()`. It updates the idea and every linked week and day copy in one save, so all of them land together in the same atomic batch.

**Planning**
- "Plan" targets the week of the planned date, or the week shown in the top bar if there is no date.
- If the idea is already planned in another week, the action becomes "Move to Wk N". Changing the planned date of a planned idea moves its week task to the new week.
- A second week task is never created. Unplanned ideas stay valid.

**State**
- Completing from any view sets the state to Completed and ticks all linked tasks. Reopening sets it to In progress.
- Starting a pomodoro on a linked Day task moves an Idea to In progress.
- Position on the map is independent of state.

**Existing data**
- Ideas without `status` or `date` get them once on load, all at the same time:
  - `status` becomes Completed if every linked task is done, otherwise Idea;
  - `date` becomes empty.
- Older builds allowed one task per idea per week. Those tasks are all kept and all stay in sync. "Move" only moves the latest one; the earlier ones remain as history in their weeks.

**Drag**
- Pointer-based, so note positions are exact.
- The lifted note follows the pointer. The canvas or tray under it highlights, and dropping on the tray unplaces the note.
- Non-drag controls:
  - Each note is focusable; arrow keys move it, Shift for fine steps.
  - A "Place" select offers the four zones or Tray.

**Settings**
- Route `#/settings/<date>`; Escape or "Back to notebook" returns to the previous view and date.
- One section shows at a time, chosen by paper tabs on the page edge that stay in view while scrolling.

**Compatibility**
- New idea fields, so `API_LEVEL` goes to 3; the launcher's restart path covers updates.
- Backups and exports carry the new fields. Older exports import with defaults.

## Out of scope
Photos, Year view, mobile, AI, encryption, recurring items, unplanning or deleting week history.

## Done when
- [ ] Browser: create → place (drag + keyboard) → date → plan → edit title/date/done from Week and Day → complete/reopen on the note; one week task, consistent everywhere.
- [ ] Legacy ideas and promoted tasks reconcile without losing tasks.
- [ ] Module off/on, PIN, conflicts, backup/restore, upgrade path still pass.
- [ ] typecheck, `npm test`, build, browser and upgrade checks pass.
