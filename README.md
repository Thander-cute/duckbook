# duckbook

A minimalist planner after *The Present Day Planner* (The Present Writer), for personal single-user use on this computer.
See [IDEA.md](IDEA.md) for the product idea, [docs/DECISIONS.md](docs/DECISIONS.md) for what is decided, and [docs/DATA-AND-PRIVACY.md](docs/DATA-AND-PRIVACY.md) for where data lives and what the PIN lock does.

## Use

Double-click **`Duckbook.cmd`**. It starts a small background server (once) and opens **http://localhost:5317** in your default browser.

- First time: run `Duckbook.cmd --shortcut` to put a **Duckbook** shortcut on the desktop.
- Stop the background server: `Duckbook.cmd --stop`.
- Requires Node.js 24+. The first launch installs and builds automatically.

### Updating

The background server keeps running the code it started with. After pulling or building a new version:

1. Let open duckbook tabs finish saving (no "Saving…" or "Not saved" in the top bar).
2. Double-click **Duckbook** again. If the server is from an older version, the launcher builds, asks **"Restart the server now?"**, and restarts it. Answer `Y`.
3. Reload any duckbook tab that was open from before.

If a page loads before the server is restarted, it shows **"duckbook was updated, but its background server is still running the old version"** and allows no editing until the restart. The page then continues by itself. Manual alternative: `Duckbook.cmd --stop`, then `Duckbook.cmd`.

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

Keys: `← →` previous/next · `T` today · `M W D R` Month/Week/Day/Reflect · `F` Focus Map (when turned on) · `L` lock (when a PIN is set) · `Esc` leave Settings.

**Month: weeks.** Month notes sit in the left column, as in the paper planner. Each week row has its number in the left margin, outside the table: the number (W43) opens the week, the target shows the week's goal, the look-back clock shows its reflection. The week strips are pale blue; the current week's is left white. A mark appears only when there is something written to show. Mood tracking is gone from the page; moods saved earlier stay in your data.

**Month: notes for a stretch of days.** Press a day number and drag to another day to draw a line, then write on it. Drag the words along the line to move them. Click the words or the line to change the text or the From/To days (a stretch may run into the next month) or to remove it.

**Day photos.** The right page of a Day keeps up to 3 photos: click "Add a photo", drop files on it, or paste. On the Month page a day with photos shows a small picture mark in its corner; click it to view them over the page (← → to step through the month's photos, Esc to close). Photos are stored as JPEG files in the data folder's `photos` folder, not inside the JSON export.

**Settings** (⚙) is its own page with paper tabs: Notebook, Focus timer, Privacy, Data (backups, export/import), Add-ons. Back or Esc returns to where you were.

**Paper** (Settings → Notebook): White with blue ink, or Cream paper on a linen desk. The choice is kept by this browser (not in your notebook data), so the lock screen uses it too.

**Habit marks** (Settings → Notebook): a done habit day shows as an ink dot, a hatched circle, or a ticked circle; days not done are empty circles. Kept by this browser, like Paper.

**Focus Map** (optional, Settings → Add-ons) is a board of sticky notes on an impact × difficulty map (left hard, right easy; top high impact, bottom low).
- **Write and place:** write on the blank note at the top of the pad and press Enter; it drops into the Tray. Drag a note by its top edge onto the map. You can also focus a note and use the arrow keys, or use Place in its bar.
- **States:** each note has a state (Idea, In progress, Completed) and an optional planned date. Click a note to show its bar: Start, Complete, Reopen, the date, Plan, Place, remove. A note in progress is pale blue, a completed one grey with a ✓; its date and week are written at the foot. Esc or a click on the empty map puts the bar away.
- **Planning:** Plan puts the idea once into the week of its date, or the week shown in the top bar, ready for the matrix. It stays one piece of work: rename it, tick it done, or change its date from Week, Day, or the note, and every place agrees. Changing the date moves it to that week.
- **Day page:** ideas planned for a day show up in that day's "Pick from your plan".
- **Turning it off:** hides the board and its marks; your notes and links are kept.
