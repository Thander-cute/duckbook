# Duckbook archive format, version 1

A complete, portable copy of one notebook: every page and every day photo in one file. Web, desktop and the Android app read and write the same format. Each app keeps its own local storage; the archive is the agreed exchange format, so the apps share data meaning, not code.

Engineering choice (Lead, 2026-10-25), not an owner decision. Change it only with a new `formatVersion`.

## File

- A ZIP file named `duckbook-YYYYMMDD-HHMMSS.duckbook.zip`. A plain ZIP, so a person can open it with any unzip tool.
- Writers use the STORE method (no compression; JPEGs don't shrink). Readers accept STORE and DEFLATE, so an archive re-zipped by a tool still imports. Other methods, encryption, ZIP64 and multi-disk archives are refused.
- Not encrypted. It is as private as the folder it sits in.

## Entries

Only these names are allowed. Any other entry, duplicate name, absolute path, `..`, backslash or directory entry makes the archive invalid.

| Entry | Content |
|---|---|
| `manifest.json` | Must exist. UTF-8 JSON, below. |
| `notebook.json` | Must exist. UTF-8 JSON: `{ "docs": [{ "key": string, "value": object }], "quarantine": [{ "at", "source", "path", "value" }] }`. Keys and values are exactly the pages of `src/lib/schema.ts` (`month:YYYY-MM`, `week:YYYY-MM-DD`, `day:YYYY-MM-DD`, `settings`, `focus`, `spans`). `quarantine` may be empty. |
| `photos/<sha256>.jpg` | One per photo. The name is the lowercase hex SHA-256 of the file's bytes. |

## manifest.json

```json
{
  "format": "duckbook-archive",
  "formatVersion": 1,
  "createdAt": "2026-10-25T09:30:00.000Z",
  "app": { "name": "duckbook", "platform": "web" },
  "schemaVersion": 1,
  "apiLevel": 5,
  "notebook": { "file": "notebook.json", "bytes": 12345, "sha256": "<hex>" },
  "summary": { "months": 2, "weeks": 9, "days": 40, "first": "2026-09-01", "last": "2026-10-25" },
  "photos": [{ "id": "<sha256>", "bytes": 81234 }],
  "missingPhotos": ["<sha256>"]
}
```

- `platform` is `web`, `desktop` or `android`; informational only.
- `apiLevel` is the writer's `API_LEVEL`. A reader that sees a higher `apiLevel` or `schemaVersion` than its own refuses the archive ("made by a newer duckbook"), so newer page shapes are never normalized away.
- `formatVersion` above 1 is refused.
- `photos` lists every photo file in the archive. `missingPhotos` lists photos the pages refer to that the writer did not have; the reader reports them, it doesn't fail on them.

## Reading (all apps)

1. Bound the input before trusting it: total size, entry count (pages + photos + 2), per-entry size (photo ≤ 15 MB, notebook ≤ 200 MB), declared vs. actual sizes.
2. Check entry names as above, `manifest.json` shape and versions, `notebook.json` byte size and SHA-256, and every photo's SHA-256 against its name and the manifest.
3. Normalize every page with the app's schema rules. Unknown keys or invalid pages make the whole archive invalid; odd values inside a valid page go to quarantine as in a JSON import.
4. Only then change anything: store photo files (content-addressed, so adding them never overwrites another photo), take a verified backup of the current pages, replace all pages in one transaction, and read everything back. Report success only after the readback matches and every referenced photo in the archive is present and hash-correct.
5. Any failure before step 4 leaves the target untouched. A failure during step 4 leaves the previous pages in place or in the backup taken just before, and says which.

Lock settings (PIN) are not part of an archive and are never replaced by an import.

## Legacy input

- `duckbook-export` JSON (`formatVersion` 1, from Settings → Data → Export before archives) still imports. It holds page text and photo names only, so the import says how many photos are not on this device.
- A bare state object (the old browser `duckbook:v1` shape) is handled by the existing legacy move, not by the archive reader.

## Fixtures

`test/fixtures/archive/` holds synthetic archives every app's tests use: a valid one with photos, and broken ones (bad checksum, missing manifest, path traversal, newer version, truncated file). Never put real notebook data there.
