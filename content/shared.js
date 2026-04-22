/**
 * TokenSaver — Shared Content Script Utilities
 *
 * Common functions used by both claude.js and chatgpt.js content scripts.
 * Handles cut-off detection, DOM manipulation helpers, messaging,
 * and UI injection utilities.
 */

/* ───────────── Logging ───────────── */

/**
 * Logs a message with the [TokenSaver] prefix.
 * @param {string} message - The log message
 * @param {*} [data] - Optional data to include
 */
function tsLog(message, data) {
  if (data !== undefined) {
    console.log(`[TokenSaver] ${message}`, data);
  } else {
    console.log(`[TokenSaver] ${message}`);
  }
}

/**
 * Logs a warning with the [TokenSaver] prefix.
 * @param {string} message - The warning message
 * @param {*} [data] - Optional data to include
 */
function tsWarn(message, data) {
  if (data !== undefined) {
    console.warn(`[TokenSaver] ${message}`, data);
  } else {
    console.warn(`[TokenSaver] ${message}`);
  }
}

/**
 * Logs an error with the [TokenSaver] prefix.
 * @param {string} message - The error message
 * @param {*} [data] - Optional data to include
 */
function tsError(message, data) {
  if (data !== undefined) {
    console.error(`[TokenSaver] ${message}`, data);
  } else {
    console.error(`[TokenSaver] ${message}`);
  }
}

/* ───────────── Communication ───────────── */

/**
 * Sends a message to the background service worker and returns the response.
 * @param {string} type - The message type
 * @param {Object} data - The message data
 * @returns {Promise<Object>} The response from the background script
 */
async function sendToBackground(type, data = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ type, ...data });
    return response;
  } catch (error) {
    tsError(`Failed to send message '${type}' to background:`, error);
    throw error;
  }
}

/* ───────────── DOM Helpers ───────────── */

/**
 * Waits for an element matching the selector to appear in the DOM.
 * Uses MutationObserver for efficient watching.
 * @param {string} selector - CSS selector to wait for
 * @param {number} [timeout=10000] - Maximum time to wait in ms
 * @param {Element} [parent=document] - Parent element to observe
 * @returns {Promise<Element>} The found element
 */
function waitForElement(selector, timeout = 10000, parent = document) {
  return new Promise((resolve, reject) => {
    // Check if element already exists
    const existing = parent.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver((mutations, obs) => {
      const el = parent.querySelector(selector);
      if (el) {
        obs.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`[TokenSaver] Timeout waiting for element: ${selector}`));
    }, timeout);

    observer.observe(parent, { childList: true, subtree: true });
  });
}

/**
 * Creates and returns a DOM element with specified attributes and content.
 * @param {string} tag - HTML tag name
 * @param {Object} [attrs={}] - Key-value attribute pairs
 * @param {string} [innerHTML=""] - Inner HTML content
 * @returns {HTMLElement} The created element
 */
function createElement(tag, attrs = {}, innerHTML = "") {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") {
      el.className = value;
    } else if (key === "style" && typeof value === "object") {
      Object.assign(el.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  }
  if (innerHTML) el.innerHTML = innerHTML;
  return el;
}

/* ───────────── Cut-off Detection ───────────── */

/**
 * Determines if an AI response appears to be cut off / truncated.
 * Uses multiple heuristics to detect incomplete responses.
 * @param {string} text - The AI response text
 * @returns {boolean} Whether the response appears cut off
 */
function isResponseCutOff(text) {
  if (!text || typeof text !== "string") return false;

  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  // Heuristic 1: Ends with "..."
  if (trimmed.endsWith("...") || trimmed.endsWith("…")) {
    return true;
  }

  // Heuristic 2: Ends mid-sentence (no terminal punctuation)
  const lastChar = trimmed.charAt(trimmed.length - 1);
  const terminalPunctuation = [".", "!", "?", '"', "'", ")", "]", "}", ":", ";", "`"];
  const endsWithTerminal = terminalPunctuation.includes(lastChar);

  // Heuristic 3: Check if the last line is a code block that's not closed
  const codeBlockStarts = (trimmed.match(/```/g) || []).length;
  if (codeBlockStarts % 2 !== 0) {
    return true; // Odd number of ``` means an unclosed code block
  }

  // Heuristic 4: Response is very short (under 100 words) and doesn't have natural conclusion
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 100 && !endsWithTerminal) {
    return true;
  }

  // Heuristic 5: Ends without terminal punctuation
  if (!endsWithTerminal) {
    return true;
  }

  // Heuristic 6: Last sentence starts with a conjunction or transition word
  const sentences = trimmed.split(/[.!?]+/).filter(Boolean);
  if (sentences.length > 0) {
    const lastSentence = sentences[sentences.length - 1].trim().toLowerCase();
    const cutoffIndicators = [
      "however",
      "additionally",
      "furthermore",
      "moreover",
      "also",
      "next",
      "then",
      "finally",
      "in addition",
      "for example",
    ];
    for (const indicator of cutoffIndicators) {
      if (lastSentence.startsWith(indicator)) {
        return true;
      }
    }
  }

  return false;
}

/* ───────────── Settings ───────────── */

/**
 * Retrieves the current feature settings from chrome.storage.local.
 * @returns {Promise<Object>} Settings object with boolean feature flags
 */
async function getSettings() {
  try {
    const result = await chrome.storage.local.get("settings");
    return result.settings || {
      compressor: true,
      continueButton: true,
      memoryTrimmer: true,
      taskSplitter: true,
    };
  } catch (error) {
    tsError("Failed to get settings:", error);
    return {
      compressor: true,
      continueButton: true,
      memoryTrimmer: true,
      taskSplitter: true,
    };
  }
}

/**
 * Listens for settings changes and calls the callback with updated settings.
 * @param {function(Object): void} callback - Called with updated settings
 */
function onSettingsChange(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      const newSettings = changes.settings.newValue;
      tsLog("Settings changed:", newSettings);
      callback(newSettings);
    }
  });
}

/* ───────────── Platform Detection ───────────── */

/**
 * Detects which AI platform the user is on.
 * @returns {string} "claude" | "chatgpt" | "unknown"
 */
function detectPlatform() {
  const url = window.location.hostname;
  if (url.includes("claude.ai")) return "claude";
  if (url.includes("chatgpt.com")) return "chatgpt";
  return "unknown";
}

/* ───────────── Tab ID ───────────── */

/** @type {string|null} Cached tab ID for this content script instance */
let _currentTabId = null;

/**
 * Gets the current tab ID. Caches after first call.
 * @returns {Promise<string>} The tab ID
 */
async function getCurrentTabId() {
  if (_currentTabId) return _currentTabId;
  try {
    const response = await sendToBackground("GET_TAB_INFO");
    _currentTabId = response?.tabId || `tab_${Date.now()}`;
    return _currentTabId;
  } catch {
    _currentTabId = `tab_${Date.now()}`;
    return _currentTabId;
  }
}

/* ───────────── Debounce ───────────── */

/**
 * Creates a debounced version of a function.
 * @param {Function} func - The function to debounce
 * @param {number} wait - The debounce delay in ms
 * @returns {Function} The debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Export to global scope for content scripts
window.TokenSaverShared = {
  tsLog,
  tsWarn,
  tsError,
  sendToBackground,
  waitForElement,
  createElement,
  isResponseCutOff,
  getSettings,
  onSettingsChange,
  detectPlatform,
  getCurrentTabId,
  debounce,
};
