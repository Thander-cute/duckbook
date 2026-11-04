# Desktop 0.1.0-beta.3 release record

Published 2026-11-05 at <https://github.com/Thander-cute/duckbook/releases/tag/v0.1.0-beta.3>.
The repository is public under MIT. Source tag: `v0.1.0-beta.3`, commit `445cf29`
(a comment-only clarification after build commit `ea5069e`; bundled code unchanged).

## Artifacts and distribution

- Installer: `Duckbook-Setup-0.1.0-beta.3.exe`, 113,932,120 bytes.
- SHA-256: `8099b3b22133afee635f430ca74bab3cdcf7b67a09ed439771054f92075caa65`.
- Installer, blockmap and `latest.yml` uploaded before publishing the draft release.
- Local installer size and SHA-512 match `latest.yml`; uploaded asset digests match local files.
- Anonymous requests to the live update feed and installer return 200. GitHub identifies the repository licence as MIT.
- The package includes Duckbook's MIT licence, third-party notices including the font OFLs, and Electron/Chromium notices.
- Gitleaks 8.30.1 scanned 89 commits across local refs with no detections. The subsequent comment-only commit was reviewed separately. No issues, Actions runs or existing wiki were found during the repository exposure review.

## Focused acceptance

The implementing agent completed the desktop build (including typecheck). On a
synthetic packaged profile with a loopback feed, Terra confirmed that a newer
version is detected without automatically requesting the installer. A manual
download with a deliberately wrong SHA-512 was rejected; the app stayed running
and did not reach `ready` or `installing`. The completed negative check isolated
both the profile and `LOCALAPPDATA`; its processes, feed and cache were cleaned up.

Source review confirmed main-frame sender checks, disabled installation on quit,
input frozen before flushing, refusal when saving fails, and a required clean
notebook-server exit. These lifecycle paths and the actual Windows installation
and restart were not exercised. No real journal data or running owner app was used.

## Limits

The installer is unsigned; SHA-512 checks integrity against the release metadata,
not an independent publisher signature. Installer launch is asynchronous, so a
post-quit launch failure leaves the old version installed and requires reopening
it. Beta.1 and beta.2 need one manual installation to gain the updater.
