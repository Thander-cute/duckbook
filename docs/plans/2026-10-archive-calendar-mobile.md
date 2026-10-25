# Slices: complete archive, Google Calendar (read-only), Android app

**Status:** agreed (owner authorization via Supervisor, 2026-10-25); in progress.
**Decision link:** `docs/DECISIONS.md`, 2026-10-25, "Features on the local web first, then Android in React Native".

## Why (owner)

The owner says the UI is finished and asks for features on the existing local web app first, keeping the notebook UI, and a React Native mobile app now (this replaces the earlier Android deferral). Storage has to make sense across web, desktop and mobile. Accepted direction: keep SQLite plus photo files locally, common data meaning and a complete portable archive; no user-managed folder vault. Google Calendar may be implemented.

**Not decided by the owner** (do not build): a hosted website, accounts, cloud sync or its provider, encryption and recovery design, writing events to Google Calendar. "Web" means the current localhost app. The PIN stays an access lock.

**Engineering choices (Lead), not owner requests:** archive format in `docs/ARCHIVE-FORMAT.md`; read-only selected calendars as the first Calendar scope; Android as a separate `mobile/` app with its own build and storage; order of slices.

## Slice 1: complete archive (web + desktop server)

- In: Settings → Data export of every page and every photo as one archive (manifest, checksums); import with validation and staging, verified backup before replace, readback; old JSON export still imports and reports missing photos. Synthetic fixtures shared with the Android app.
- Out: encryption, automatic off-machine copies, scheduled archives.
- Data impact: no page shape or key change, so no `API_LEVEL` bump. New endpoints only; a stale server is restarted by the launcher's fingerprint check. Imports add photo files (content-addressed) and replace pages after a backup, like the existing import.
- Done when:
  - [ ] Export → import into a fresh synthetic data dir matches pages and photo bytes.
  - [ ] Damaged, partial, oversized, traversal and newer-version archives are refused with a visible reason and the target unchanged.
  - [ ] Failure during replace keeps the previous pages (or the pre-import backup) and says so.
  - [ ] Legacy JSON export imports with a missing-photo count.
  - [ ] typecheck, `npm test`, `test:browser`, `test:upgrade`, `desktop:test` pass; checked in a browser and in the desktop app.

## Slice 2: Google Calendar, read-only (web/desktop)

- In: opt-in connect in Settings → Add-ons via OAuth (loopback redirect + PKCE, the installed-app flow), choose calendars, events cached separately from notebook pages and shown read-only on Day/Week (offline from cache), refresh, disconnect that revokes and deletes the token and cache. Scopes: `calendar.calendarlist.readonly` and `calendar.events.readonly` only.
- Out: creating or editing events, any write scope, push notifications, a Duckbook backend, the owner's real account or a Google Cloud project made by an agent.
- Data impact: separate SQLite tables for token and cache; nothing in pages, archives or backups. Token is plaintext at rest like the notebook (stated in the privacy doc).
- Done when: works end to end against a mock provider in tests; real use needs the owner to create an OAuth client (setup steps documented); live validation is reported as not done until then.

## Slice 3: Android app (React Native)

- In, in order: Day and Week usable offline with native SQLite and photos stored in app-private storage; archive export/import compatible with slice 1 fixtures; then Month, Focus, Reflect, Settings, photos, timer as further slices. Touch layouts with the notebook's paper, ink and type, not the desktop page shrunk or a WebView.
- Out: sync, accounts, cloud builds, signing purchases, store publishing. Android auto-backup of plaintext off.
- Data impact: own database in the app sandbox, same page keys and value shapes as `src/lib/schema.ts`.
- Done when (Day/Week prototype): debug APK builds locally, runs on an emulator, survives force-stop after a save, imports and exports a fixture archive. Not full parity until the later slices land.

## Review findings carried forward (read-only review, 2026-10-25)

Routed into the slices: quarantine travels with archives; readback compares normalized pages after commit (also fixes a false "did not match" in backup restore); photo GC keeps quarantined photo refs and doesn't race imports; Monday week keys; 32 MB notebook / no ZIP64 cap in v1; Calendar token and cache in a separate database file so backups never copy them.

**For the owner to decide later (not blocking):**
- Android keeps the only copy in app-private storage with OS backup off; uninstall or "Clear storage" deletes it. How prominent an export reminder should be is the owner's call. Phone-to-phone transfer is excluded by default.
- Archives are snapshots: importing replaces everything (previous pages stay in the pre-import backup); there is no merge.

**Before any sync (prerequisites, not a design):** stable unique ids for every list item (Month goals are positional today; legacy items get path-derived ids; `uid()` is 48 bits); device-independent versions and tombstones (revisions are a per-database counter); a decision on merge granularity (a day page is one unit); explicit shared vs per-device settings; photo GC aware of remote references; encryption decided before anything leaves the machine.
