# Contributing

Duckbook is a small personal planner. Issues and pull requests are welcome; it is maintained by one person, so replies can be slow.

- Read [AGENTS.md](AGENTS.md) (the working guidelines) and [docs/DATA-AND-PRIVACY.md](docs/DATA-AND-PRIVACY.md). Open an issue before building something larger, so we can agree on it first.
- Keep the notebook's look and behaviour unless the change is agreed first.
- Never include real journal data in issues, tests or screenshots. Use synthetic text and a temporary data folder (`DUCKBOOK_DATA_DIR`) on a spare port (`DUCKBOOK_PORT`), never `5317`.
- Changes to saving, import, sync or migration must stay non-destructive: back up before replacing, verify after writing, show failures.
- Before a pull request: `npm run typecheck`, `npm test`, `npm run build`, and the browser check for UI changes (`npm run test:browser`).
- CI runs the typecheck, `npm test` and the builds on every pull request.
- If a change alters a page's look, refresh the README screenshots with `npm run build && npm run screenshots` (made-up pages, throwaway server).
- Add a line to [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
- Small commits with imperative messages ("Add focus map grid").

Please follow the [code of conduct](CODE_OF_CONDUCT.md).

By contributing you agree that your work is licensed under the same terms as Duckbook ([PolyForm Noncommercial 1.0.0](LICENSE)).
