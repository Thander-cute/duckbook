# duckbook

A minimalist desktop-web planner after *The Present Day Planner* (The Present Writer), for personal single-user use.
See [IDEA.md](IDEA.md) for the product idea and design language, and [docs/DECISIONS.md](docs/DECISIONS.md) for what is decided versus still open.

## Run

```bash
npm install
npm run dev -- --port 5317 --strictPort   # open http://localhost:5317
```

> **Your pages live in this browser, at this address.** Data is stored in localStorage for the origin `http://localhost:5317`.
> A different port, `127.0.0.1`, another browser, or clearing site data will show (or leave) an empty notebook.
> Use **Settings ⚙ → Export JSON** now and then to keep a copy.

## Develop

```bash
npm run typecheck
npm run build
```

Working agreement for humans and agents: [AGENTS.md](AGENTS.md). Plan larger changes with [docs/templates/slice-plan.md](docs/templates/slice-plan.md).

Keys: `← →` previous/next · `T` today · `M W D R` Month/Week/Day/Reflect.
