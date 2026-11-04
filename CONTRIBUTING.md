# Contributing

Duckbook is a small personal planner. Issues and pull requests are welcome; it is maintained by one person, so replies can be slow.

- Read [AGENTS.md](AGENTS.md) (the working agreement) and [docs/DECISIONS.md](docs/DECISIONS.md). Only **Decided** items are approved; open an issue before building something larger or listed under **Open**.
- Keep the notebook's look and behaviour unless the change is agreed first.
- Never include real journal data in issues, tests or screenshots. Use synthetic text and a temporary data folder (`DUCKBOOK_DATA_DIR`) on a spare port (`DUCKBOOK_PORT`), never `5317`.
- Changes to saving, import, sync or migration must stay non-destructive: back up before replacing, verify after writing, show failures.
- Before a pull request: `npm run typecheck`, `npm test`, `npm run build`, and the browser check for UI changes (`npm run test:browser`).
- Small commits with imperative messages ("Add focus map grid").

By contributing you agree that your work is licensed under the [MIT License](LICENSE).
