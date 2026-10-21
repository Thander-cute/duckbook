# duckbook

A minimalist desktop-web planner after *The Present Day Planner* (The Present Writer).
Idea & design rationale: see [IDEA.md](IDEA.md).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

Data lives in the browser's localStorage (`duckbook:v1`); export/import JSON from Settings (⚙).
Keys: `← →` previous/next · `T` today · `M W D R` Month/Week/Day/Reflect.
