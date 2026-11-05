# Releasing the Windows app

Releases are GitHub releases of this repository. The desktop app's updater reads
`https://github.com/Thander-cute/duckbook/releases/latest/download/latest.yml`, so the newest
**non-pre-release** release is what every installed app is offered. Publish betas as normal
releases with "beta" in the title; GitHub's "latest" skips releases marked as pre-releases.

## 1. Prepare

1. Write `docs/releases/<version>.md`. Its `## What's new` section becomes the release notes shown in the app before updating.
2. Set `version` in `package.json` (and `npm install --package-lock-only`). Versions only go up: the app never offers a lower version.
3. Put the app's Google OAuth client at the repo root as `google-client.json` (ignored by git; see `docs/GOOGLE-DRIVE-SYNC-SETUP.md`). Without it the build has no Google Drive sync.
4. Commit, then tag: `git tag v<version>`.

## 2. Build

```bash
npm ci
npm run desktop:build
```

This runs the typecheck and web build, writes `desktop-dist/THIRD_PARTY_NOTICES.txt`, and produces in `release/`:

- `Duckbook-Setup-<version>.exe`, the installer
- `Duckbook-Setup-<version>.exe.blockmap`
- `latest.yml`, with the version, size, SHA-512 and release notes

Check that the log says `Google Drive sync: built in from google-client.json` and that `latest.yml` names the same installer file.

## 3. Check

Install or run `release/win-unpacked/Duckbook.exe` with a synthetic data folder (`DUCKBOOK_DESKTOP_DATA_DIR`, `DUCKBOOK_WEB_DATA_DIR`, `DUCKBOOK_WEB_PORT`, `DUCKBOOK_DESKTOP_PORT`). To try the updater before publishing, serve a folder holding a `latest.yml` and installer of a higher version on `http://127.0.0.1:<port>/` and start the app with `DUCKBOOK_UPDATE_URL` pointing at it. Adding `DUCKBOOK_UPDATE_DRY_INSTALL=1` (only accepted with a loopback feed and `DUCKBOOK_DESKTOP_DATA_DIR`) runs Install and restart up to the quit, but writes `dry-install.json` in that data folder instead of running the installer. It checks saving, the clean stop and the quit, not the installer itself or the restart.

## 4. Publish

1. Push the commit and tag.
2. Create a GitHub release for the tag (title `Duckbook <version>`), paste the "What's new" section, and upload the three files from step 2 **exactly as named**.
3. Leave "Set as a pre-release" unticked, and publish. Publish last, after the files are uploaded: an installed app may check at any moment.
4. Check `https://github.com/Thander-cute/duckbook/releases/latest/download/latest.yml` shows the new version.

To withdraw a bad release, publish a fixed higher version. Deleting a release makes "latest" fall back to the one before it, but apps that already updated stay on the bad version.

## Limits

- Installers are not code-signed: SmartScreen warns on a manual install, and the updater checks SHA-512 only, against `latest.yml` from the same release.
- Versions 0.1.0-beta.1 and beta.2 have no updater. Their users install 0.1.0-beta.3 or later by hand once.
