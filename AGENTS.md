# duckbook: working agreement

A personal, single-user planner after *The Present Day Planner*. The notebook UI in `src/` is the product core; keep its look and behaviour unless a change is explicitly agreed.

## Before changing anything

- Read `docs/DECISIONS.md`. Only items marked **Decided** are approved. Everything under **Open** is still being discussed, so don't implement it.
- Owner wishes and agent recommendations are recorded separately. Never present a recommendation as something the owner asked for.
- Plan a non-trivial change as a slice (`docs/templates/slice-plan.md`) and get agreement before writing code.

## Private data

- The planner holds personal journal and to-do text. Never read, export, upload, or commit real user data. Test with synthetic fixtures only.
- Today's data lives in the browser's localStorage under `duckbook:v1`, bound to the exact origin `http://localhost:5317`. A different host or port shows an empty notebook (the data is still there, just unreachable).
- Any change that touches persistence, import, or migration must be non-destructive and show a way to recover.
- No network calls to third parties (fonts are self-hosted). No AI or cloud calls unless a decision says otherwise.

## Commands

```bash
npm install
npm run dev -- --port 5317 --strictPort   # same origin as the existing data
npm run typecheck
npm run build
```

## Conventions

- TypeScript + React 19 + Vite. State is in `src/lib/store.ts`; views live in `src/views/`, and shared pieces in `src/components/`.
- Match the surrounding code: small files, few comments, no new dependency without a reason.
- Commits are small and imperative ("Add focus map grid"). Use branches for anything larger than one sitting. `main` must always build.
- Verify UI changes in a browser, not just with a typecheck.
