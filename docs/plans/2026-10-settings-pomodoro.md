# Slice: clearer Settings and a reworked Day pomodoro

**Status:** done (2026-10-25)
**Decision link:** 2026-10-25 pomodoro and Settings row in `docs/DECISIONS.md`

## Why
Owner: "chỉnh trang settings với pomodoro ở trang day nữa. Cái pomodoro đó bị lỗi mà t cũng muốn setup nó khác đi nữa", "trang setting đang khá xấu mà hơi khó nhận thấy functional".
Owner on the bug: "cái timer nó không chạy". On Settings: "mấy cái bookmark thấy nó sao sao á. Có thể tham khảo settings của claude đi, 1 cái tab mở lên cũng được mà style theo style của mình" (shared a screenshot of the Claude app's settings dialog).

## Findings (synthetic notebook on a spare port)
Settings
- Focus timer minutes can't be typed: the field clamps on every keystroke, so typing 40 gives 50 and typing 25 gives 55.
- Controls don't read as controls. The minute fields are bare underlines, "restore…" is small grey italics, and the Add-ons switch is a plain checkbox.
- The section tabs sit outside the paper and look disabled. A short section leaves a mostly empty sheet.
- Grey help text under every row has low contrast. Raw folder paths in monospace crowd the Data tab.
- The Settings icon in the top bar looks like a sun (brightness).

Pomodoro on Day
- **The countdown on screen never moves** (the owner's bug). The tick notifies React but hands back the same state object, so `useSyncExternalStore` skips the re-render. The tab title counts down, and the block still ends and credits a circle on time.
- The timer lives only in memory. A reload, a lock-and-reload, or a desktop restart silently loses the running block.
- Starting ▶ on another task replaces the running block without asking.
- The bottom bar sits over the page foot ("My day in one sentence").
- Each task row shows an estimate stepper plus ten circles under a 1–10 header, which makes two controls for one idea and a heavy grid.
- In a background tab or minimized window, the end can come up to a minute late, and only the tab title and a chime tell you.

## Scope (proposal)
- In, Settings: a dialog over the current page, after the Claude settings dialog but in notebook style. It has a left index with icons and group names, the chosen section on the right, ✕ or Esc to close, and you stay where you were. Each setting is a row: name and one line of help on the left, the control on the right (switch, segmented choice with preview, − n + stepper, button). The paper bookmark tabs go away. There is no search: there are too few settings to need it. The gear icon is redrawn.
- In, pomodoro fixes: the countdown on screen ticks, the minute field works, a running block survives reload (localStorage, like Paper), starting another task asks first, and the bar no longer covers the page.
- In, pomodoro setup: the timer opens over the notebook in one of three modes, switchable while it runs. Overlay is a paper card in the middle over a dimmed notebook. Mini is a small card in a corner, and you keep using the notebook. Full screen shows only the task and the clock, in OS fullscreen. The default mode is set in Settings → Focus timer, kept in localStorage. Task rows show only their planned circles (filled when done) plus + to add, with no 1–10 header. The running block is stored without its task text; the name is read from the notebook when unlocked.
- Out: backup, restore, import and PIN behaviour and their messages stay as they are, restyled only.

## Data impact
Settings: none. Pomodoro: none if the running block lives in localStorage. A schema change (for example long breaks or per-task history) would need `API_LEVEL` and an upgrade check.

## Order
1. Pomodoro fixes. 2. Timer modes and compact task rows. 3. Settings dialog.
Long breaks, free timers and system notifications are deferred.

## Done when
- [x] Owner agreed the Settings layout and the pomodoro setup
- [x] Minutes can be typed or stepped to any allowed value; a running block survives reload (`test:browser` Pomodoro step)
- [x] Existing pages and data unaffected (no schema or `API_LEVEL` change)
- [x] `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser` pass
- [x] Checked in a browser (screenshots of each timer mode and Settings section on a synthetic notebook)

## Notes
- Settings keeps its `#/settings` route, Esc and return-to-page behaviour. The page you came from stays rendered (inert) behind the dialog.
- New browser-local keys: `duckbook:timer` (running block, no task text), `duckbook:timer-view` (default mode), `duckbook:timer-spot` (where the small card sits).
