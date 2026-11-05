# Google Drive sync: setting up your own OAuth client

People who install a Duckbook release just press **Settings → Data → Connect**. The release has its OAuth client built in. This page is for people who **build Duckbook from source** and want sync to work in their build.

## How sign-in works

- An OAuth client of type **Desktop app** (installed app). There is no web redirect URI: Duckbook opens a one-off listener on `http://127.0.0.1:<random port>` and uses PKCE (S256) and `state` ([Google: OAuth for native apps](https://developers.google.com/identity/protocols/oauth2/native-app)).
- One scope only: `https://www.googleapis.com/auth/drive.file`, a non-sensitive scope that reaches only the files Duckbook created ([Google: Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)). No email or profile scopes.
- Tokens are kept in `sync-google.json` in the data folder, outside the notebook database and its backups. Sign out asks Google to revoke the token and deletes the file.
- Google treats an installed-app client's secret as public; PKCE protects the sign-in.

## Steps

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Google Drive API**.
2. **Google Auth Platform → Clients → Create client → Desktop app.** Download the JSON and save it as `google-client.json` at the repository root. Git ignores this file.
   - The browser version reads it when its server starts (restart with `Duckbook.cmd`).
   - `npm run desktop:build` builds it into the Windows app; the build log says `Google Drive sync: built in from google-client.json`.
   - A `google-client.json` in a data folder overrides the built-in client for that notebook, which is handy for testing.
3. **Data access:** add the `drive.file` scope.
4. **Audience:** while the project is in *Testing*, only listed test users can sign in, and sign-in expires after 7 days. *Publish app* (In production) removes both limits. `drive.file` needs no scope review.
5. **Branding:** an app name and support email are required. To publish for other people, Google also asks for a homepage, privacy policy and terms of service on a domain you have verified in [Search Console](https://search.google.com/search-console). If you want your app's name and logo on the consent screen, see [brand verification](https://support.google.com/cloud/answer/15549049).

Keep one client for good: `drive.file` ties the Drive files to the client that created them, so a new client won't see an existing Duckbook Sync folder.

## Duckbook's public pages

Duckbook's own homepage, privacy policy and terms are static pages in `site/public`. `npm run site:build` writes them to `site/dist/public`, and `site/dist/worker.js` is a single Cloudflare Worker module with every file embedded. `npm run test:site` checks them in Chrome. They have no sign-in and no connection to any notebook.
