if (globalThis.__EXXIT_CONTENT_SCRIPT_LOADED__) {
  // Prevent duplicate execution when the content script is injected manually.
} else {
  globalThis.__EXXIT_CONTENT_SCRIPT_LOADED__ = true;

  const STORAGE_KEY = "exxitStateV1";

  const state = {
    running: false,
    stopRequested: false,
    runId: null,
    pageNumber: 0,
    logs: [],
    stats: {
      attempted: 0,
      deleted: 0,
      skipped: 0,
      failed: 0,
    },
    config: {
      delayMs: 1200,
      maxPages: 500,
      followNext: true,
      refreshEveryDeletions: 20,
    },
    diagnostics: {
      startedAt: null,
      finishedAt: null,
      locationHref: "",
      usernameInPath: null,
      modeDetected: "unknown",
      maxPages: 500,
      remainingComments: 0,
      remainingPosts: 0,
      deletesSinceRefresh: 0,
      lastError: null,
      lastNextUrl: null,
      lastUpdated: null,
    },
  };

  function persistState() {
    try {
      const serializable = {
        running: state.running,
        stopRequested: state.stopRequested,
        runId: state.runId,
        pageNumber: state.pageNumber,
        logs: state.logs,
        stats: state.stats,
        config: state.config,
        diagnostics: {
          ...state.diagnostics,
          lastUpdated: new Date().toISOString(),
        },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch {
      // ignore persistence errors
    }
  }

  function restoreState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      state.running = Boolean(parsed.running);
      state.stopRequested = Boolean(parsed.stopRequested);
      state.runId = parsed.runId || null;
      state.pageNumber = Number(parsed.pageNumber) || 0;
      state.logs = Array.isArray(parsed.logs) ? parsed.logs : [];
      state.stats = parsed.stats || state.stats;
      state.config = parsed.config || state.config;
      state.diagnostics = {
        ...state.diagnostics,
        ...(parsed.diagnostics || {}),
      };
    } catch {
      // ignore restore errors
    }
  }

  function finishRun(reason) {
    state.running = false;
    state.stopRequested = false;
    state.diagnostics.finishedAt = new Date().toISOString();
    if (reason) {
      log(`[DONE] ${reason}`);
    }
    persistState();
  }

  function now() {
    return new Date().toISOString().slice(11, 19);
  }

  function log(message) {
    state.logs.push(`${now()} ${message}`);
    if (state.logs.length > 300) {
      state.logs = state.logs.slice(-300);
    }
    persistState();
  }

  function snapshot() {
    state.diagnostics.lastUpdated = new Date().toISOString();
    return {
      running: state.running,
      runId: state.runId,
      pageNumber: state.pageNumber,
      logs: state.logs,
      stats: state.stats,
      config: state.config,
      diagnostics: state.diagnostics,
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function detectMode() {
    const path = window.location.pathname;
    if (/\/user\/[^/]+\/comments\/?$/i.test(path)) {
      return "comments";
    }
    if (/\/user\/[^/]+\/submitted\/?$/i.test(path)) {
      return "submitted";
    }
    if (
      /\/user\/[^/]+\/?$/i.test(path) ||
      /\/user\/[^/]+\/overview\/?$/i.test(path)
    ) {
      return "overview";
    }
    return "unknown";
  }

  function ensureOldRedditPathMode() {
    if (!window.location.hostname.startsWith("old.reddit.com")) {
      state.diagnostics.lastError = "Not on old.reddit.com";
      persistState();
      return false;
    }
    const mode = detectMode();
    state.diagnostics.modeDetected = mode;
    if (mode === "unknown") {
      state.diagnostics.lastError = "Not on supported old.reddit user path";
      persistState();
      return false;
    }
    state.diagnostics.lastError = null;
    persistState();
    return true;
  }

  function currentUsername() {
    const m = window.location.pathname.match(/\/user\/([^/]+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  function currentModhash() {
    // Content scripts run in an isolated JS world, so page globals like window.r
    // may be unavailable. Prefer DOM sources that are always present when logged in.
    const fromInput =
      document.querySelector('form.logout input[name="uh"]')?.value ||
      document.querySelector('#header-bottom-right input[name="uh"]')?.value ||
      document.querySelector('input[name="uh"]')?.value ||
      null;
    if (typeof fromInput === "string" && fromInput.length > 0) {
      return fromInput;
    }

    // Fallback for pages where modhash only appears in inline setup script.
    for (const script of Array.from(document.scripts)) {
      const text = script.textContent || "";
      const m = text.match(/"modhash"\s*:\s*"([^"]+)"/);
      if (m?.[1]) {
        return m[1];
      }
    }

    return null;
  }

  function candidateThings(mode) {
    const all = Array.from(document.querySelectorAll("#siteTable > div.thing"));
    if (mode === "comments") {
      return all.filter((el) => el.classList.contains("comment"));
    }
    if (mode === "submitted") {
      return all.filter((el) => el.classList.contains("link"));
    }
    return all.filter(
      (el) => el.classList.contains("comment") || el.classList.contains("link"),
    );
  }

  function countRemaining(things) {
    const me = currentUsername();
    if (!me) {
      return { comments: 0, posts: 0 };
    }

    let comments = 0;
    let posts = 0;
    for (const thing of things) {
      if (thingAuthor(thing) !== me) {
        continue;
      }
      if (isResolved(thing)) {
        continue;
      }
      const { mainDelete } = deleteControls(thing);
      if (!mainDelete) {
        continue;
      }

      if (thing.classList.contains("comment")) {
        comments += 1;
        continue;
      }
      if (thing.classList.contains("link")) {
        posts += 1;
      }
    }
    return { comments, posts };
  }

  function updateRemainingFromDom(mode) {
    const things = candidateThings(mode);
    const remaining = countRemaining(things);
    state.diagnostics.remainingComments = remaining.comments;
    state.diagnostics.remainingPosts = remaining.posts;
    persistState();
    return remaining;
  }

  function thingAuthor(thing) {
    const topAuthor = thing.querySelector(":scope > .entry .tagline a.author");
    if (topAuthor?.textContent) {
      return topAuthor.textContent.toLowerCase();
    }
    const fallback = thing.querySelector(".entry .tagline a.author");
    return (fallback?.textContent || "").toLowerCase();
  }

  function actionableCount(things) {
    const me = currentUsername();
    if (!me) {
      return 0;
    }
    let count = 0;
    for (const thing of things) {
      if (thingAuthor(thing) !== me) {
        continue;
      }
      if (isResolved(thing)) {
        continue;
      }
      const { mainDelete } = deleteControls(thing);
      if (!mainDelete) {
        continue;
      }
      count += 1;
    }
    return count;
  }

  function emptyPageReloadKey() {
    return `exxitReloadedEmpty:${state.runId || "none"}:${window.location.pathname}${window.location.search}`;
  }

  function deleteControls(thing) {
    const mainDelete = thing.querySelector(
      ":scope > .entry form.del-button .option.main a",
    );
    const confirmYes = thing.querySelector(
      ":scope > .entry form.del-button .option.error a.yes",
    );
    const form = thing.querySelector(":scope > .entry form.del-button");
    const idInput = form?.querySelector('input[name="id"]');
    const uhInput = form?.querySelector('input[name="uh"]');
    return {
      mainDelete,
      confirmYes,
      form,
      thingIdFromForm: idInput?.getAttribute("value") || null,
      uh: uhInput?.getAttribute("value") || null,
    };
  }

  function isResolved(thing) {
    if (
      thing.classList.contains("deleted") ||
      thing.classList.contains("spam")
    ) {
      return true;
    }
    const ownEntry =
      thing.querySelector(":scope > .entry") || thing.querySelector(".entry");
    const bodyText = (ownEntry?.textContent || "").toLowerCase();
    if (bodyText.includes("[deleted]")) {
      return true;
    }
    return false;
  }

  async function deleteViaApi(thingId, uh) {
    const payload = new URLSearchParams();
    payload.set("id", thingId);
    payload.set("uh", uh);
    payload.set("api_type", "json");

    const res = await fetch("/api/del", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: payload.toString(),
    });

    const text = await res.text();
    let apiErrors = [];
    try {
      const json = JSON.parse(text);
      apiErrors = json?.json?.errors || [];
    } catch {
      // some responses may not be JSON
    }

    return {
      ok: res.ok,
      status: res.status,
      apiErrors,
      bodyText: text.slice(0, 280),
    };
  }

  async function processThing(thing) {
    const author = thingAuthor(thing);
    const me = currentUsername();
    if (!author || !me || author !== me) {
      state.stats.skipped += 1;
      log(
        `[SKIP] not-own-item id=${thing.getAttribute("data-fullname") || thing.id || "unknown"} author=${author || "none"} expected=${me || "none"}`,
      );
      return;
    }

    const id = thing.getAttribute("data-fullname") || thing.id || "unknown";

    if (isResolved(thing)) {
      state.stats.skipped += 1;
      log(`[SKIP] already-resolved ${id}`);
      return;
    }

    const { mainDelete, thingIdFromForm, uh } = deleteControls(thing);
    if (!mainDelete) {
      state.stats.skipped += 1;
      log(`[SKIP] no-delete-control ${id}`);
      return;
    }

    state.stats.attempted += 1;

    try {
      let deletedByApi = false;
      const apiThingId = thingIdFromForm || id;
      const apiUh = uh || currentModhash();
      if (apiThingId && apiUh) {
        const apiResult = await deleteViaApi(apiThingId, apiUh);
        log(
          `[API] del id=${apiThingId} status=${apiResult.status} errors=${JSON.stringify(apiResult.apiErrors)}`,
        );
        if (!apiResult.ok) {
          log(`[API] non-ok response body=${apiResult.bodyText}`);
        }
        deletedByApi = apiResult.ok && apiResult.apiErrors.length === 0;
      } else {
        log(`[WARN] api delete unavailable for ${id} (missing id/modhash)`);
      }

      if (deletedByApi) {
        // old.reddit often doesn't update the current DOM after /api/del, but
        // changes are reflected after reload/navigation. Accept API success.
        state.stats.deleted += 1;
        state.diagnostics.deletesSinceRefresh += 1;
        log(`[OK] deleted ${id} (api-accepted)`);

        const mode = state.diagnostics.modeDetected;
        updateRemainingFromDom(mode);

        if (
          state.diagnostics.deletesSinceRefresh >=
          state.config.refreshEveryDeletions
        ) {
          state.diagnostics.deletesSinceRefresh = 0;
          log("Refresh threshold reached; reloading page.");
          persistState();
          return { triggerReload: true };
        }
      } else {
        state.stats.failed += 1;
        log(`[FAIL] api-delete-not-accepted ${id}`);
      }
    } catch (err) {
      state.stats.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      log(`[ERR] delete error for ${id}: ${msg}`);
    }

    await sleep(state.config.delayMs);
    return { triggerReload: false };
  }

  function nextPageUrl() {
    const nextLink = document.querySelector("span.next-button a");
    if (!nextLink) {
      return null;
    }
    const href = nextLink.getAttribute("href");
    if (!href) {
      return null;
    }
    return href;
  }

  async function runCurrentPage() {
    state.diagnostics.locationHref = window.location.href;
    state.diagnostics.usernameInPath = currentUsername();
    if (!ensureOldRedditPathMode()) {
      log("Open a supported old.reddit.com user page first.");
      finishRun("unsupported page");
      return;
    }

    state.pageNumber += 1;
    persistState();
    log(`Processing page ${state.pageNumber}`);

    const mode = state.diagnostics.modeDetected;
    const things = candidateThings(mode);
    log(`Mode=${mode} found ${things.length} candidate items`);
    const remainingNow = updateRemainingFromDom(mode);
    log(
      `Remaining now comments=${remainingNow.comments} posts=${remainingNow.posts}`,
    );
    const beforeActionable = actionableCount(things);
    log(`Actionable on page=${beforeActionable}`);

    if (beforeActionable === 0) {
      const key = emptyPageReloadKey();
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        log(
          "No actionable items found; reloading page once to confirm empty state.",
        );
        window.location.reload();
        return;
      }
      log("No actionable items after reload; continuing to next page.");
    }

    for (const thing of things) {
      if (state.stopRequested) {
        log("Stop requested. Halting current page.");
        finishRun("stopped by user");
        return;
      }
      const result = await processThing(thing);
      if (result?.triggerReload) {
        window.location.reload();
        return;
      }
    }

    if (state.stopRequested) {
      finishRun("stopped by user");
      return;
    }

    if (!state.config.followNext || state.pageNumber >= state.config.maxPages) {
      finishRun("page limit reached or follow-next disabled");
      return;
    }

    const next = nextPageUrl();
    if (!next) {
      finishRun("no next page found");
      return;
    }

    state.diagnostics.lastNextUrl = next;
    persistState();
    log(`Navigating to next page: ${next}`);
    window.location.href = next;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      sendResponse(snapshot());
      return;
    }

    if (message.type === "START") {
      restoreState();
      if (state.running) {
        log("Start ignored: run already in progress.");
        sendResponse(snapshot());
        return;
      }

      state.stopRequested = false;
      state.running = true;
      state.runId = `run-${Date.now()}`;
      state.pageNumber = 0;
      state.logs = [];
      state.diagnostics = {
        startedAt: new Date().toISOString(),
        finishedAt: null,
        locationHref: window.location.href,
        usernameInPath: currentUsername(),
        modeDetected: detectMode(),
        maxPages: state.config.maxPages,
        remainingComments: 0,
        remainingPosts: 0,
        deletesSinceRefresh: 0,
        lastError: null,
        lastNextUrl: null,
        lastUpdated: new Date().toISOString(),
      };
      state.stats = {
        attempted: 0,
        deleted: 0,
        skipped: 0,
        failed: 0,
      };
      log(
        `Start delay=${state.config.delayMs}ms maxPages=${state.config.maxPages}`,
      );
      log(`Run ID=${state.runId}`);
      log(`URL=${window.location.href}`);
      log(`User in path=${state.diagnostics.usernameInPath || "none"}`);
      log(`Detected mode=${state.diagnostics.modeDetected}`);
      persistState();
      void runCurrentPage();
      sendResponse(snapshot());
      return;
    }

    if (message.type === "STOP") {
      state.stopRequested = true;
      log("Stop requested from popup.");
      persistState();
      sendResponse(snapshot());
      return;
    }

    if (message.type === "STATUS") {
      sendResponse(snapshot());
      return;
    }

    sendResponse(snapshot());
  });

  restoreState();

  (function maybeAutoResume() {
    if (state.running && !state.stopRequested) {
      log("Resuming persisted run on this page.");
      void runCurrentPage();
    }
  })();
}
