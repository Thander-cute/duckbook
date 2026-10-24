# Duckbook production: architecture research

**Status:** draft — research and recommendations only; not approved for implementation.
**Date:** 2026-10-25.
**Decision link:** needs decision. This proposal does not change `docs/DECISIONS.md`.

## Owner wishes

The owner considers the web functionality substantially sufficient and wants a production direction centered on UI/UX, desktop and Android apps, private user-owned data, cross-device sync for the same account, optional user-chosen storage such as Google Drive or self-hosting, and Google Calendar integration. The request is for research and planning only.

The earlier decision to use a local browser UI without Tauri remains the implemented baseline. This request reopens architecture discussion; it does not approve a framework, cloud service, account system, encryption design, or mobile redesign.

## Recommendation

Keep the notebook's React design and planner domain. Build local-first installed clients with native SQLite, optional encrypted sync, and a separate Calendar connector. Recommend evaluating **Tauri desktop + Capacitor Android** first. Keep **Electron desktop + Capacitor Android** as the lower-rewrite alternative if reusing the current Node storage backend matters more than footprint. Final shell selection depends on a small synthetic-data prototype, not documentation alone.

Do not require a Duckbook account to open a local notebook. For the first sync model, one storage account plus one encrypted vault can identify the same notebook on multiple devices. A device also needs the vault key, obtained by recovery secret or approved pairing; signing into Google alone must not decrypt it. A separate Duckbook account is a later product decision, particularly if offering a managed relay.

Treat web access as a distinct product decision. Retain the current browser + local Node mode during migration. A hosted web editor can share React and the domain, but would need browser storage, OAuth, key handling and its own durability expectations. Do not silently turn the existing local app into a hosted SaaS.

## What the repository establishes

Reviewed source and documentation only; no personal data directory, database, browser storage or live production server was accessed. No runtime/performance benchmark was performed.

| Existing foundation | Implication |
|---|---|
| React + Vite; views and notebook CSS already established | Reuse the visual system and business behavior; a native rewrite is not required to ship apps. |
| `schema.ts` is shared, independent of DOM and Node | A useful starting point for a shared domain package. |
| `store.ts` combines domain edits, browser lifecycle and HTTP persistence | Separate these responsibilities gradually behind a repository interface. |
| `server/db.ts` stores page JSON with revisions and atomic batches | Keep durability guarantees; local revisions alone are not a distributed sync protocol. |
| Conflict resolution currently chooses all local pending pages or the server version | Too coarse for comfortable multi-device editing. Preserve concurrent branches and resolve narrowly. |
| All pages load into memory; refresh retrieves all docs | Measure with synthetic multi-year notebooks before changing to windowed reads/subscriptions. |
| Pending and parked edits live in frontend memory until the server accepts them | Installed clients need a durable local transaction and outbox before reporting a local save. |
| Photos are separate hash-addressed JPEG files; JSON export contains references only | A portable archive must include photo bytes, metadata and a verified manifest. |
| PIN gates access but storage is plaintext | Cloud E2EE and local at-rest protection are separate projects. |
| Many actions use hover; notebook grids have fixed dimensions | Android needs deliberate touch interactions and layouts, not only a wrapper. |

Documentation drift to reconcile during a production-readiness slice: `DATA-AND-PRIVACY.md` describes 30 automatic/20 manual backups, while `server/db.ts` implements time-based automatic retention and keeps 30 manual/20 pre-import-or-restore backups. Source inspection establishes the discrepancy, not which policy the owner wants.

## Client architecture options

These trade-offs are engineering judgments applied to this repository, not performance measurements.

| Option | Reuse and benefit | Cost / uncertainty | Fit |
|---|---|---|---|
| Tauri desktop + Capacitor Android | Reuse React, CSS, TypeScript domain; desktop system WebView; mobile native plugin bridge | Two native adapters/toolchains; port Node persistence for desktop; test WebView differences and plugin upkeep | Preferred candidate for a polished, relatively lean product |
| Electron desktop + Capacitor Android | Reuse React and much of Node backend; bundled Chromium provides a consistent desktop renderer | Desktop runtime footprint; still need Android storage implementation; Electron's bundled Node version must satisfy storage requirements | Best if faster desktop delivery and less backend rewrite dominate |
| Tauri for desktop and Android | Shared React and potentially shared Rust storage/crypto core | Need to prove Android OAuth, lifecycle, keyboard, secure keys and background work in one shell | Strong alternative if the prototype passes; do not reject just because mobile is newer |
| React Native Android + web desktop shell | Native mobile components and platform interaction model | Web DOM/CSS views need reimplementation; two presentation systems to maintain | Consider if measured WebView UX cannot meet requirements |
| PWA only | Simplest deployment; broad React reuse | Browser-managed persistence and mobile lifecycle do not match the current data durability preference | Companion/access route, not the only durable copy |

