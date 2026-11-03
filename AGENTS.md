# duckbook: working agreement

A personal, single-user planner after *The Present Day Planner*. The notebook UI in `src/` is the product core; keep its look and behaviour unless a change is explicitly agreed.

## Before changing anything

- Read `docs/DECISIONS.md`. Only items marked **Decided** are approved. Everything under **Open** is still being discussed, so don't implement it.
- Owner wishes and agent recommendations are recorded separately. Never present a recommendation as something the owner asked for.
- Plan a non-trivial change as a slice (`docs/templates/slice-plan.md`) and get agreement before writing code.

## Private data

- The planner holds personal journal and to-do text. Never read, export, upload, or commit real user data. Test with synthetic fixtures only.
- Pages live in SQLite at `%LOCALAPPDATA%\Duckbook` (served by `server/` on `http://localhost:5317`). Never open, copy, or query the real data directory, and never run development servers on port 5317. Use `DUCKBOOK_PORT` with a spare port and `DUCKBOOK_DATA_DIR` with a temp dir.
- The earlier version's data is in the browser's `localStorage['duckbook:v1']` at that exact origin. The app only reads it; removal is a user action after a verified move.
- Any change that touches persistence, import, or migration must be non-destructive, show failures visibly, and keep a way to recover (backups before replace, verify after write).
- The PIN is an access lock, not encryption. Don't describe it as more.
- The running server keeps the code it started with. Any change to a page shape or key in `src/lib/schema.ts` must bump `API_LEVEL`, so updated pages refuse to save through an old server. Update instructions must include a server restart (`Duckbook.cmd` detects and restarts a stale server). `npm run test:upgrade` checks this path.
- No network calls to third parties (fonts are self-hosted). No AI or cloud calls unless a decision says otherwise.

## Commands

```bash
npm install
npm run typecheck
npm test               # node --test: server, storage, PIN, crash safety
npm run build
npm run test:browser   # puppeteer-core + local Chrome, throwaway server on :5399
```

## Conventions

- TypeScript + React 19 + Vite for the UI. The Node 24 server runs `.ts` directly (type stripping, erasable syntax only) with built-in `node:sqlite`.
- `src/lib/schema.ts` is shared by browser and server (no DOM/Node imports). Client state and saving live in `src/lib/store.ts`; views in `src/views/`; shared pieces in `src/components/`.
- Match the surrounding code: small files, few comments, no new dependency without a reason.
- Commits are small and imperative ("Add focus map grid"). Use branches for anything larger than one sitting. `main` must always build.
- Verify UI changes in a browser, not just with a typecheck.
- Keep your own test runs focused on what you changed. Broad regression and packaged-app checks go to a separate test agent (owner, 2026-11-03).
