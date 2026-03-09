const summaryEl = document.getElementById("summary");
const metricRunningEl = document.getElementById("metricRunning");
const metricDeletedEl = document.getElementById("metricDeleted");
const metricSkippedEl = document.getElementById("metricSkipped");
const metricFailedEl = document.getElementById("metricFailed");
const logEl = document.getElementById("log");
const errorPanelEl = document.getElementById("errorPanel");

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");

function setRunButtonState(isRunning) {
  startBtn.disabled = isRunning;
  stopBtn.disabled = !isRunning;

  if (isRunning) {
    startBtn.classList.add("running");
    stopBtn.classList.add("running");
  } else {
    startBtn.classList.remove("running");
    stopBtn.classList.remove("running");
  }
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || tabs[0].id == null) {
    throw new Error("No active tab found.");
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
    throw new Error("No active tab id.");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "STATUS" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const noReceiver = msg.includes("Receiving end does not exist");

    if (!noReceiver) {
      throw err;
    }

    if (!isRedditUrl(tab.url)) {
      throw new Error("Open a reddit.com or old.reddit.com tab first.");
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    return chrome.tabs.sendMessage(tab.id, { type: "STATUS" });
  }
}

function renderStatus(status) {
  if (!status) {
    summaryEl.textContent = "Status";
    logEl.textContent = "";
    metricRunningEl.textContent = "No";
    metricDeletedEl.textContent = "0";
    metricSkippedEl.textContent = "0";
    metricFailedEl.textContent = "0";
    errorPanelEl.hidden = true;
    setRunButtonState(false);
    return;
  }

  const s = status.stats || {};
  const d = status.diagnostics || {};
  summaryEl.textContent = "Status";
  metricRunningEl.textContent = status.running ? "Yes" : "No";
  metricDeletedEl.textContent = String(s.deleted || 0);
  metricSkippedEl.textContent = String(s.skipped || 0);
  metricFailedEl.textContent = String(s.failed || 0);
  metricRunningEl.classList.toggle("isRunning", Boolean(status.running));

  const lines = (status.logs || []).slice(-200);
  setRunButtonState(Boolean(status.running));

  const hasErrorSignal =
    (s.failed || 0) > 0 ||
    Boolean(d.lastError) ||
    lines.some((line) => line.includes("[ERR]") || line.includes("[FAIL]"));

  if (hasErrorSignal) {
    errorPanelEl.hidden = false;
    logEl.textContent = lines.join("\n");
  } else {
    errorPanelEl.hidden = true;
    logEl.textContent = "";
  }
}

async function refreshStatus() {
  try {
    const status = await ensureContentScriptReady();
    renderStatus(status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summaryEl.textContent = `Status (Error: ${msg})`;
    setRunButtonState(false);
  }
}

startBtn.addEventListener("click", async () => {
  try {
    await ensureContentScriptReady();
    const result = await sendToActiveTab({ type: "START" });
    renderStatus(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summaryEl.textContent = `Start failed: ${msg}`;
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    const tab = await getActiveTabId();
    const result = await sendToActiveTab({ type: "STOP" });
    renderStatus(result);
    if (tab.id != null) {
      await chrome.tabs.reload(tab.id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summaryEl.textContent = `Stop failed: ${msg}`;
  }
});

void refreshStatus();
setInterval(() => {
  void refreshStatus();
}, 1500);
