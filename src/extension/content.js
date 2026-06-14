/**
 * content.js — rag-utils v0.5.0
 * Auto-discovers editors, works across all chatbots.
 */

if (window.__ragUtilsContentScriptActive) {
  console.warn('[rag-utils] Already active.');
} else {
  window.__ragUtilsContentScriptActive = true;
  runRagUtilsContentScript();
}

function runRagUtilsContentScript() {
  const RAG_SERVER_URL = 'http://localhost:3301';
  const TOP_K = 5;
  const DEBOUNCE_MS = 400;

  // ── Site configs with multiple possible editor selectors ─────────────────

  const SITES = [
    {
      name: 'claude',
      host: /claude\.ai/,
      selectors: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
    },
    {
      name: 'chatgpt',
      host: /chatgpt\.com|chat\.openai\.com/,
      selectors: [
        'div[contenteditable="true"]#prompt-textarea',
        'textarea#prompt-textarea',
        'div[contenteditable="true"]',
      ],
    },
    {
      name: 'gemini',
      host: /gemini\.google\.com|aistudio\.google\.com/,
      selectors: ['div[contenteditable="true"]', 'div[role="textbox"]'],
    },
    {
      name: 'copilot',
      host: /github\.com\/copilot/,
      selectors: ['div[contenteditable="true"]', 'textarea'],
    },
    {
      name: 'perplexity',
      host: /perplexity\.ai/,
      selectors: ['textarea[placeholder*="Ask"]', 'div[contenteditable="true"]', 'textarea'],
    },
    {
      name: 'phind',
      host: /phind\.com/,
      selectors: ['div[contenteditable="true"]', 'textarea'],
    },
    {
      name: 'you',
      host: /you\.com/,
      selectors: ['div[contenteditable="true"]'],
    },
    {
      name: 'huggingchat',
      host: /huggingface\.co\/chat/,
      selectors: ['div[contenteditable="true"]'],
    },
    {
      name: 'poe',
      host: /poe\.com/,
      selectors: ['div[contenteditable="true"]', 'textarea'],
    },
    {
      name: 'deepseek',
      host: /chat\.deepseek\.com/,
      selectors: [
        'div[contenteditable="true"]',
        'textarea',
        'div[role="textbox"]',
        '.chat-input',
        '[data-testid="chat-input"]',
        'div[class*="input"]',
      ],
    },
    {
      name: 'mistral',
      host: /chat\.mistral\.ai/,
      selectors: ['div[contenteditable="true"]'],
    },
    {
      name: 'kimi',
      host: /kimi\.com|kimi\.moonshot\.cn/,
      selectors: [
        'div[contenteditable="true"]',
        'textarea',
        'div[role="textbox"]',
        '.chat-input',
        '[data-testid="chat-input"]',
        'div[class*="input"]',
        'div[class*="editor"]',
      ],
    },
  ];

  function detectSite() {
    return SITES.find((s) => s.host.test(location.host));
  }

  // ── Auto-discover editor ────────────────────────────────────────────────

  function findEditor(site) {
    for (const selector of site.selectors) {
      const el = document.querySelector(selector);
      if (el) {
        console.log(`[rag-utils] Found editor via: ${selector}`);
        return el;
      }
    }
    return null;
  }

  // ── Smart query extraction ────────────────────────────────────────────

  const COMMON_WORDS = new Set([
    'the',
    'and',
    'for',
    'are',
    'but',
    'not',
    'you',
    'all',
    'can',
    'had',
    'her',
    'was',
    'one',
    'our',
    'out',
    'day',
    'get',
    'has',
    'him',
    'his',
    'how',
    'its',
    'may',
    'new',
    'now',
    'old',
    'see',
    'two',
    'way',
    'who',
    'boy',
    'did',
    'she',
    'use',
    'than',
    'them',
    'well',
    'were',
    'what',
    'with',
    'this',
    'that',
    'have',
    'from',
    'they',
    'know',
    'want',
    'been',
    'good',
    'much',
    'some',
    'time',
    'very',
    'when',
    'come',
    'here',
    'just',
    'like',
    'long',
    'make',
    'many',
    'over',
    'such',
    'take',
    'will',
    'would',
    'there',
    'their',
    'said',
    'each',
    'which',
    'could',
    'other',
    'after',
    'first',
    'never',
    'these',
    'think',
    'where',
    'being',
    'every',
    'great',
    'might',
    'shall',
    'still',
    'those',
    'while',
    'hello',
    'please',
    'thanks',
    'tell',
    'help',
    'need',
    'write',
    'code',
    'then',
    'also',
    'back',
    'only',
    'should',
    'must',
    'really',
    'actually',
    'sure',
    'yes',
    'no',
    'ok',
    'hey',
    'hi',
  ]);

  function isCommonWord(w) {
    return COMMON_WORDS.has(w.toLowerCase());
  }

  function extractSmartQuery(text) {
    if (!text || text.length < 2) return null;

    // 1. Stack trace: "at functionName (file:line:col)"
    const stackTrace = text.match(/at\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]+\)/);
    if (stackTrace) {
      console.log('[rag-utils] Extracted from stack trace:', stackTrace[1]);
      return stackTrace[1];
    }

    // 2. File paths
    const filePath = text.match(/(?:[\w-]+\/)+[\w-]+\.\w{1,6}/);
    if (filePath) return filePath[0];

    // 3. Error property: reading 'name'
    const errorProp = text.match(/reading\s+['"](\w+)['"]/);
    if (errorProp) {
      console.log('[rag-utils] Extracted error property:', errorProp[1]);
      return errorProp[1];
    }

    // 4. Error type + short message
    const errorShort = text.match(
      /(TypeError|ReferenceError|SyntaxError|RangeError)[:\s]*([^\n]{3,60})/i,
    );
    if (errorShort) {
      const clean = errorShort[2].replace(
        /Cannot read properties of undefined \(reading\s+['"](\w+)['"]\)/,
        '$1',
      );
      if (clean !== errorShort[2]) return clean;
      return errorShort[0].trim().substring(0, 80);
    }

    // 5. Code identifiers
    const tokens = text
      .split(/[\s\(\)\[\]\{\}\.\,\;\:\'\"`]+/)
      .filter((w) => w.length > 2 && w.length < 40 && !/^\d+$/.test(w));
    const codeLike = tokens.find(
      (w) => /_/.test(w) || /^[a-z]+[A-Z]/.test(w) || /^[A-Z][a-z]+[A-Z]/.test(w),
    );
    if (codeLike) return codeLike;
    const plainId = tokens.find((w) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(w) && !isCommonWord(w));
    if (plainId) return plainId;

    return null;
  }

  // ── Formatting ─────────────────────────────────────────────────────────

  function formatBlock({ record, score }) {
    return `// ${record.filePath}:${record.startLine}-${record.endLine}  ${record.name}  (score: ${score.toFixed(3)})\n${record.code}`;
  }

  function formatContextBlock(results) {
    if (!results?.length) return '';
    return results.map(formatBlock).join('\n\n');
  }

  // ── Auto-paste into chat editor ─────────────────────────────────────────

  function insertTextIntoEditor(text) {
    const site = detectSite();
    if (!site) return false;
    const editor = findEditor(site);
    if (!editor) return false;

    editor.focus();

    try {
      if (document.execCommand('insertText', false, text)) return true;
    } catch (e) {}

    const selection = window.getSelection();
    if (selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      editor.focus();
      const lastEl = editor.lastElementChild || editor;
      const newRange = document.createRange();
      newRange.selectNodeContents(lastEl);
      newRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    const safeRange = selection.getRangeAt(0);
    safeRange.deleteContents();
    const textNode = document.createTextNode(text);
    safeRange.insertNode(textNode);
    safeRange.setStartAfter(textNode);
    safeRange.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(safeRange);

    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    return true;
  }

  // ── Clipboard + Auto-paste ──────────────────────────────────────────────

  async function copyAndPaste(text, btn) {
    const original = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {}
    const pasted = insertTextIntoEditor('\n' + text + '\n');
    btn.textContent = pasted ? 'Pasted!' : 'Copied!';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 1200);
  }

  // ── Fetch file contents from server ───────────────────────────────────────

  async function fetchFileContents(filePath) {
    try {
      const res = await fetch(`${RAG_SERVER_URL}/file?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.content ?? null;
    } catch {
      return null;
    }
  }

  // ── Fetch RAG results ───────────────────────────────────────────────────

  let currentAbort = null;
  async function fetchContext(query) {
    if (currentAbort) currentAbort.abort();
    currentAbort = new AbortController();
    try {
      const res = await fetch(`${RAG_SERVER_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK: TOP_K }),
        signal: currentAbort.signal,
      });
      if (!res.ok) return { error: 'bad response', results: null };
      return { error: null, results: (await res.json()).results ?? null };
    } catch (err) {
      if (err.name === 'AbortError') return { error: 'aborted', results: null };
      return { error: 'offline', results: null };
    }
  }

  // ── Safe Syntax Highlighter ───────────────────────────────────────────

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function highlightLine(line) {
    const commentIdx = line.indexOf('//');
    let codePart, commentPart;

    if (commentIdx !== -1) {
      codePart = line.slice(0, commentIdx);
      commentPart = line.slice(commentIdx);
    } else {
      codePart = line;
      commentPart = null;
    }

    let html = escapeHtml(codePart);
    const keywords = new Set([
      'function',
      'const',
      'let',
      'var',
      'return',
      'if',
      'else',
      'for',
      'while',
      'class',
      'import',
      'export',
      'from',
      'async',
      'await',
      'new',
      'try',
      'catch',
      'throw',
      'typeof',
      'instanceof',
      'in',
      'of',
      'continue',
      'break',
      'switch',
      'case',
      'default',
      'true',
      'false',
      'null',
      'undefined',
      'this',
      'super',
      'extends',
      'static',
      'get',
      'set',
    ]);

    html = html
      .split(/(\s+|[(){}\[\];,.'"=+\-*/<>!&|]+)/)
      .map((token) => {
        if (keywords.has(token)) return `<span class="rag-keyword">${token}</span>`;
        if (/^".*"$|^'.*'$|^`.*`$/.test(token)) return `<span class="rag-string">${token}</span>`;
        if (/^\d+$/.test(token)) return `<span class="rag-number">${token}</span>`;
        if (/^\w+\($/.test(token))
          return `<span class="rag-function">${token.slice(0, -1)}</span>(`;
        return token;
      })
      .join('');

    if (commentPart) {
      html += `<span class="rag-comment">${escapeHtml(commentPart)}</span>`;
    }

    return html;
  }

  // ── Dark Theme Styles ───────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('rag-utils-styles')) return;
    const s = document.createElement('style');
    s.id = 'rag-utils-styles';
    s.textContent = `
      #rag-utils-panel {
        position: fixed;
        top: 90px;
        right: 16px;
        width: 480px;
        max-height: 85vh;
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 14px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.5);
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        color: #cccccc;
        display: flex;
        flex-direction: column;
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
        overflow: hidden;
      }
      #rag-utils-panel.rag-utils-collapsed {
        transform: translateX(calc(100% - 52px));
        opacity: 0.95;
      }
      #rag-utils-panel.rag-utils-collapsed .rag-utils-body,
      #rag-utils-panel.rag-utils-collapsed .rag-utils-title,
      #rag-utils-panel.rag-utils-collapsed .rag-utils-query {
        display: none;
      }
      .rag-utils-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 14px 16px;
        border-bottom: 1px solid #333;
        cursor: pointer;
        background: #252526;
      }
      .rag-utils-title {
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #ffffff;
      }
      .rag-utils-badge {
        background: #0e639c;
        color: #fff;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
      }
      .rag-utils-query {
        font-size: 11px;
        color: #858585;
        margin-top: 3px;
        font-weight: 400;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 260px;
      }
      .rag-utils-toggle {
        border: none;
        background: #3c3c3c;
        border-radius: 8px;
        width: 32px;
        height: 32px;
        flex: 0 0 auto;
        cursor: pointer;
        font-size: 14px;
        color: #cccccc;
        display: grid;
        place-items: center;
        transition: background 0.15s;
      }
      .rag-utils-toggle:hover { background: #4a4a4a; }
      .rag-utils-body {
        overflow-y: auto;
        padding: 14px 16px;
        flex: 1;
      }
      .rag-utils-empty {
        color: #6e6e6e;
        text-align: center;
        padding: 28px 8px;
        font-size: 13px;
      }
      .rag-utils-allbar {
        margin-bottom: 14px;
        display: flex;
        gap: 8px;
      }
      .rag-utils-group {
        margin-bottom: 16px;
        border: 1px solid #333;
        border-radius: 12px;
        overflow: hidden;
        background: #252526;
      }
      .rag-utils-group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        background: #2d2d30;
        padding: 10px 14px;
        border-bottom: 1px solid #333;
      }
      .rag-utils-filename {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
        font-size: 12px;
        word-break: break-all;
        flex: 1;
        color: #4ec9b0;
      }
      .rag-utils-entry {
        padding: 0;
        border-top: 1px solid #333;
      }
      .rag-utils-entry:first-child {
        border-top: none;
      }
      .rag-utils-entry-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 14px;
        background: #1e1e1e;
        gap: 8px;
      }
      .rag-utils-fnname {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #dcdcaa;
        font-size: 12px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
      }
      .rag-utils-score {
        color: #6e6e6e;
        font-size: 11px;
        flex: 0 0 auto;
        margin-left: auto;
        margin-right: 8px;
      }
      .rag-utils-score-high { color: #4ec9b0; font-weight: 600; }
      .rag-utils-score-med { color: #dcdcaa; }
      .rag-utils-score-low { color: #ce9178; }
      .rag-utils-code-wrapper {
        background: #1e1e1e;
        border-radius: 0 0 10px 10px;
        overflow: hidden;
      }
      .rag-utils-code-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 14px;
        background: #2d2d30;
        border-bottom: 1px solid #333;
        font-size: 11px;
        color: #858585;
      }
      .rag-utils-code-lang {
        background: #1e1e1e;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 10px;
        color: #cccccc;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
      }
      .rag-utils-code {
        margin: 0;
        max-height: 300px;
        overflow: auto;
        background: #1e1e1e;
        padding: 8px 0;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
        font-size: 12px;
        line-height: 1.6;
        color: #d4d4d4;
        white-space: pre;
      }
      .rag-utils-code-line {
        display: flex;
        padding: 0 14px;
      }
      .rag-utils-line-num {
        color: #6e7681;
        text-align: right;
        min-width: 36px;
        padding-right: 14px;
        user-select: none;
        font-size: 11px;
      }
      .rag-utils-line-content {
        flex: 1;
        white-space: pre;
      }
      .rag-utils-code::-webkit-scrollbar { width: 10px; height: 10px; }
      .rag-utils-code::-webkit-scrollbar-track { background: #1e1e1e; }
      .rag-utils-code::-webkit-scrollbar-thumb { background: #424242; border-radius: 5px; }
      .rag-utils-code::-webkit-scrollbar-thumb:hover { background: #4f4f4f; }
      .rag-keyword { color: #569cd6; }
      .rag-string { color: #ce9178; }
      .rag-comment { color: #6a9955; }
      .rag-function { color: #dcdcaa; }
      .rag-number { color: #b5cea8; }
      .rag-btn {
        border: 1px solid #454545;
        background: #3c3c3c;
        border-radius: 6px;
        padding: 4px 12px;
        font-size: 12px;
        cursor: pointer;
        flex: 0 0 auto;
        color: #cccccc;
        font-weight: 500;
        transition: all 0.15s;
        font-family: inherit;
      }
      .rag-btn:hover { background: #4a4a4a; border-color: #555; }
      .rag-btn:disabled { opacity: 0.5; cursor: default; }
      .rag-btn-primary {
        background: #0e639c;
        color: #fff;
        border-color: #0e639c;
      }
      .rag-btn-primary:hover { background: #1177bb; border-color: #1177bb; }
      .rag-loading {
        color: #858585;
        text-align: center;
        padding: 28px;
        font-style: italic;
      }
      .rag-offline {
        color: #f48771;
        text-align: center;
        padding: 28px;
        font-weight: 500;
      }
    `;
    document.head.appendChild(s);
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  let panelEl = null,
    bodyEl = null,
    badgeEl = null,
    queryDisplayEl = null;

  function getOrCreatePanel() {
    const existing = document.getElementById('rag-utils-panel');
    if (existing) {
      panelEl = existing;
      bodyEl = panelEl.querySelector('.rag-utils-body');
      badgeEl = panelEl.querySelector('.rag-utils-badge');
      queryDisplayEl = panelEl.querySelector('.rag-utils-query');
      return;
    }
    injectStyles();
    panelEl = document.createElement('div');
    panelEl.id = 'rag-utils-panel';
    panelEl.className = 'rag-utils-collapsed';

    const header = document.createElement('div');
    header.className = 'rag-utils-header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'rag-utils-title';
    titleWrap.textContent = 'RAG Context';
    badgeEl = document.createElement('span');
    badgeEl.className = 'rag-utils-badge';
    badgeEl.textContent = '0';
    titleWrap.appendChild(badgeEl);
    queryDisplayEl = document.createElement('div');
    queryDisplayEl.className = 'rag-utils-query';
    titleWrap.appendChild(queryDisplayEl);
    const toggle = document.createElement('button');
    toggle.className = 'rag-utils-toggle';
    toggle.innerHTML = '&#x2630;';
    toggle.title = 'Show/hide';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      panelEl.classList.toggle('rag-utils-collapsed');
    });
    header.appendChild(titleWrap);
    header.appendChild(toggle);
    header.addEventListener('click', () => panelEl.classList.toggle('rag-utils-collapsed'));

    bodyEl = document.createElement('div');
    bodyEl.className = 'rag-utils-body';
    panelEl.appendChild(header);
    panelEl.appendChild(bodyEl);
    document.body.appendChild(panelEl);
    setEmptyState('Start typing a function name, error, or file path…');
  }

  function setEmptyState(msg) {
    bodyEl.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'rag-utils-empty';
    empty.textContent = msg;
    bodyEl.appendChild(empty);
    badgeEl.textContent = '0';
    if (queryDisplayEl) queryDisplayEl.textContent = '';
  }

  function showLoading(query) {
    bodyEl.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'rag-loading';
    loading.textContent = 'Searching local index…';
    bodyEl.appendChild(loading);
    if (queryDisplayEl)
      queryDisplayEl.textContent = `query: "${query.substring(0, 40)}${query.length > 40 ? '…' : ''}"`;
  }

  function showOffline() {
    bodyEl.replaceChildren();
    const offline = document.createElement('div');
    offline.className = 'rag-offline';
    offline.textContent = 'RAG server offline. Run rag start.';
    bodyEl.appendChild(offline);
    badgeEl.textContent = '!';
  }

  // ── VS Code-style Code Renderer ─────────────────────────────────────────

  function getScoreClass(score) {
    if (score >= 0.5) return 'rag-utils-score-high';
    if (score >= 0.2) return 'rag-utils-score-med';
    return 'rag-utils-score-low';
  }

  function renderCodeBlock(code, language) {
    const wrapper = document.createElement('div');
    wrapper.className = 'rag-utils-code-wrapper';

    const header = document.createElement('div');
    header.className = 'rag-utils-code-header';
    const langBadge = document.createElement('span');
    langBadge.className = 'rag-utils-code-lang';
    langBadge.textContent = language;
    header.appendChild(langBadge);
    wrapper.appendChild(header);

    const pre = document.createElement('pre');
    pre.className = 'rag-utils-code';

    const lines = code.split('\n');
    lines.forEach((line, i) => {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'rag-utils-code-line';

      const num = document.createElement('span');
      num.className = 'rag-utils-line-num';
      num.textContent = i + 1;

      const content = document.createElement('span');
      content.className = 'rag-utils-line-content';
      content.innerHTML = highlightLine(line);

      lineDiv.appendChild(num);
      lineDiv.appendChild(content);
      pre.appendChild(lineDiv);
    });

    wrapper.appendChild(pre);
    return wrapper;
  }

  function renderResults(results, query) {
    if (!panelEl) return;
    if (queryDisplayEl)
      queryDisplayEl.textContent = `query: "${query.substring(0, 40)}${query.length > 40 ? '…' : ''}"`;
    if (!results?.length) {
      setEmptyState('No matching code found.');
      return;
    }

    results.sort((a, b) => b.score - a.score);

    badgeEl.textContent = String(results.length);
    bodyEl.replaceChildren();
    panelEl.classList.remove('rag-utils-collapsed');

    const allBar = document.createElement('div');
    allBar.className = 'rag-utils-allbar';
    const allBtn = document.createElement('button');
    allBtn.className = 'rag-btn rag-btn-primary';
    allBtn.textContent = `Copy all (${results.length})`;
    allBtn.addEventListener('click', () => copyAndPaste(formatContextBlock(results), allBtn));
    allBar.appendChild(allBtn);
    bodyEl.appendChild(allBar);

    const byFile = new Map();
    for (const r of results) {
      const fp = r.record.filePath;
      if (!byFile.has(fp)) byFile.set(fp, []);
      byFile.get(fp).push(r);
    }

    const fileOrder = [];
    for (const [fp, items] of byFile) {
      fileOrder.push({ fp, maxScore: Math.max(...items.map((i) => i.score)) });
    }
    fileOrder.sort((a, b) => b.maxScore - a.maxScore);

    for (const { fp: filePath } of fileOrder) {
      const items = byFile.get(filePath);
      const group = document.createElement('div');
      group.className = 'rag-utils-group';

      const groupHeader = document.createElement('div');
      groupHeader.className = 'rag-utils-group-header';
      const fileLabel = document.createElement('span');
      fileLabel.className = 'rag-utils-filename';
      fileLabel.textContent = filePath;
      const fileCopyBtn = document.createElement('button');
      fileCopyBtn.className = 'rag-btn';
      fileCopyBtn.textContent = 'Copy file';
      fileCopyBtn.addEventListener('click', async () => {
        fileCopyBtn.textContent = 'Loading…';
        fileCopyBtn.disabled = true;
        const fullContent = await fetchFileContents(filePath);
        if (fullContent) {
          await copyAndPaste(fullContent, fileCopyBtn);
        } else {
          fileCopyBtn.textContent = 'Failed';
          setTimeout(() => {
            fileCopyBtn.textContent = 'Copy file';
            fileCopyBtn.disabled = false;
          }, 1200);
        }
      });
      groupHeader.appendChild(fileLabel);
      groupHeader.appendChild(fileCopyBtn);
      group.appendChild(groupHeader);

      items.sort((a, b) => b.score - a.score);
      for (const item of items) {
        const entry = document.createElement('div');
        entry.className = 'rag-utils-entry';

        const meta = document.createElement('div');
        meta.className = 'rag-utils-entry-meta';

        const fnName = document.createElement('span');
        fnName.className = 'rag-utils-fnname';
        fnName.textContent = item.record.name;
        fnName.title = item.record.name;

        const score = document.createElement('span');
        score.className = 'rag-utils-score ' + getScoreClass(item.score);
        score.textContent = `${(item.score * 100).toFixed(0)}%`;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'rag-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => copyAndPaste(formatBlock(item), copyBtn));

        meta.appendChild(fnName);
        meta.appendChild(score);
        meta.appendChild(copyBtn);
        entry.appendChild(meta);

        const lang = item.record.language || 'javascript';
        const codeBlock = renderCodeBlock(item.record.code, lang);
        entry.appendChild(codeBlock);

        group.appendChild(entry);
      }

      bodyEl.appendChild(group);
    }
  }

  // ── Editor wiring ─────────────────────────────────────────────────────

  function getEditorText(el) {
    return (el.value ?? el.innerText ?? el.textContent ?? '').trim();
  }

  function wireEditor(editor) {
    if (editor.dataset.ragUtilsWired === 'true') return;
    editor.dataset.ragUtilsWired = 'true';
    getOrCreatePanel();

    let debounceTimer = null,
      lastRaw = '',
      lastSmart = '';

    const onInput = () => {
      const raw = getEditorText(editor);
      if (!raw) {
        clearTimeout(debounceTimer);
        lastRaw = '';
        setEmptyState('Start typing…');
        return;
      }
      if (raw === lastRaw) return;
      lastRaw = raw;
      const smart = extractSmartQuery(raw);
      clearTimeout(debounceTimer);
      if (!smart) {
        setEmptyState('Type a function name, error, or file path…');
        return;
      }
      if (smart === lastSmart) return;
      debounceTimer = setTimeout(async () => {
        lastSmart = smart;
        showLoading(smart);
        const { error, results } = await fetchContext(smart);
        if (error === 'offline') {
          showOffline();
          return;
        }
        renderResults(results, smart);
      }, DEBOUNCE_MS);
    };

    editor.addEventListener('input', onInput);
    editor.addEventListener('paste', () => setTimeout(onInput, 60));
    console.log('[rag-utils] Wired to editor.');
  }

  // ── Boot ──────────────────────────────────────────────────────────────

  function boot() {
    const site = detectSite();
    if (!site) {
      console.log('[rag-utils] Unrecognized site: ' + location.host);
      return;
    }
    console.log('[rag-utils] Detected site: ' + site.name);

    const editor = findEditor(site);
    if (editor) {
      wireEditor(editor);
    } else {
      console.log('[rag-utils] Editor not found, waiting for DOM...');
      const obs = new MutationObserver(() => {
        const ed = findEditor(site);
        if (ed && !ed.dataset.ragUtilsWired) {
          console.log('[rag-utils] Found editor via MutationObserver');
          wireEditor(ed);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  boot();
  console.log('[rag-utils] content script loaded on ' + location.host);
}
