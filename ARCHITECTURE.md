# Architecture

## Boundaries

- The browser and desktop share the notebook UI and document meaning. The local server owns SQLite persistence and media files; browser storage is not the authoritative notebook.
- Electron owns window and local-runtime lifecycle. Its sandboxed renderer has no Node access; privileged operations cross a narrow, sender-checked bridge.
- Browser and desktop notebooks are separate. Import is explicit; opening the desktop app must not silently adopt or modify the browser notebook.
- Optional Google Drive sync moves operations and referenced media directly between the local runtime and Google. Local writes do not wait for the network. The public OAuth website does not host notebook data.
- Desktop updates use a separate release feed. Availability, download verification and installer launch are distinct states; attempting to launch an installer does not prove installation succeeded.

## Invariants

- Preserve acknowledged edits, existing plain journal text and media references when extending documents. Schema validation, sync, backup, export/import and media retention must agree on new fields and file types.
- Document shape or key changes require an `API_LEVEL` bump. A new UI must refuse to save through an incompatible old runtime.
- Before destructive replacement, preserve a verified recovery path. Missing media and failed writes must remain visible rather than silently dropping content.
- Closing for an update requires a successful flush and clean runtime shutdown. The normal close dialog's unsaved-data bypass must not become an update-install bypass.
- The PIN is an access lock. Local files and current Drive sync are not encrypted; do not imply otherwise.
- Optional features must preserve their data when disabled. Feature-specific editing controls may disappear without deleting saved content.
- Test only with synthetic notebooks and isolated runtime/profile paths. A test server must own its port and data directory; it must never fall back to an already running notebook.

Release procedures live in [docs/RELEASING.md](docs/RELEASING.md). Current task progress and historical decision records do not belong in this file.
