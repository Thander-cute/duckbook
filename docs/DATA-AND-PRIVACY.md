# Your data and privacy

Duckbook keeps your notebook on your computer. Nothing you write is sent to the Duckbook project or to anyone else. There is no account, no telemetry, no analytics and no AI; fonts are built in. Only two things use the network, both described below: **Google Drive sync** (only if you turn it on) and the Windows app's **update checks** with GitHub.

## Where your data is

| What | Windows app | Browser version |
|---|---|---|
| Pages (SQLite) | `%APPDATA%\duckbook\notebook\duckbook.sqlite` | `%LOCALAPPDATA%\Duckbook\duckbook.sqlite` |
| Backups | `…\backups\*.sqlite` beside it | same |
| Day photos | `…\photos\*.jpg` beside it: downsized JPEGs named by content hash; pages store only the name | same |
| Event log | `…\logs\server.log`: start-up, backups, imports; never notebook text | same |
| Google sign-in | `…\sync-google.json`, only while sync is connected | same |

Settings → Data shows the exact folder. The two versions keep separate notebooks. Uninstalling the Windows app does not delete its data folder.

The browser version's local server listens only on `127.0.0.1` and `::1`, and refuses requests whose Host or Origin isn't its own or that lack its own header. The Windows app adds a fresh token per launch and lets its window open nothing but Google sign-in and Duckbook's privacy pages, in your browser.

The very first duckbook kept pages in the browser's `localStorage['duckbook:v1']` at `http://localhost:5317`. Duckbook only reads that copy, offers to move it, and removes it only when you press *Remove old copy* after a verified move.

## Saving

- Each page (month, week, day, settings) is a row in SQLite with a revision number that only goes up.
- A save from a tab that missed someone else's change is merged into the newer page; if that isn't possible, the page shows a conflict instead of overwriting.
- SQLite runs in WAL mode with `synchronous=FULL`: a confirmed save survives a power cut or a killed process. A failed save shows *Not saved* and is retried.

## Backups

- Automatic about every 4 hours while pages change, at start-up, and always before an import or restore.
- Each backup is checked right after it is made (SQLite `integrity_check` and a content hash); one that fails is discarded.
- 30 automatic and 20 manual or pre-operation backups are kept. Restore is in Settings → Data; the current pages are backed up first and the result is verified.
- Photos are not inside the `.sqlite` backups. Each photo file is kept while the current pages *or* any backup refers to it, so every restore has its photos.
- **Limit:** backups are on the same disk. Copy the whole data folder (including `backups` and `photos`) elsewhere now and then.

## The PIN lock

An optional 6-digit PIN (Settings → Privacy). It locks after a chosen idle time, from the lock icon, or with `L`.

**It does:** remove the pages from the window while locked (not just blur them) and drop photos from memory; refuse every read, write, backup and export until unlocked; slow down guessing (after 5 wrong tries, waits growing to 15 minutes); lock again when the server restarts.

**It does not:** encrypt anything. Anyone or any program that can open files in your Windows account can read the notebook, backups, photos, exports and `sync-google.json`. It doesn't protect an unlocked window or someone with full control of the computer. To protect a lost or stolen computer, turn on Windows device encryption (BitLocker).

## Export and import

- **Export JSON** writes readable, unencrypted text. Keep it somewhere private. It contains photo names, not photo files; copy the `photos` folder to move photos.
- **Import** checks the file first and refuses anything that isn't duckbook data. Unknown values are set aside, not dropped. The current pages are always backed up before being replaced.

## Google Drive sync (not encrypted)

- Off until you connect a Google account in Settings → Data. Each computer talks to Google Drive directly; there is no Duckbook server.
- Duckbook asks only for `drive.file`: it can see and change only files it created, not the rest of your Drive. It doesn't ask for your name or email.
- Your pages (journal, tasks, reflections…) and day photos are stored as readable files in a **Duckbook Sync** folder in your Drive. **They are not encrypted:** Google and anyone with access to that Google account can read them.
- Each computer only adds its own files (`ops-<device>-<n>.json`, `photo-<hash>.jpg`) and never changes another's. The live SQLite file is never uploaded.
- The Google tokens are kept in `sync-google.json`, in plain text, outside `duckbook.sqlite` and its backups.
- Saving never waits for the network. Sync runs a few seconds after a save, when you return to the window, and every minute. Problems (offline, access ended, damaged file) show in Settings → Data; damaged files are not applied.
- **Use Drive's notebook** replaces this computer's pages after a verified backup. **Merge both** keeps both sides; where the same box differs, both texts are kept.
- **Stop syncing** leaves your pages here and in Drive. **Sign out** asks Google to revoke access and deletes `sync-google.json` (if you're offline, remove Duckbook at <https://myaccount.google.com/permissions>). Nothing in Drive is deleted; delete the Duckbook Sync folder yourself if you want it gone.

## Updates (Windows app)

- Duckbook asks GitHub for the latest release of this repository (`latest.yml`) when it opens and when you press *Check now* in Settings → Data → App updates. Like any download, GitHub sees your IP address and the request. Nothing about your notebook is sent.
- Nothing downloads or installs on its own. *Download* fetches the installer and checks its size and SHA-512 against `latest.yml`. *Install and restart* saves every page and stops the notebook first, and won't install if anything is unsaved.
- The installer is not code-signed: the SHA-512 shows the file matches the release's `latest.yml`, not who published it.
- Your data folder is outside the install folder, so updates don't touch it.

Questions: see [SECURITY.md](../SECURITY.md) for contact.
