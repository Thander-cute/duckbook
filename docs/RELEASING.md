# Releasing the Windows app

The updater reads `https://github.com/Thander-cute/duckbook/releases/latest/download/latest.yml`, so every installed app is offered the newest **non-pre-release** GitHub release. Publish every version as a normal release.

## Steps

1. Add a `## <version> (<date>)` section to `CHANGELOG.md`. The build turns it into the notes shown in the app before updating. If an add-on changed, add a line at the top of its history in `src/lib/addons.ts`.
2. Set `version` in `package.json` and run `npm install --package-lock-only`. Versions only go up: the app never offers a lower one.
3. Put the Google OAuth client at the repo root as `google-client.json` (see below). Without it the build has no Google Drive sync.
4. Commit, then `git tag v<version>`.
5. Run `npm ci` and `npm run desktop:build`. Check the log says `Google Drive sync: built in from google-client.json`, and that `release/latest.yml` names the same installer.
6. Run `release/win-unpacked/Duckbook.exe` with a synthetic data folder (`DUCKBOOK_DESKTOP_DATA_DIR`, `DUCKBOOK_WEB_DATA_DIR`, `DUCKBOOK_WEB_PORT`, `DUCKBOOK_DESKTOP_PORT`).
7. Push the commit and tag. Create a GitHub release for the tag (title `Duckbook <version>`) with the changelog section, plus how to update if that needs saying.
8. Upload these from `release/` **exactly as named**: `Duckbook-Setup-<version>.exe`, its `.blockmap`, and `latest.yml`.
9. Leave "Set as a pre-release" unticked and publish last, after the files are uploaded: an installed app may check at any moment.
10. Check the `latest.yml` URL above shows the new version.

To try the updater before publishing, serve a higher version's `latest.yml` and installer on `http://127.0.0.1:<port>/` and start the app with `DUCKBOOK_UPDATE_URL` pointing there. Adding `DUCKBOOK_UPDATE_DRY_INSTALL=1` (needs that loopback feed and `DUCKBOOK_DESKTOP_DATA_DIR`) runs Install and restart up to the quit and writes `dry-install.json` instead of running the installer. It doesn't check the installer or the restart.

To withdraw a bad release, publish a fixed higher version. Deleting a release makes "latest" fall back to the one before it, but apps that already updated stay on the bad version.

Installers are not code-signed, so SmartScreen warns on a manual install. Versions 0.1.0-beta.1 and beta.2 have no updater: their users install a newer version by hand once.

## Google OAuth client

Releases have the client built in; anyone building from source needs their own for sync to work.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Drive API**.
2. Under **Google Auth Platform → Clients**, create a **Desktop app** client. Save its JSON as `google-client.json` at the repo root (ignored by git). The browser version reads it when its server starts; `npm run desktop:build` builds it in. A copy in a data folder overrides the built-in client for that notebook.
3. Under **Data access**, add the `drive.file` scope. It needs no scope review.
4. Under **Audience**, *Testing* allows only listed test users and sign-in expires after 7 days. *Publish app* removes both limits.
5. Under **Branding**, an app name and support email are required. Publishing for other people also needs a homepage, privacy policy and terms on a domain verified in [Search Console](https://search.google.com/search-console).

Keep one client for good: `drive.file` ties Drive files to the client that created them, so a new client won't see an existing Duckbook Sync folder.

## Website

The homepage, privacy policy and terms are static pages in `site/public`. `npm run site:build` writes them to `site/dist/public`, plus `site/dist/worker.js`, a single Cloudflare Worker module with every file embedded. `npm run test:site` checks them in Chrome.
