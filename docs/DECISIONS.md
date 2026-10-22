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

### How these were implemented (agent decisions within the approved scope)

- Node server on loopback (`server/`, built-in `node:sqlite`, no native dependencies). It serves the built app at `http://localhost:5317`, the exact origin of the earlier localStorage data.
- Data lives in `%LOCALAPPDATA%\Duckbook` (per user, outside the repo and the browser): `duckbook.sqlite`, `backups/`, `logs/`.
- The PIN is an access lock checked by the server. It is **not** encryption. At-rest encryption, recovery flows, and vaults are deferred.
- Migration from `localStorage['duckbook:v1']` only runs when the user clicks. It is verified page by page, and the browser copy is kept until the user removes it.
- Launch with `Duckbook.cmd` (optionally a desktop shortcut). No terminal is needed for daily use.
- The earlier IndexedDB/crypto drafts are archived on branch `archive/indexeddb-vault-draft`. They were never used or tested.
- Focus Map (see `docs/plans/2026-10-focus-map.md`):
  - Optional module, off by default; turning it off hides it and keeps its data.
  - Ideas are stored in a `focus` page with map coordinates.
  - "Add to week" creates one unsorted task per idea per week, linked through `WeekTask.ideaId`.
  - Ideas carry no dates or deadlines.
  - It sits beside the Eisenhower matrix, not in place of it.

## Open (under discussion, not approved)

- Modular, optional features (no marketplace).
- At-rest encryption of the database and backups; off-machine backup location.
- Optional AI (task breakdown, weekly recall/chat). No data is sent and no AI is enabled until this is decided.
- Year view: scope undefined.
- Memory photos and captions on the Day page, surfaced in Reflect and Month (the attachments folder belongs beside the database).
- Mobile layout and sync.
- Meaning of the two orange "Graphics" icons the owner shared: unclear, not adopted as a theme.

## Background

- `IDEA.md`: original product analysis and design language (2026-10-19).
- `docs/DATA-AND-PRIVACY.md`: where data lives, what the lock does and doesn't do, and backups.