Tauri's SQL plugin lists desktop and mobile platforms and supports SQLite, but that does not establish encrypted SQLite support or feature parity for every plugin. Capacitor can be integrated into an existing web app; its SQLite option reviewed here is a community plugin, which introduces maintenance and compatibility obligations. Electron has a Node main process and Chromium renderer; keep storage behind narrow IPC, not direct Node access in renderer code. React Native uses native components, so sharing React knowledge does not mean sharing existing DOM views. Sources: [Tauri SQL](https://v2.tauri.app/plugin/sql/), [Capacitor](https://capacitorjs.com/docs), [Capacitor SQLite](https://github.com/capacitor-community/sqlite), [Electron processes](https://www.electronjs.org/docs/latest/tutorial/process-model), [React Native components](https://reactnative.dev/docs/components-and-apis).

## Proposed boundaries

```text
React notebook views + platform-specific navigation/layout
                         |
TypeScript planner domain: commands, validation, dates, invariants
                         |
Repository interface: transactions, queries, attachments, backup
       |                 |                    |
current Node adapter  desktop native       Android native
       |                 |                    |
                  local SQLite + photos
                         |
             durable outbox / sync engine
                         |
              encrypted remote objects
                         |
           selected storage or optional relay

Google Calendar connector -> separate local event cache/mapping
OS bridge -> OAuth, secure key storage, files, lifecycle, notifications
```

Do not introduce an elaborate monorepo immediately. First extract stable interfaces within the existing repository; split packages only when desktop/Android builds need it. A shared TypeScript sync coordinator is feasible for foreground use. Android background sync may need a native worker or common native core: a suspended WebView cannot be assumed to run JavaScript. Keep any native background implementation against the same protocol fixtures.

## User-owned storage and sync

SQLite is each device's working store. The remote holds encrypted, versioned changes and attachments; it is not a live shared `.sqlite` file. Copying a working database into a Drive-synced directory is not a multi-writer protocol and cannot preserve edits reliably across devices.

| Remote model | Ownership / UX | Operational trade-off | Recommendation |
|---|---|---|---|
| Local-only + portable encrypted archive | No account, user selects destination | Manual transfer; no automatic sync | Supported baseline and recovery path |
| User's Google Drive | Familiar account; user's quota | OAuth, provider limits, API policy questions; app must implement conflicts and integrity | Candidate after policy/technical validation |
| User's WebDAV or S3-compatible endpoint | User controls provider/server | URL/credentials setup, server differences, storage availability; not a turnkey consumer experience | Later advanced adapter; prove one implementation first |
| Duckbook-managed encrypted relay | Simplest onboarding and coordinated sync | Hosting cost, account lifecycle, metadata, abuse controls and service availability | Optional later if consumer UX warrants it |

A self-hosted Duckbook sync service can implement the same relay protocol. Avoid promising support for all arbitrary object stores in v1. Providers differ on listing consistency, conditional writes, upload limits and conflict behavior.

