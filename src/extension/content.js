/**
 * content.js
 *
 * Injected into chat tabs (see manifest.json `matches`).
 *
 * Flow 3 (high level):
 *  1. Detect when the user submits a message (Enter key / send button click).
 *  2. Read the message text.
 *  3. POST { query: text } to http://localhost:3301/query
 *  4. If results come back, format them (file path + line numbers + code)
 *     and prepend/inject them into the message before it's actually sent.
 *  5. If the local server isn't running (fetch fails), fail silently and
 *     let the message send unmodified - this extension should never block
 *     normal usage.
 *
 * TODO: implement the actual DOM hooks for claude.ai's input box and
 * send button. These are intentionally left unimplemented until the
 * server side (Flows 1 & 2) is working end-to-end.
 */

const RAG_SERVER_URL = "http://localhost:3301/query";

async function fetchContext(query) {
  try {
    const res = await fetch(RAG_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Local server not running - degrade gracefully.
    return null;
  }
}

function formatContext(results) {
  return results
    .map(
      ({ record }) =>
        `// ${record.filePath}:${record.startLine}-${record.endLine} (${record.name})\n${record.code}`,
    )
    .join("\n\n");
}

// TODO: wire this up to the real submit event for the chat UI.
console.log("[rag-utils] content script loaded (not yet wired to UI)");

void fetchContext;
void formatContext;
