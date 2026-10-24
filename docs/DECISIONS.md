# Decisions

Only **Decided** entries are approved for implementation. Add a dated entry when the owner decides something; move items out of **Open** instead of deleting them.

## Decided

| Date | Decision | Source |
|---|---|---|
| 2026-10-21 | Single local machine first; mobile later. | Owner: "Trên máy trước, mobile sau" |
| 2026-10-21 | Set up Git and a lightweight repo template for ongoing work. | Owner |
| 2026-10-22 | Make it usable for the owner first; shipping to other people later. Web UI in the browser, not an installed desktop app (no Tauri). | Owner: "làm cho t xài trước đi, chuyện ship cho người ta để sau chưa cần" |
| 2026-10-22 | Browser-only storage (IndexedDB) is too risky. Keep the web UI, but store data outside the browser through a local background process. Future mobile can use SQLite. | Owner steering, then "ok làm đơn giản trước thôi" |
| 2026-10-22 | Optional privacy lock in Settings: 6-digit PIN, minimal blank/blurred screen, correct PIN enters. Backup settings in Settings. | Owner |
| 2026-10-22 | Owner checked the local foundation and asked to continue. Supervisor picked Focus Map as the next bounded slice (the established next candidate; this does not approve the rest of the backlog). | Owner: "bên lead làm xong rồi, t check rồi, m giao cho nó làm tiếp đi" |
| 2026-10-23 | Focus Map as paper sticky notes on a wide canvas with a tray. Optional planned date and states Idea / In progress / Completed, with filters. A planned idea is one work item, consistent across Focus, Week, and Day. Settings becomes a dedicated paper page with tabs (Notebook, Focus timer, Privacy, Data, Add-ons). | Owner-approved UX slice |
| 2026-10-22 | Month: notes for a range of days. Drag a hand-drawn line with arrowheads across days and write on it, anywhere along it; a range may cross months, and its from/to days are edited in a light editor. | Owner: "giống bản giấy, kéo 1 đường dài… vắt qua 2 tháng cũng được" |
| 2026-10-22 | Day photos: up to 3 per day on the Day page's right side; the Month page marks days with photos and opens them in an overlay viewer. | Owner: "thêm hình vào, cho tối đa 3 tấm thôi… bấm vào coi trực tiếp trong trang tháng" |
| 2026-10-24 | Duck head logo (owner's drawing) on the PIN screen and tab icon, name under it; Paper setting White / Cream to switch between the blue and a calmer cream-and-linen look. | Owner: "cái này đi, làm logo được nè", "thêm chữ duckbook đi", "cho đổi qua đổi lại đi, cái màu vàng nhìn nóng" |
| 2026-10-24 | Month: drop the mood tracker, month notes take its column; the Weeks list becomes a narrow week column in the calendar with marks to read the week's goal and reflection. | Owner: "bỏ cái mood ở trang month đi… để note ở chỗ mood cho giống nguyên bản… mỗi tuần 1 dòng trong bảng month… 1 logo để đọc goal, 1 logo xem reflection" |
| 2026-10-24 | Habit marks setting: Ink dot, Hatched circle or Ticked circle, always round (browser-local, like Paper; no data change). Week quadrant hints open out of the A–D letter on hover instead of overlapping it. | Owner: "cho nhiều lựa chọn đi, cái chấm tròn đen đó, rồi tô mà kiểu gạch gạch hết ô á, với đánh dấu tick", "chỗ A B C D… nó overlay, kiếm chỗ khác display tốt hơn" |

### Production direction (owner decisions; desktop scope authorized below)

| Date | Decision | Source |
|---|---|---|
| 2026-10-25 | Plan desktop with Electron + React and Android with React Native. This supersedes the browser-only direction for future installed apps; the current browser app remains the implemented baseline. Earlier alternative framework proposals are superseded. Plan only; approve implementation slices separately. | Owner: "xài react native với electron đi", then "ok, plan đi" |
| 2026-10-25 | Code sharing and reuse are optional, not architecture objectives. Optimize each client for its platform and product UX; interoperability must not require a shared UI or codebase. | Owner: "không quá quan trọng việc dùng chung" |
| 2026-10-25 | Implement only an Electron desktop app from the current web app, preserving its existing notebook UI, features and local-data guarantees. This supersedes the earlier plan-only restriction for this bounded desktop conversion. Android, sync, new encryption/recovery features and Google Calendar remain deferred; the broader production roadmap is not approved. Delivery belongs to the existing Lead; this planning session only finalizes documents. | Owner: "làm cái app hiện tại web app thành desktop app được rồi, cái t kêu thì chưa"; supervisor coordination confirms desktop implementation authorization |

### How these were implemented (agent decisions within the approved scope)

- Node server on loopback (`server/`, built-in `node:sqlite`, no native dependencies). It serves the built app at `http://localhost:5317`, the exact origin of the earlier localStorage data.
- Data lives in `%LOCALAPPDATA%\Duckbook` (per user, outside the repo and the browser): `duckbook.sqlite`, `backups/`, `logs/`.
- The PIN is an access lock checked by the server. It is **not** encryption. At-rest encryption, recovery flows, and vaults are deferred.
- Migration from `localStorage['duckbook:v1']` only runs when the user clicks. It is verified page by page, and the browser copy is kept until the user removes it.
- Launch with `Duckbook.cmd` (optionally a desktop shortcut). No terminal is needed for daily use.
- Desktop app (2026-10-25, see `docs/plans/2026-10-production-plan.md`): Electron 43 window over the same `server/` code, run in a utility process with Electron's Node (`node:sqlite` works there), loopback port 5327, per-launch token on every API call. Its notebook is separate (`%APPDATA%\duckbook\notebook`); the browser version's database is read only when the person asks, refused while that server runs, from a temporary snapshot, with photos hash-checked and a verified backup before replace. Unsigned NSIS per-user installer; no auto-update.
- The earlier IndexedDB/crypto drafts are archived on branch `archive/indexeddb-vault-draft`. They were never used or tested.
- Focus Map (see `docs/plans/2026-10-focus-notes-settings.md`):
  - Optional module, off by default; turning it off hides it and keeps its data. It sits beside the Eisenhower matrix, not in place of it.
  - Ideas live in a `focus` page with map coordinates. The idea holds title, state, and planned date. Planning creates or moves one week task linked by `ideaId`. Every edit goes through `editWork()` and lands in one save.
  - Older ideas have no stored state: it is derived from their planned copies when read, never invented by validation. Earlier one-task-per-week copies are kept and stay in sync.
- Month spans (see `docs/plans/2026-10-month-spans.md`):
  - Ranges live in their own `spans` page, one entry per range, so a range across months is never split.
- Date picking and short choices use the notebook's own calendar (`DatePicker.tsx`) and menu (`Menu.tsx`) instead of the browser's controls (owner found them ugly). A picked date applies at once, so half-typed dates can't occur.
- Paper choice lives in this browser's `localStorage['duckbook:paper']`, not in the notebook data: the lock screen needs it before unlocking, and the page shapes and `API_LEVEL` stay as they are.
- Day photos (see `docs/plans/2026-10-day-photos.md`):
  - Photos are JPEG files named by their hash in `photos/`, outside SQLite, so backups stay small and share them.
  - Files are kept while the pages or any kept backup refer to them.
  - The export has references only.
- Update safety (found in Supervisor review of `ad3eafe`):
  - A server left running from before an update would reject Focus Map saves, failing the whole save batch, and would silently drop `settings.modules` and `ideaId`. This was reproduced on a synthetic instance.
  - Guard: `API_LEVEL` handshake (now 5: 3 Focus notes, 4 spans, 5 photos). The page shows an "updated" screen and edits nothing until the server matches.
  - Every write carries `X-Duckbook-Api`; the server refuses another version's writes with a "reload this tab" message.
  - The launcher compares a code fingerprint and offers to restart a stale server after building.

## Open (under discussion, not approved)

- Modular, optional features (no marketplace).
- At-rest encryption of the database and backups; off-machine backup location.
- Optional AI (task breakdown, weekly recall/chat). No data is sent and no AI is enabled until this is decided.
- Year view: scope undefined.
- Photo captions, and showing day photos in Reflect (photos themselves were decided 2026-10-22).
- Mobile layout and sync.
- Production implementation slices, first release platforms/audience, account model, sync storage provider, encryption/recovery design, and Google Calendar scope. See `docs/plans/2026-10-production-plan.md`; these recommendations are not yet approved.
- Meaning of the two orange "Graphics" icons the owner shared: unclear, not adopted as a theme.

## Background

- `IDEA.md`: original product analysis and design language (2026-10-19).
- `docs/DATA-AND-PRIVACY.md`: where data lives, what the lock does and doesn't do, and backups.
