# rag-utils: Local Code Context for AI Chatbots

> **Never paste your code into the cloud.** rag-utils indexes your local codebase, runs a server on your machine, and shows relevant code snippets inside AI chatbots (Claude, ChatGPT, Kimi, DeepSeek, etc.) via a Chrome extension. Click to copy, auto-paste into chat.

---

## Table of Contents

- [What is this?](#what-is-this)
- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Indexing your codebase](#indexing-your-codebase)
- [Installing the Chrome extension](#installing-the-chrome-extension)
- [Using it in chatbots](#using-it-in-chatbots)
- [Supported chatbots](#supported-chatbots)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)

---

## What is this?

**rag-utils** is a local-first RAG (Retrieval-Augmented Generation) tool for developers. It:

1. **Indexes your codebase** down to the function level using tree-sitter AST parsing
2. **Stores embeddings locally** in SQLite (no cloud, no API keys)
3. **Serves them from localhost:3301** via an Express server
4. **Shows relevant code** inside AI chatbots through a Chrome extension side panel

When you type a function name, error message, or file path in a chatbot, the extension queries your local index and displays matching code. You click **Copy** and it auto-pastes into your chat input.

---

## How it works

```
You type "processUser is throwing TypeError" in Claude.ai
        |
        v
  content.js detects the input
        |
        v
  POST localhost:3301/query { query: "processUser" }
        |
        v
  Server searches SQLite embeddings (cosine similarity)
        |
        v
  Returns: processUser() from test.js (score: 55%)
        |
        v
  Side panel shows the function with VS Code-style highlighting
        |
        v
  You click "Copy" -> code auto-pastes into Claude's input box
```

---

## Prerequisites

| Requirement         | Version                 | Notes                                |
| ------------------- | ----------------------- | ------------------------------------ |
| Node.js             | >= 18                   | Required for the server and indexing |
| npm                 | >= 9                    | Comes with Node.js                   |
| Git                 | any                     | For cloning the repo                 |
| Chrome / Arc / Edge | latest                  | For the extension                    |
| OS                  | macOS / Linux / Windows | Tested on macOS                      |

---

## Installation

### Step 1: Clone the repository

```bash
git clone https://github.com/nuriSherpa/rag-utils.git
cd rag-utils
```

### Step 2: Install dependencies

```bash
npm install
```

This installs:

- `express` — local server
- `better-sqlite3` — local vector database
- `@xenova/transformers` — on-device embedding model (no API key)
- `tree-sitter` + grammars — AST parsing for JS/TS
- `chokidar` — file watching for live updates
- `tsx` — TypeScript execution

> **Note:** The first run will download the embedding model (~90MB). This is cached locally and never uploaded.

---

## Indexing your codebase

### First-time setup

```bash
npm run rag -- start
```

You will be prompted:

```
Enter the path to your codebase: /Users/you/Project/my-app

  Project : /Users/you/Project/my-app
  Port    : 3301
  Logs    : /Users/you/Project/my-app/.rag-utils/server.log

Index and start server? [Y/n] y
```

Type your project path, press `y`, and the server will:

1. Parse all `.js`, `.ts`, `.jsx`, `.tsx` files
2. Extract every function using tree-sitter AST
3. Generate embeddings using the local model
4. Store everything in `.rag-utils/vectors.db`

### Live watching (auto-update as you code)

The server stays running and watches for file changes. When you save a file, it re-indexes only the changed functions in under a second.

### Check server status

```bash
curl http://localhost:3301/status
```

Expected response:

```json
{
  "indexedFunctions": 42,
  "indexedFiles": 8,
  "watching": true,
  "dbPath": "/Users/you/Project/my-app/.rag-utils/vectors.db"
}
```

### Stop the server

```bash
npm run rag -- stop /Users/you/Project/my-app
```

Or kill the process:

```bash
kill $(lsof -t -i:3301)
```

---

## Installing the Chrome extension

### Step 1: Open Chrome extensions page

- Chrome: `chrome://extensions/`
- Arc: `arc://extensions/`
- Edge: `edge://extensions/`

### Step 2: Enable Developer Mode

Toggle **Developer mode** ON (top-right corner).

### Step 3: Load the extension

Click **"Load unpacked"** and select the `src/extension/` folder inside your rag-utils repo.

```
rag-utils/
└── src/
    └── extension/     <-- Select THIS folder
        ├── manifest.json
        ├── content.js
        ├── popup.html
        └── popup.js
```

### Step 4: Verify it's loaded

You should see **"rag-utils: Local Code Context"** in your extensions list with a blue toggle.

### Step 5: Check the popup

Click the extension icon in your toolbar. It should show:

- Green dot = server online
- Indexed function/file counts

---

## Using it in chatbots

### 1. Open a supported chatbot

Go to any supported site (Claude, ChatGPT, Kimi, DeepSeek, etc.).

### 2. Start typing

Type a function name, error, or file path:

| What you type                                    | What the panel shows                                        |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `processUser`                                    | The `processUser()` function from your codebase             |
| `TypeError: Cannot read properties of undefined` | Functions that access properties (like `user.profile.name`) |
| `src/utils/helpers.js`                           | All functions from that file                                |
| `calculateAverage`                               | The `calculateAverage()` function                           |

### 3. The side panel appears

A dark panel slides in from the right side of the screen:

```
RAG Context  [5]  ☰
query: "processUser"

[Copy all (5)]

test.js
[Copy file]
  processUser    55%    [Copy]
  ┌─────────────────────────────┐
  │ javascript                  │
  │ 1  function processUser(user){
  │ 2    const name = user.profile│
  │ ...                          │
  └─────────────────────────────┘
```

### 4. Click to copy

- **Copy** — copies a single function and auto-pastes into chat
- **Copy file** — fetches the ENTIRE file from disk and pastes it
- **Copy all** — copies all matching functions

The code instantly appears in your chat input box. Press Enter to send.

---

## Supported chatbots

| Chatbot                 | Domain                                 | Status             |
| ----------------------- | -------------------------------------- | ------------------ |
| **Claude**              | claude.ai                              | ✅ Fully supported |
| **ChatGPT**             | chatgpt.com, chat.openai.com           | ✅ Fully supported |
| **Kimi**                | kimi.com, kimi.moonshot.cn             | ✅ Supported       |
| **DeepSeek**            | chat.deepseek.com                      | ✅ Supported       |
| **Gemini**              | gemini.google.com, aistudio.google.com | ✅ Supported       |
| **GitHub Copilot Chat** | github.com/copilot                     | ✅ Supported       |
| **Perplexity**          | perplexity.ai                          | ✅ Supported       |
| **Phind**               | phind.com                              | ✅ Supported       |
| **Poe**                 | poe.com                                | ✅ Supported       |
| **Mistral**             | chat.mistral.ai                        | ✅ Supported       |
| **You.com**             | you.com                                | ✅ Supported       |
| **HuggingChat**         | huggingface.co/chat                    | ✅ Supported       |

> **Adding a new chatbot:** If your chatbot isn't listed, inspect the input element and add its domain + selector to `SITES` in `content.js`.

---

## Troubleshooting

### "Server not running" in popup

**Cause:** The RAG server isn't started.

**Fix:**

```bash
cd /path/to/rag-utils
npm run rag -- start
# Enter your project path, confirm with Y
```

### "Cannot GET /file" when clicking Copy File

**Cause:** The `/file` endpoint isn't in the running server.

**Fix:**

```bash
# Stop old server
kill $(lsof -t -i:3301)

# Restart with latest code
npm run rag -- start
```

### Panel doesn't appear on a chatbot

**Cause:** Content script not injected or editor not detected.

**Fix:**

1. Check `arc://extensions/` (or `chrome://extensions/`) — is the extension enabled?
2. Hard-refresh the chatbot tab (Cmd+Shift+R)
3. Open Console (right-click → Inspect → Console) — look for `[rag-utils] Detected ...`
4. If no log appears, check if the domain is in `manifest.json` matches array

### Low similarity scores (e.g., 22%)

**Cause:** The embedding model is general-purpose text, not code-optimized.

**Fix:** The `bge-small-en-v1.5` model is already the best free option. For better results:

- Use exact function names in your query
- Include file paths
- Paste full error messages with stack traces

### Syntax highlighting looks broken

**Cause:** Old content.js cached in browser.

**Fix:**

1. Replace `content.js` with latest version
2. Click reload icon in `chrome://extensions/`
3. Hard-refresh chatbot tab

---

## Architecture

```
rag-utils/
├── bin/
│   └── rag.ts              CLI: init, serve, query, watch, stop
│
├── src/
│   ├── crawler/
│   │   ├── ignorer.ts      .gitignore + .ragignore parser
│   │   ├── fileCrawler.ts  recursive repo walker
│   │   ├── functionParser.ts  tree-sitter AST -> FunctionRecord[]
│   │   └── fileWatcher.ts  chokidar watcher, incremental re-indexing
│   │
│   ├── rag/
│   │   ├── embedder.ts     Xenova/transformers.js embeddings (local, no API)
│   │   ├── vectorStore.ts  SQLite + cosine similarity search
│   │   └── retriever.ts    query -> top-K ranked functions
│   │
│   ├── server/
│   │   ├── server.ts       Express app
│   │   └── routes.ts       /query, /status, /health, /file
│   │
│   ├── extension/
│   │   ├── manifest.json   Chrome MV3 manifest
│   │   ├── content.js      injected into chat tabs (side panel, auto-paste)
│   │   ├── popup.html      extension popup UI
│   │   └── popup.js        server status checker
│   │
│   └── utils/
│       ├── hash.ts         SHA256 for change detection
│       ├── logger.ts       coloured terminal output
│       └── similarity.ts   cosine similarity math
│
└── .rag-utils/
    └── vectors.db          auto-generated SQLite (gitignored)
```

---

## License

MIT — see [LICENSE](LICENSE).

---

## Contributing

This project is being built incrementally. Current status:

| Component                     | Status  |
| ----------------------------- | ------- |
| File crawler + ignorer        | ✅ Done |
| Function parser (tree-sitter) | ✅ Done |
| Vector store (SQLite)         | ✅ Done |
| Embedder (local model)        | ✅ Done |
| Retriever                     | ✅ Done |
| Express server + routes       | ✅ Done |
| Chrome extension (content.js) | ✅ Done |
| File watcher (live updates)   | ✅ Done |
| Multi-chatbot support         | ✅ Done |
| VS Code-style UI              | ✅ Done |
| Auto-paste into chat          | ✅ Done |

---

**Made with ❤️ for developers who care about privacy.**
