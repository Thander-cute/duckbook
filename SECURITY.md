# Security

Please report security problems privately, not in a public issue: use GitHub's **Report a vulnerability** (Security tab of this repository) or email ndkhoa1000@gmail.com.

Useful to know when judging a report:

- Duckbook runs only on your computer. Its local server listens on `127.0.0.1` and checks Host, Origin and a per-app header; the desktop app adds a per-launch token.
- The PIN is an access lock, not encryption. Notebook files, backups and the Google sign-in token (`sync-google.json`) are not encrypted on disk.
- Google Drive sync is not encrypted: anyone with access to that Google account can read the synced files.
- The Windows installer is not code-signed. Updates are checked against the SHA-512 in the release's `latest.yml`, served from the same GitHub release.
- The Google OAuth client built into release installers is an installed-app client; Google treats its secret as public, and sign-in uses PKCE.

Supported versions: the latest release only.