**Google Drive caveat:** the official Drive API terms explicitly list backup of user/app content as a use case requiring Google's prior written consent. This is a material release question for automatic backup; it is not proof that every document-sync product is forbidden. Validate Duckbook's exact usage with Google before committing to a Drive-backed production feature. Renaming backup to sync or choosing a different scope does not resolve the policy question. [Drive API terms](https://developers.google.com/workspace/drive/api/terms).

For a Drive document-storage integration, prefer narrow `drive.file` access to files created by or explicitly shared with the app, subject to validated use case. Do not assume access to a picked folder grants arbitrary access to all existing children. `appDataFolder` is hidden, app-specific and manually deletable by users; it cannot be browsed as ordinary Drive files, shared, moved between spaces or trashed. Its hidden nature is not encryption, and is less transparent for user ownership. [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata).

### Sync correctness requirements

- Each accepted edit commits local state plus an outbox entry in one transaction. UI distinguishes “saved on this device” from “synced”.
- Use unique operation IDs, device IDs, causal/base-version references and idempotent application. Do not order correctness solely by device wall clocks.
- Start by preserving existing page shapes with immutable version branches and three-way merge where safe. Introduce stable entity IDs only where justified; page snapshots and blind last-write-wins are insufficient for concurrent edits to the same content.
- Merge independent fields/items where safe. Conflicting journal text keeps both versions and offers a clear resolution. Concurrent delete/edit remains recoverable.
- A Focus move can touch an idea and multiple weeks. Transport/apply the logical batch atomically and validate planner invariants; do not sync its pieces independently and create duplicates.
- Keep tombstones and enough causal history for devices returning after long offline periods. Define full-resync behavior before compacting old operations.
- Upload immutable encrypted attachment objects, verify them, then publish the referencing commit. Pending/missing downloads are visible. Remote garbage collection must respect retained backups, branches and device acknowledgement policy.
- Avoid a single mutable manifest as the only source of truth. Use per-device append-only records plus versioned checkpoints; recover from partial upload, retry, duplicate listing and interrupted checkpoint publication.
- Restore creates a new explicit state transition or a separate recovered vault. It must not merely reset a local revision and let sync overwrite recovery with old remote state.

Do not start with a full CRDT conversion. For one person's devices, explicit conflict preservation may be enough. If real usage shows frequent concurrent text edits, evaluate Automerge on a bounded document type and measure history size, startup and merge semantics. CRDT convergence does not enforce cross-page planner invariants or supply E2EE automatically. [Automerge](https://automerge.org/docs/hello/).

## Privacy and account model

Recommended privacy contract, pending approval:

- Local-only mode requires no account and makes no third-party calls.
- Sync encrypts journal, tasks, photos and backups on the device before upload, using established authenticated-encryption implementations. Key derivation, nonce management, key rotation and format versioning require a reviewed design; no custom crypto primitive.
- A random vault key is protected through OS key storage and a recovery/pairing mechanism. The six-digit PIN remains a convenience access lock, not a cloud-encryption secret.
- New-device sign-in locates the vault but does not replace key possession. Losing every authorized device and the recovery secret means data cannot be decrypted by Duckbook support.
- E2EE does not conceal all metadata: provider/account identity, object sizes, access timing and some protocol metadata remain observable. Avoid plaintext journal titles/dates and raw photo hashes in remote filenames where unnecessary.
- Local database, photos, thumbnail caches, backups and exports need separate at-rest decisions. Encrypting uploads alone leaves plaintext local files. Evaluate SQLCipher or an encrypted-record design with secure key handling across both shells; stock SQLite is not encryption.
- Revoking a device stops future access when enforced and may require rotating keys. It cannot erase content or keys already copied to that device.
- Keep Google tokens device-local in protected storage. Diagnostics omit planner content, tokens and keys. Telemetry remains off unless separately approved.

Hosted web access, if later added, needs browser-specific threat and recovery design. Browser storage may be evicted; persistence requests do not replace independent recovery copies. [Browser storage behavior](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## Google Calendar: separate optional integration

Recommend two stages, rather than mapping every planner task to an event:

1. **Read selected calendars:** show events in Day/Week as a distinct layer. Cache for offline viewing; disconnect can remove the cache without touching notebook entries.
2. **Explicit time blocking:** user selects a task and publishes a time block to an app-created Duckbook calendar. Only the disclosed event fields go to Google. Journal, reflection, gratitude and photos remain private.

Calendar event text is visible to Google and to people with access to that calendar. Duckbook vault E2EE does not extend to Calendar. Show a small publish preview and allow a generic event title.

Request read scopes only when connecting calendars; request write scope only when enabling publishing. `calendar.app.created` supports secondary calendars created by the app and their events, reducing the need for broad write permissions. Determine required calendar-list and event-read scopes from the final flow. OAuth verification requirements must be checked against final scopes and distribution. [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

Keep event IDs, calendar IDs, recurrence identity, etags and local task mappings separate from journal documents. Handle time zones, daylight-saving transitions, all-day dates, recurring-instance exceptions, remote deletion and retry deduplication. A completed task does not imply deleting its historical event; deleting an event does not imply deleting its task.

Use incremental sync tokens; on HTTP 410 rebuild only the Calendar cache, preserving notebook data and queued outbound intent for reconciliation. Google push requires an HTTPS receiver, so a local-only first release should refresh on open/resume/manual request with backoff. A later relay can receive notifications. [Calendar sync](https://developers.google.com/workspace/calendar/api/guides/sync), [Calendar push](https://developers.google.com/workspace/calendar/api/guides/push).

Desktop OAuth should use the system browser and PKCE; Android should use Google's supported native authorization flow. Do not load Google authorization inside an embedded app WebView. Tokens and client configuration differ by platform. [Desktop OAuth and Android guidance link](https://developers.google.com/identity/protocols/oauth2/native-app).

## UI/UX direction

Preserve paper, typography, ink and the notebook mental model. Layout adaptations below are recommendations requiring agreement.

| Desktop | Android |
|---|---|
| Preserve wide notebook pages and keyboard-first editing | One primary page/section at a time; retain notebook visual character |
| Clear focus, shortcuts, undo and reliable window lifecycle | Day as a proposed landing view; quick task capture and reachable navigation |
| Hover enhancements may remain with keyboard equivalents | Essential actions visible or reachable by tap; no hover-only affordances |
| Canvas and calendar drag interactions | Tap/select-date alternatives to precision dragging; canvas list alternative |
| Subtle local-save and sync status | Keep edited field visible above keyboard; Android Back, text selection and resume behavior |

Make offline state calm: “Saved on this device; will sync when connected.” Reserve blocking UI for actual local-save failure. First-run local use should be immediate; optional sync setup can follow, with a recovery check before relying on a cloud copy.

Background Android sync is best-effort, not a real-time guarantee. WorkManager periodic jobs have a minimum interval of 15 minutes and execution is affected by OS scheduling; foreground open/resume sync should be the reliable interaction path. [Android WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work).

## Suggested slices and exit criteria

Each implementation slice needs a separate agreed plan using `docs/templates/slice-plan.md`. Sequence is a recommendation, not authorization.

| Slice | Scope | Exit evidence |
|---|---|---|
| 0. Shell and UX feasibility | Synthetic notebook in candidate shells; mobile Day/Week interaction prototype; OAuth callback/key-store feasibility | Real Windows and Android tests: typing/IME, keyboard, photos, resume/kill, persistence, memory and startup. Choose shell from results. |
| 1. Production local foundation | Repository boundary, complete portable archive, lifecycle-safe local writes, installer/update path | Restore archive with photos into empty temp location; interrupted write/update recovery; preserve API compatibility checks. |
| 2. Android offline notebook | Approved touch layouts and native persistence | Main notebook flows without network; force-stop after confirmed save loses no acknowledged edit. |
| 3. Encrypted vault and recovery | File format, keys, encrypted archive, pairing/recovery prototype | Restore on a second clean device; tampering fails visibly; no plaintext in intended encrypted artifacts. |
| 4. One sync provider | Durable outbox, conflict preservation, attachments, reconnect and account mismatch handling | Two-device offline edits, duplicate requests, concurrent delete/edit, clock skew, missing photos, partial uploads and old-client tests. |
| 5. Calendar read integration | Consent, selected calendars, separate cache, offline display | Time-zone/recurrence fixtures, revoked token, 410 resync with notebook preserved. |
| 6. Calendar publishing | Explicit task time blocks and mapping | No duplicate events after retry; clear edit/delete semantics and disclosure. |
| 7. Release hardening | Signed installers/update artifacts, Android distribution, migration and support procedures | Fresh install, upgrade, uninstall/reinstall expectations, recovery drill, privacy docs consistent with shipped behavior. |

Calendar read work can proceed independently once adapter/auth boundaries exist. Do not block local releases on every optional connector. No schedule estimate until shell, sync provider, release audience and threat model are agreed.

For every persistence/schema migration: synthetic fixtures only, verified backup before replace, read-back verification, explicit failure UX, original source retained for recovery. Changes to `src/lib/schema.ts` page shapes/keys require `API_LEVEL` bump and old-server testing. Keep launcher/server restart instructions while the local Node mode is supported. Native clients also need storage/sync protocol compatibility gates and must refuse unsupported writes without destroying local data.

Implementation validation should include existing typecheck/build, server/crash tests and browser tests; schema changes include `test:upgrade`. Add native lifecycle and distributed-sync tests where relevant. The research-only change does not require these execution checks.

## Decisions to make after reviewing this proposal

1. First public target: Windows + Android only, or also macOS/Linux? Windows + Android is the proposed initial scope.
2. Preferred trade-off: Tauri/Capacitor candidate versus faster Node reuse with Electron/Capacitor; confirm after slice 0.
3. Meaning of “same account”: storage account + vault identity initially, or a Duckbook-managed login from day one?
4. First remote: validated Drive use case, a selected self-hosted endpoint, or managed encrypted relay? Keep provider-independent format regardless.
5. Privacy guarantee for the first release: encrypted remote + encrypted portable backups, or also encrypted live local storage? Recommendation: resolve key recovery and local threat scope before claiming a privacy-focused production release.
6. Hosted editable web app required in the first release, or preserve local browser mode while installed clients become primary?

Unresolved technical questions include measured shell behavior, exact secure-storage and encrypted-database implementations, provider concurrency semantics, Drive use-case approval, and OAuth verification scope. These are explicit prototype/release gates, not claims of already-tested compatibility.
