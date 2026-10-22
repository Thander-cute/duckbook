# duckbook

A minimalist planner after *The Present Day Planner* (The Present Writer), for personal single-user use on this computer.
See [IDEA.md](IDEA.md) for the product idea, [docs/DECISIONS.md](docs/DECISIONS.md) for what is decided, and [docs/DATA-AND-PRIVACY.md](docs/DATA-AND-PRIVACY.md) for where data lives and what the PIN lock does.

## Use

Double-click **`Duckbook.cmd`**. It starts a small background server (once) and opens **http://localhost:5317** in your default browser.

- First time: run `Duckbook.cmd --shortcut` to put a **Duckbook** shortcut on the desktop.
- Stop the background server: `Duckbook.cmd --stop`.
- Requires Node.js 24+. The first launch installs and builds automatically.

Your pages are stored in `%LOCALAPPDATA%\Duckbook\duckbook.sqlite`, with automatic verified backups in `backups\` beside it. Copy that folder elsewhere now and then: backups on the same disk don't survive a lost disk.

**Pages from the earlier version** (kept in your browser) are offered for moving the first time you open the new duckbook, in the same browser you used before at `http://localhost:5317`. Moving is verified, and the browser copy is kept until you remove it in Settings.

## Develop

```bash
npm install
npm run typecheck
npm test                 # server, storage, PIN, crash-safety tests
npm run build
npm run test:browser     # browser checks on a throwaway server (port 5399, synthetic data)
```

`npm run dev` runs the Vite UI alone, without a server, so it only shows the "server isn't running" screen. Test UI changes with `npm run build` plus a server on a spare port and a temp data dir:

```bash
DUCKBOOK_PORT=5398 DUCKBOOK_DATA_DIR=/tmp/duckbook-dev node server/main.ts
```

Never point development at port 5317 or at the real data directory.

Working agreement: [AGENTS.md](AGENTS.md). Plan larger changes with [docs/templates/slice-plan.md](docs/templates/slice-plan.md).

Keys: `← →` previous/next · `T` today · `M W D R` Month/Week/Day/Reflect · `F` Focus Map (when turned on) · `L` lock (when a PIN is set).

**Focus Map** (optional, Settings → Modules): jot ideas and place them on an impact × difficulty map (left hard, right easy; top high impact, bottom low). Place an idea with a zone button, by dragging, by clicking the map, or with the arrow keys. "Add to Week" puts it once into that week's unsorted tasks, ready for the matrix. Turning the module off hides it and keeps your ideas.
