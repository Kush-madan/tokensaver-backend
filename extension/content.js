const MIN_COMPRESS_LENGTH = 200;
const DEBOUNCE_MS = 500;

let activeTarget = null;
let debounceTimer = null;
let isProgrammaticUpdate = false;
let pendingConsumptionForCurrentDraft = false;
let latestCompressionSignature = null;
let usageCache = {
  used: 0,
  limit: 20,
  remaining: 20,
  isExhausted: false,
  tier: "free"
};
let authSession = null;

const statusEl = createStatusIndicator();
const healthEl = createHealthIndicator();

init();

async function init() {
  document.documentElement.appendChild(statusEl);
  document.documentElement.appendChild(healthEl);

  await refreshAuth();
  await refreshUsage();
  bindGlobalListeners();
  watchDomChanges();
}

function bindGlobalListeners() {
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("keydown", onKeyDown, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) {
      return;
    }

    if (message.type === "USAGE_UPDATED") {
      usageCache = message.payload;
      renderHealthIndicator();
    }

    if (message.type === "AUTH_UPDATED") {
      authSession = message.payload;
    }
  });
}

function watchDomChanges() {
  const observer = new MutationObserver(() => {
    if (!activeTarget || !document.contains(activeTarget)) {
      activeTarget = findInputTarget();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

function onFocusIn(event) {
  const target = event.target;
  if (isSupportedInputTarget(target)) {
    activeTarget = target;
  }
}

function onInput(event) {
  if (isProgrammaticUpdate) {
    return;
  }

  const target = event.target;
  if (!isSupportedInputTarget(target)) {
    return;
  }

  activeTarget = target;
  pendingConsumptionForCurrentDraft = false;
  latestCompressionSignature = null;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    await maybeCompress(target);
  }, DEBOUNCE_MS);
}

async function onKeyDown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }

  const target = event.target;
  if (!isSupportedInputTarget(target)) {
    return;
  }

  if (!pendingConsumptionForCurrentDraft) {
    return;
  }

  const response = await sendRuntimeMessage({ type: "CONSUME_COMPRESSION" });
  if (response && response.ok && response.usage) {
    usageCache = response.usage;
    renderHealthIndicator();
  }

  pendingConsumptionForCurrentDraft = false;
}

async function maybeCompress(target) {
  if (!target || !document.contains(target)) {
    return;
  }

  if (usageCache.isExhausted) {
    showStatus("Limit reached for today. Sign in to sync usage.", "error");
    return;
  }

  const originalText = getInputText(target).trim();
  if (originalText.length < MIN_COMPRESS_LENGTH) {
    hideStatus();
    return;
  }

  const signature = createSignature(originalText);
  if (signature === latestCompressionSignature) {
    return;
  }

  showStatus("⚡ Compressing...", "loading");

  const response = await sendRuntimeMessage({
    type: "COMPRESS_PROMPT",
    prompt: originalText,
    accessToken: authSession?.access_token || null
  });

  if (!response || !response.ok) {
    const code = response?.code;
    if (code === "LIMIT_REACHED") {
      usageCache = response.usage || usageCache;
      renderHealthIndicator();
      showStatus("Daily limit reached. Try again tomorrow.", "error");
      return;
    }

    showStatus("Compression failed. Backend unavailable.", "error");
    return;
  }

  const compressed = response.result?.compressed;
  if (!compressed || compressed === originalText) {
    hideStatus();
    return;
  }

  isProgrammaticUpdate = true;
  setInputText(target, compressed);
  isProgrammaticUpdate = false;

  latestCompressionSignature = createSignature(compressed);
  pendingConsumptionForCurrentDraft = true;
  usageCache = response.usage || usageCache;
  renderHealthIndicator();

  showStatus("✓ Compressed!", "success");
  setTimeout(hideStatus, 1400);
}

function findInputTarget() {
  const selectors = [
    "textarea",
    "div[contenteditable='true']",
    "div.ProseMirror[contenteditable='true']",
    "div[role='textbox'][contenteditable='true']"
  ];

  for (const selector of selectors) {
    const all = Array.from(document.querySelectorAll(selector));
    const visible = all.find(isVisibleElement);
    if (visible) {
      return visible;
    }
  }

  return null;
}

function isSupportedInputTarget(el) {
  if (!el || !(el instanceof Element)) {
    return false;
  }

  if (el.matches("textarea")) {
    return true;
  }

  if (el.matches("div[contenteditable='true']") || el.matches("div[role='textbox'][contenteditable='true']")) {
    return true;
  }

  return false;
}

function isVisibleElement(el) {
  if (!el) {
    return false;
  }

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getInputText(el) {
  if (el instanceof HTMLTextAreaElement) {
    return el.value || "";
  }

  return el.innerText || el.textContent || "";
}

function setInputText(el, value) {
  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  el.focus();
  try {
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, value);
  } catch (_) {
    el.textContent = value;
  }
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
}

function createSignature(text) {
  return `${text.length}:${text.slice(0, 40)}:${text.slice(-40)}`;
}

function createStatusIndicator() {
  const el = document.createElement("div");
  el.className = "ts-status-indicator";
  el.style.display = "none";
  return el;
}

function showStatus(text, mode) {
  statusEl.textContent = text;
  statusEl.dataset.mode = mode;
  statusEl.style.display = "block";
}

function hideStatus() {
  statusEl.style.display = "none";
}

function createHealthIndicator() {
  const wrap = document.createElement("div");
  wrap.className = "ts-health-indicator";
  wrap.innerHTML = `
    <span class="ts-health-dot" aria-hidden="true"></span>
    <span class="ts-health-text">20 left</span>
  `;
  return wrap;
}

function renderHealthIndicator() {
  const remaining = usageCache.remaining;
  const dot = healthEl.querySelector(".ts-health-dot");
  const text = healthEl.querySelector(".ts-health-text");

  let state = "good";
  if (remaining <= 5 && remaining > 0) {
    state = "warn";
  } else if (remaining <= 0) {
    state = "danger";
  }

  dot.dataset.state = state;
  text.textContent = `${remaining} left today`;

  if (state === "danger") {
    healthEl.classList.add("ts-pulse");
  } else {
    healthEl.classList.remove("ts-pulse");
  }
}

async function refreshUsage() {
  const response = await sendRuntimeMessage({ type: "GET_USAGE" });
  if (response && response.ok && response.usage) {
    usageCache = response.usage;
  }
  renderHealthIndicator();
}

async function refreshAuth() {
  const response = await sendRuntimeMessage({ type: "GET_AUTH_SESSION" });
  if (response?.ok) {
    authSession = response.session || null;
  }
}

async function sendRuntimeMessage(payload) {
  try {
    return await chrome.runtime.sendMessage(payload);
  } catch (_) {
    return null;
  }
}
