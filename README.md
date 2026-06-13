# rag-utils

Local-first RAG (Retrieval-Augmented Generation) for your codebase.

`rag-utils` indexes your repository down to the **function level**, stores
embeddings in a local SQLite database, and serves them from
`localhost:3301`. A companion Chrome extension intercepts what you type into
AI chat tabs (e.g. Claude.ai) and silently attaches the most relevant
functions from your actual codebase before sending the message.

Everything runs on your machine. No code is uploaded anywhere.

## Status

This repo is being built incrementally, file by file. Current state:

| File | Status |
| --- | --- |
| `src/crawler/ignorer.ts` | done |
| `src/crawler/fileCrawler.ts` | done |
| `src/crawler/functionParser.ts` | skeleton (tree-sitter wired, AST walk TODO) |
| `src/crawler/fileWatcher.ts` | skeleton (diffing logic in place, needs testing) |
| `src/rag/vectorStore.ts` | skeleton (SQLite schema + cosine search) |
| `src/rag/embedder.ts` | skeleton (transformers.js wired) |
| `src/rag/retriever.ts` | skeleton |
| `src/server/server.ts`, `routes.ts` | skeleton |
| `bin/rag.ts` | skeleton (`init` / `serve` / `query` / `watch`) |
| `src/extension/*` | not started |
| `src/utils/*` | done |

## Architecture

```
rag-utils/
├── package.json
├── tsconfig.json
├── bin/
│   └── rag.ts                    CLI entry: rag init / serve / query / watch
│
├── src/
│   ├── types.ts                  Shared types (FunctionRecord, SearchResult, ...)
│   │
│   ├── crawler/
│   │   ├── ignorer.ts            .gitignore + .ragignore parser
│   │   ├── fileCrawler.ts        recursive repo walker
│   │   ├── functionParser.ts     tree-sitter AST -> function records
│   │   └── fileWatcher.ts        chokidar watcher, function-level diffing
│   │
│   ├── rag/
│   │   ├── embedder.ts           local all-MiniLM-L6 embeddings
│   │   ├── vectorStore.ts        SQLite persistence + cosine search
│   │   └── retriever.ts          query -> top-K ranked functions
│   │
│   ├── server/
│   │   ├── server.ts             Express app on localhost:3301
│   │   └── routes.ts             /query  /status  /health
│   │
│   ├── extension/
│   │   ├── manifest.json         Chrome extension (MV3)
│   │   ├── content.js            injected into chat tabs
│   │   ├── popup.html
│   │   └── popup.js
│   │
│   └── utils/
│       ├── hash.ts               SHA256 for change detection
│       ├── logger.ts             coloured terminal output
│       └── similarity.ts         cosine similarity math
│
├── .ragignore                    user-editable, extra ignore patterns
└── .rag-utils/
    └── vectors.db                auto-generated SQLite DB (gitignored)
```

## How it works

### Flow 1 — `rag init` (first-time indexing)

```
ignorer        -> loads .gitignore + .ragignore
fileCrawler    -> walks the repo, skipping ignored paths
functionParser -> tree-sitter AST per file -> FunctionRecord[]
embedder       -> FunctionRecord.code -> 384-dim vector
vectorStore    -> upserts everything into .rag-utils/vectors.db
```

### Flow 2 — `rag serve` (stay live while you code)

```
rag serve -> starts the Express server AND fileWatcher
you save auth.js
  -> fileWatcher fires
  -> functionParser re-parses only auth.js
  -> hash.ts diffs which functions actually changed
  -> embedder re-embeds only those functions
  -> vectorStore upserts the changes
  -> done in under a second
```

### Flow 3 — using it from a chat tab

```
You type "why is login failing" into Claude.ai
  -> content.js intercepts the submit
  -> POST http://localhost:3301/query  { query: "why is login failing" }
  -> retriever finds loginUser, authMiddleware, incrementFailedAttempts
  -> formatted with file paths + line numbers
  -> prepended to your message before it's sent
  -> Claude sees your actual code
```

## Prerequisites

- Node.js >= 18
- npm (or pnpm/yarn if you prefer — examples below use npm)
- Git
- Google Chrome (for the extension, once it's built)

## Getting started

### 1. Create the GitHub repo

Pick one of these:

**Using the GitHub web UI**
1. Go to <https://github.com/new>
2. Repository name: `rag-utils`
3. Leave "Initialize with README" **unchecked** (we already have one)
4. Create the repo, then copy the URL it gives you, e.g.
   `https://github.com/<your-username>/rag-utils.git`

**Using the GitHub CLI** (if you have `gh` installed)
```bash
gh repo create rag-utils --private --source=. --remote=origin
```

### 2. Set up the project locally

```bash
mkdir rag-utils
cd rag-utils
git init
git branch -M main
git remote add origin https://github.com/<your-username>/rag-utils.git
```

### 3. Add the base files

Unzip/copy the project files generated for you into this folder, so it
matches the structure above (`package.json`, `tsconfig.json`, `bin/`,
`src/`, `.gitignore`, `.ragignore`, `LICENSE`, `README.md`).

### 4. Install dependencies

```bash
npm install
```

> Note: `better-sqlite3` and `tree-sitter` / `tree-sitter-typescript` compile
> native bindings on install. If you hit build errors, make sure you have
> Python 3 and a C++ toolchain available (on macOS: Xcode Command Line
> Tools; on Linux: `build-essential`).

### 5. Commit and push the base files

```bash
git add .
git commit -m "Initial scaffold: TS config, types, utils, skeleton modules"
git push -u origin main
```

### 6. Verify the build

```bash
npm run build   # compiles src/ + bin/ to dist/
npm run dev     # runs bin/rag.ts directly via tsx, for fast iteration
```

## CLI commands (target shape)

```bash
rag init             # one-time: crawl, parse, embed, persist
rag serve            # start localhost:3301 + live file watcher
rag serve --port 4000
rag query "why is login failing"
rag watch            # watcher only, no server (debugging)
```

## Suggested build order

This mirrors the dependency graph — lower-level modules first, CLI wiring
last:

1. `src/utils/*` — done
2. `src/crawler/ignorer.ts` — done
3. `src/crawler/fileCrawler.ts` — done
4. `src/crawler/functionParser.ts` — **next**: implement the tree-sitter
   AST walk and name-resolution heuristics
5. `src/rag/vectorStore.ts` — finalize schema once real FunctionRecords
   are flowing through
6. `src/rag/embedder.ts` — verify model download + batch embedding works
7. `src/crawler/fileWatcher.ts` — wire up against a real project
8. `src/rag/retriever.ts`, `src/server/*` — connect query -> results
9. `bin/rag.ts` — end-to-end CLI smoke test
10. `src/extension/*` — Chrome extension last

## Configuration

| File | Purpose |
| --- | --- |
| `.gitignore` | standard — also keeps `.rag-utils/` and `dist/` out of git |
| `.ragignore` | extra exclusions *on top of* `.gitignore` for the indexer (e.g. fixtures, generated code, docs) |

## Daily workflow once the scaffold is pushed

```bash
git pull
# ... ask Claude to implement the next file from "Suggested build order" ...
git add .
git commit -m "Implement functionParser AST walk"
git push
```

## License

MIT — see [LICENSE](LICENSE).
