# Slice: Focus Map (optional module)

**Status:** done (2026-10-22)
**Decision link:** DECISIONS.md, 2026-10-22 "continue" entry

## Why
Owner idea: list ideas, place them on an impact × difficulty map (left hard, right easy; top high impact, bottom low), and pick the worthwhile ones. This is an optional add-on beside the weekly Eisenhower matrix, not a replacement for it.
Owner, after checking the local foundation: "bên lead làm xong rồi, t check rồi, m giao cho nó làm tiếp đi". Supervisor picked Focus Map as the next bounded slice.

## Scope
- In:
  - A Focus tab, shown only when the module is on in Settings → Modules.
  - Idea list: add, edit, remove.
  - Map placement by drag, by click, by quadrant buttons, and by arrow keys.
  - "Add to week" turns an idea into a task in the chosen week, with a source link and duplicate prevention.
  - A small source marker on week tasks.
- Out: photos, Year view, mobile, AI, encryption, a plugin framework.

## Implementation choices (Lead)
- New singleton page `focus` = `{ ideas: [{ id, text, x, y, createdAt }] }`.
  - `x` runs from 0 (hard, left) to 1 (easy, right); `y` from 0 (low impact, bottom) to 1 (high impact, top). Both are `null` until the idea is placed.
  - Stored and backed up like any other page; strict validation on save.
- `settings.modules.focusMap` (default off). Turning it off hides the tab and the markers. The `focus` page is never deleted.
- Linking lives only on the task: `WeekTask.ideaId`. The idea's "in Week N" state is derived from week tasks, so deleting a task never leaves a stale link behind.
- Duplicate prevention: one task per idea per week. The button becomes "Already in this week" when one exists.
- Promoted ideas land unsorted in "Tasks of the week", so urgency and importance are still decided on the Eisenhower page. Ideas carry no dates and are never overdue.
- Target week = the week shown in the top bar (‹ › to change it), also named on the button.

## Data impact
- New optional doc key `focus`, new optional fields `settings.modules` and `WeekTask.ideaId`.
- Older exports, backups, and databases without them load with defaults. No migration is needed.

## Done when
- [x] API: focus page saves and validates; backup/restore round trip includes it; old exports import cleanly.
- [x] Browser: enable, add, place (button + keyboard + click), promote, duplicate blocked, task in week with marker, disable hides it and re-enable shows the ideas again.
- [x] typecheck, `npm test` (11), build, browser checks (16) pass.
