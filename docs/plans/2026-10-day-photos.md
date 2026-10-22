# Slice: up to three photos a day, seen from the Month page

**Status:** done (2026-10-22)
**Decision link:** DECISIONS.md, 2026-10-22 "Day photos" (owner)

## Why (owner)
- Use the empty right page of a Day to keep up to 3 photos as keepsakes.
- On the Month page, a day with photos shows a small photo mark in its top-right corner. Clicking it opens an overlay viewer right there.

## Design (Lead)

**Files**
- Each photo is a JPEG file in `<data dir>/photos/`, named by the sha256 of its bytes.
- The Day page keeps references only: `photos: [{ full, thumb, w, h }]`, at most 3.
- Backups stay small (SQLite only) and share photo files instead of copying them.

**Preparing on the client**
- The browser decodes the picked image with EXIF orientation and scales it: full to a 2048 px long edge, thumb to 480 px.
- Both are re-encoded as JPEG and uploaded separately.
- Formats Chrome can't decode (e.g. HEIC) are refused with a message.

**Server**
- `POST /api/photos` takes raw JPEG bytes (≤ 15 MB, magic-number checked). It writes via temp file + rename and returns the hash.
- `GET /api/photos/<hash>` returns the bytes with `Cache-Control: no-store`.
- Both routes sit behind the PIN lock and the app header like every other private route. Uploads also need the current `X-Duckbook-Api`.

**Viewing**
- The page fetches photos through the API into in-memory blob URLs, so no `<img>` URL bypasses the app header.
- Locking revokes and forgets them.

**Removal and cleanup**
- Removing a photo from a day only edits the page.
- On server start and after each automatic backup, files referenced by neither the live pages nor any kept backup, and older than a day, are deleted.
- Restoring any kept backup therefore always finds its photos.

**Export**
- The JSON export stays text-only and lists photo references, not bytes.
- An export imported on another computer shows "photo not on this computer" placeholders. Settings says so.

**UI**
- Day, right page, "Photos": polaroid frames, plus an add frame while fewer than 3.
  - Add by click, drop, or paste.
  - Hover a photo to remove it (with confirmation); click to open the viewer.
- Month cell: a small photo mark (with a count if more than 1) in the top-right corner.
- Viewer: a dimmed overlay with the photo on a paper mount, the date, and "n / m".
  - ‹ › and ← → step through all photos of the month; Esc or a click outside closes.
  - "Open day →" goes to the day.

**Compatibility**
- New day field, so `API_LEVEL` goes to 5.
- Days without photos are stored exactly as before.

## Out of scope
- Captions.
- Reordering.
- Photos on Week or Reflect pages.
- Photos inside the JSON export.
- Encryption at rest (the PIN is an access lock, as for all pages).

## Done when
- [x] Browser: add 4 synthetic images, keep 3 with a message; Month mark; viewer steps with arrows without turning the month; remove one; lock shows no images and forgets the tab's copies.
- [x] API: hash names, JPEG-only, app header and version required, `no-store`, at most 3 per day, days without photos unchanged; cleanup keeps files referenced by a backup or newer than a day; locked server refuses photo reads and uploads.
- [x] typecheck, `npm test` (17), build, browser checks (23), upgrade check from 4b2c7a2.
