# Slice plan: sync through Google Drive (desktop + local web)

**Status:** draft. Direction decided by the owner; slices need agreement before code.
**Decision link:** `docs/DECISIONS.md`, 2026-10-28 and 2026-10-30.

## Why (owner)

- Sync between devices, saving like Google Docs (backlog idea, `docs/BACKLOG.md`).
- Desktop and the local web app first; Android later.
- Like Zalo: install the app on each device, sign in with Google, done. No server.
- Both unencrypted and encrypted options; unencrypted sync first.

## Recommendation (Lead), not an owner request

### Starting point in the code

- Local autosave already exists: `store.ts` debounces edits and shows saved/pending/saving; `putDocs` saves pages with compare-and-swap. What is new is the cross-device part.
- Pages are stored whole (`day:…`, `week:…`); `rev` is local to one database. Syncing whole pages would lose text when two devices edit the same day, so sync works on smaller units.
- Desktop (`%APPDATA%\duckbook\notebook`) and the local web app (`%LOCALAPPDATA%\Duckbook`) are separate notebooks. Each is one sync "device", also on the same PC.
- Google OAuth (installed-app flow, loopback redirect + PKCE) exists for Calendar in `server/calendar.ts` on `feat/calendar-backend`, not yet on this branch. Sync reuses that flow.

### Shape

```
UI (unchanged) ─► store.ts autosave (unchanged)
                     │
             server putDocs ── one transaction ─► docs   (working pages, as now)
                     │                          └► oplog  (field-level changes)
                     ▼
              sync engine (server/sync/, background, in the app's own local server)
                     │  Google Drive API, scope drive.file
                     ▼
   My Drive / Duckbook Sync / <notebookId> /
        devices/<deviceId>/000001.json …   append-only, one writer per folder
        snapshots/<deviceId>-<n>.json      for a device joining late
        photos/<sha256>.jpg
```

- **No Duckbook server.** Each app talks to Google Drive directly from the local server it already runs (Node for web, the Electron utility process for desktop). Drive's push notifications need a public HTTPS endpoint, so the app polls instead.
- **Timing:** push a few seconds after a save; pull on open, on window focus and every 1–2 minutes while open. Expected delay about 1–2 minutes.
- **Only one device ever writes a given file**, so there are no Drive-level write conflicts. Changes are found with `changes.list` and a saved page token.
- **Ops are made on the server, not in the UI.** `putDocs` compares old and new pages and records ops like `day:2026-10-28 · tasks/<id>/done = true`, each with `opId`, `deviceId` and a hybrid logical clock (a wrong PC clock can't reorder edits). Invariant under test: replaying the oplog gives exactly `docs`.
- **Merge rules:**
  - Short fields (done, estimate, state, date, shared settings): the later edit by clock wins.
  - Lists (tasks, ideas, habits, spans, goals): keyed by id with an order key; deletes leave tombstones.
  - Long text (journal, reflection, notes): edits to the same field on two devices that haven't seen each other keep both versions; the page marks "2 versions" to choose. A text CRDT only if this happens often.
  - Photos: content-addressed, never conflict; uploaded before the op that refers to them.
- **Applying remote ops** patches `docs` and bumps `rev`, so open tabs pick changes up through the existing pull path; unsaved edits in a tab still go through the existing conflict check.
- **Joining:** the second device signs in to the same account and sees the notebook in Drive. If it already has pages, it asks "merge" or "replace with Drive", with a verified backup first.
- **Restore and import create new ops** to the restored state; they never rewind history, so sync can't overwrite a restore with older remote data.
- **Status:** "Saved on this device" and "Synced HH:MM" are separate. Failures (signed out, offline, quota, unreadable file) are visible and never block local saving.
- **Compaction:** periodic snapshots; old files removed only after every known device has caught up.

### Google setup (owner, once)

- No published Duckbook app exists, so the owner creates one OAuth client (Desktop app type) in their own Google Cloud project, as for Calendar. The same client is used on every device: with `drive.file`, a client only sees files it created.
- Set the project to **In production**. In Testing, Google expires the sign-in after 7 days and sync would stop weekly. `drive.file` is a non-sensitive scope, so no verification is needed for personal use.
- The Drive API terms list backup of user content as needing Google's consent; this matters only if Duckbook is offered to other people.

### Two options

- **Unencrypted (first):** files in Drive are plain JSON and JPEG. Google and anyone with access to the Google account can read the journal. Settings says this before sync is turned on, and `docs/DATA-AND-PRIVACY.md` is updated.
- **Encrypted (later):** the same files, encrypted on the device with a random 256-bit notebook key (AES-256-GCM, Node's built-in crypto). The first device shows a recovery code; each new device enters it once. Losing the code and every device means the Drive copy can't be opened. The PIN stays an access lock. An unencrypted notebook can be switched to encrypted, which rewrites the Drive copy.

### Slices

| # | Slice | Network | Data impact |
|---|---|---|---|
| 0 | Stable ids for every list item (Month goals are positional), `deviceId`, clock, shared vs per-device settings | none | Page shapes change: bump `API_LEVEL`, `test:upgrade` |
| 1 | Local oplog with every save; replay test | none | New table, not in pages |
| 2 | Merge engine and "2 versions" UI; two-simulated-device tests (offline edits, edit vs delete, clock skew, duplicate or missing files) | none | Conflict copies beside pages |
| 3 | Google sign-in (reuse Calendar OAuth) and unencrypted sync over the Drive API; Settings → Data: link, status, pause, unlink | Drive API | Token in a separate table, never in pages, archives or backups |
| 4 | Encrypted option and recovery code | Drive API | Key stored per app |
| later | Daily Drive backup (archive v1), Android | | |

Tests use a fake Drive (as Calendar uses a fake Google) and synthetic notebooks. No test touches the owner's real Drive, account or data dirs.

## Out

- Android sync, hosted web, a Duckbook server or account.

## Owner questions

1. Journal edited on two devices at once: keep both versions and choose (recommended), or merge the text automatically (CRDT, much more work)?
2. Is a 1–2 minute delay acceptable?

## Done when (per slice, filled in when agreed)

- [ ] Behaviour checks per slice above
- [ ] Existing pages and data unaffected; upgrade path tested
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `test:browser`, `test:upgrade`, desktop tests pass
- [ ] Checked in a browser and in the desktop app with two synthetic devices and a fake Drive
