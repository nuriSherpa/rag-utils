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

| File                                | Status                                           |
| ----------------------------------- | ------------------------------------------------ |
| `src/crawler/ignorer.ts`            | done                                             |
| `src/crawler/fileCrawler.ts`        | done                                             |
| `src/crawler/functionParser.ts`     | skeleton (tree-sitter wired, AST walk TODO)      |
| `src/crawler/fileWatcher.ts`        | skeleton (diffing logic in place, needs testing) |
| `src/rag/vectorStore.ts`            | skeleton (SQLite schema + cosine search)         |
| `src/rag/embedder.ts`               | skeleton (transformers.js wired)                 |
| `src/rag/retriever.ts`              | skeleton                                         |
| `src/server/server.ts`, `routes.ts` | skeleton                                         |
| `bin/rag.ts`                        | skeleton (`init` / `serve` / `query` / `watch`)  |
| `src/extension/*`                   | not started                                      |
| `src/utils/*`                       | done                                             |

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

## License

MIT — see [LICENSE](LICENSE).
