const summaryEl = document.getElementById('summary');
const logEl = document.getElementById('log');

const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const refreshBtn = document.getElementById('refresh');

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || tabs[0].id == null) {
    throw new Error('No active tab found.');
  }
  return tabs[0];
}

async function sendToActiveTab(message) {
  const tab = await getActiveTabId();
  return chrome.tabs.sendMessage(tab.id, message);
}

function isRedditUrl(url) {
  if (!url) {
    return false;
  }
  return /https?:\/\/(old\.)?reddit\.com\//i.test(url);
}

async function ensureContentScriptReady() {
  const tab = await getActiveTabId();
  if (tab.id == null) {
    throw new Error('No active tab id.');
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'STATUS' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const noReceiver = msg.includes('Receiving end does not exist');

    if (!noReceiver) {
      throw err;
    }

    if (!isRedditUrl(tab.url)) {
      throw new Error('Open a reddit.com or old.reddit.com tab first.');
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    return chrome.tabs.sendMessage(tab.id, { type: 'STATUS' });
  }
}

function renderStatus(status) {
  if (!status) {
    summaryEl.textContent = 'No status from content script.';
    logEl.textContent = '';
    return;
  }

  const s = status.stats || {};
  const d = status.diagnostics || {};
  summaryEl.textContent =
    `Running: ${status.running ? 'yes' : 'no'} | ` +
    `Page: ${status.pageNumber || 0}/${d.maxPages ?? '?'} | ` +
    `Deleted: ${s.deleted || 0} | ` +
    `Attempted: ${s.attempted || 0} | ` +
    `Skipped: ${s.skipped || 0} | ` +
    `Failed: ${s.failed || 0}`;

  const lines = (status.logs || []).slice(-200);
  logEl.textContent = lines.join('\n');
}

async function refreshStatus() {
  try {
    const status = await ensureContentScriptReady();
    renderStatus(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summaryEl.textContent = `Error: ${msg}`;
  }
}

startBtn.addEventListener('click', async () => {
  try {
    await ensureContentScriptReady();
    const result = await sendToActiveTab({ type: 'START' });
    renderStatus(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summaryEl.textContent = `Start failed: ${msg}`;
  }
});

stopBtn.addEventListener('click', async () => {
  try {
    const result = await sendToActiveTab({ type: 'STOP' });
    renderStatus(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summaryEl.textContent = `Stop failed: ${msg}`;
  }
});

refreshBtn.addEventListener('click', () => {
  void refreshStatus();
});

void refreshStatus();
setInterval(() => {
  void refreshStatus();
}, 1500);
