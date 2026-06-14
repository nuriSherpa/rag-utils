/**
 * popup.js
 *
 * Pings the local rag-utils server and reflects its status in the popup UI.
 */

const STATUS_URL = 'http://localhost:3301/status';

async function refreshStatus() {
  const dot = document.querySelector('.dot');
  const text = document.getElementById('status-text');

  try {
    const res = await fetch(STATUS_URL);
    if (!res.ok) throw new Error('bad response');
    const data = await res.json();

    dot.classList.add('online');
    dot.classList.remove('offline');

    const watchLabel = data.watching ? ' · watching' : '';
    text.textContent = `${data.indexedFunctions} functions · ${data.indexedFiles} files${watchLabel}`;
  } catch {
    dot.classList.add('offline');
    dot.classList.remove('online');
    text.textContent = 'Server not running (rag start)';
  }
}

refreshStatus();
// Re-check every 5 s so status stays fresh while the popup is open
setInterval(refreshStatus, 5000);
