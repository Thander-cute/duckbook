# Beta verification: 0.1.0-beta.1

Checked on the release checkout based on `baea8ee`, with package version
`0.1.0-beta.1`. Synthetic temporary notebooks only; no personal notebook was read.

- `npm ci --no-audit --no-fund`: passed.
- `npm run desktop:build`: passed (includes typecheck and production web build).
- `npm test`: 19/19 passed, including crash durability, PIN, restore and browser-to-desktop transfer.
- `npm run test:browser`: 28/28 passed.
- `npm run test:upgrade`: 3/3 passed.
- `npm run desktop:test`: incomplete. The packaged app passed renderer/token/single-instance isolation,
  acknowledged-save survival after hard kill, and flush-on-close persistence.
  The final unsaved-close dialog scenario timed out waiting for a save error while a first-visit tour was visible.
  Follow-up attempts also encountered onboarding/window-automation stalls and were stopped.
  Experimental test-only adjustments were reverted; no product change was made to hide a failure.
  The full desktop suite is not claimed as passing for this release.
- The installer was built, not installed. Clean-machine install, timer sound,
  Electron full-screen interaction and Vietnamese IME remain unverified.
- Windows ZIP integrity check passed; SHA-256 checksums generated for both binary downloads.
- Packaged ASAR top-level contents: `desktop-dist`, `dist`, `package.json`.
- Tracked history reviewed for data/build directory paths and common credential
  patterns; no matches found. This is a bounded check, not an exhaustive secrets audit.

See the beta release notes for legacy recovery limitations identified by code review.
