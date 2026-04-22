/**
 * TokenSaver — Background Service Worker
 * 
 * Handles all API communication with the backend to avoid CORS issues
 * in content scripts. Routes messages from content scripts to the
 * appropriate backend endpoints.
 */

/** @type {string} Backend URL — replace with your deployed Vercel URL */
const BACKEND_URL = "YOUR_VERCEL_URL_HERE";

/**
 * Logs a message with a timestamp and [TokenSaver] prefix.
 * @param {string} level - Log level (info, warn, error)
 * @param {string} message - The log message
 * @param {*} [data] - Optional data to include
 */
function log(level, message, data) {
  const timestamp = new Date().toISOString();
  const prefix = `[TokenSaver ${timestamp}]`;
  if (data !== undefined) {
    console[level](`${prefix} ${message}`, data);
  } else {
    console[level](`${prefix} ${message}`);
  }
}

/**
 * Makes a POST request to the backend API.
 * @param {string} endpoint - The API endpoint path (e.g., "/api/compress")
 * @param {Object} body - The request body
 * @returns {Promise<Object>} The parsed JSON response
 */
async function apiRequest(endpoint, body) {
  const url = `${BACKEND_URL}${endpoint}`;
  log("info", `API Request: ${endpoint}`, body);

  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const elapsed = Math.round(performance.now() - startTime);
    log("info", `API Response: ${endpoint} [${response.status}] in ${elapsed}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    log("info", `API Data: ${endpoint}`, data);
    return data;
  } catch (error) {
    const elapsed = Math.round(performance.now() - startTime);
    log("error", `API Failed: ${endpoint} in ${elapsed}ms — ${error.message}`);
    throw error;
  }
}

/**
 * Handles the COMPRESS message type.
 * Falls back to original prompt if backend is unavailable.
 * @param {string} prompt - The user's original prompt
 * @returns {Promise<Object>} Compression result
 */
async function handleCompress(prompt) {
  try {
    const result = await apiRequest("/api/compress", { prompt });
    return {
      success: true,
      compressed: result.compressed,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
    };
  } catch (error) {
    log("warn", "Compression failed, returning original prompt", error.message);
    return {
      success: false,
      compressed: prompt,
      originalTokens: Math.ceil(prompt.length / 4),
      compressedTokens: Math.ceil(prompt.length / 4),
    };
  }
}

/**
 * Handles the SUMMARIZE message type.
 * Falls back to a simple concatenation summary if backend is unavailable.
 * @param {Array<{role: string, content: string}>} messages - Conversation messages
 * @returns {Promise<Object>} Summarization result
 */
async function handleSummarize(messages) {
  try {
    const result = await apiRequest("/api/summarize", { messages });
    return {
      success: true,
      summary: result.summary,
    };
  } catch (error) {
    log("warn", "Summarization failed, returning fallback", error.message);
    // Fallback: concatenate first 200 chars of each message
    const fallback = messages
      .map((m) => `${m.role}: ${m.content.substring(0, 200)}`)
      .join(" | ");
    return {
      success: false,
      summary: fallback.substring(0, 500),
    };
  }
}

/**
 * Handles the SPLIT message type.
 * Falls back to returning the original prompt as a single part.
 * @param {string} prompt - The large prompt to split
 * @returns {Promise<Object>} Split result with parts array
 */
async function handleSplit(prompt) {
  try {
    const result = await apiRequest("/api/split", { prompt });
    return {
      success: true,
      parts: result.parts,
    };
  } catch (error) {
    log("warn", "Splitting failed, returning original prompt as single part", error.message);
    return {
      success: false,
      parts: [prompt],
    };
  }
}

/**
 * Handles the GET_TAB_INFO message type.
 * Returns info about the currently active tab.
 * @returns {Promise<Object>} Tab information
 */
async function handleGetTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      return { url: "", platform: "unknown" };
    }
    let platform = "unknown";
    if (tab.url && tab.url.includes("claude.ai")) {
      platform = "claude";
    } else if (tab.url && tab.url.includes("chatgpt.com")) {
      platform = "chatgpt";
    }
    return { url: tab.url || "", platform };
  } catch (error) {
    log("error", "Failed to get tab info", error.message);
    return { url: "", platform: "unknown" };
  }
}

/**
 * Main message listener. Routes incoming messages to appropriate handlers.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log("info", `Message received: ${message.type}`, { tabId: sender.tab?.id });

  const handle = async () => {
    switch (message.type) {
      case "COMPRESS":
        return await handleCompress(message.prompt);

      case "SUMMARIZE":
        return await handleSummarize(message.messages);

      case "SPLIT":
        return await handleSplit(message.prompt);

      case "GET_TAB_INFO":
        return await handleGetTabInfo();

      case "UPDATE_STATS":
        return await updateStats(message.stat, message.value);

      case "GET_STATS":
        return await getStats();

      default:
        log("warn", `Unknown message type: ${message.type}`);
        return { error: "Unknown message type" };
    }
  };

  handle()
    .then(sendResponse)
    .catch((err) => {
      log("error", `Handler error for ${message.type}`, err.message);
      sendResponse({ error: err.message });
    });

  // Return true to indicate we will send a response asynchronously
  return true;
});

/**
 * Updates a stat counter in chrome.storage.local.
 * @param {string} stat - The stat key to update
 * @param {number} value - The value to add
 * @returns {Promise<Object>} Updated stats
 */
async function updateStats(stat, value) {
  const today = new Date().toISOString().split("T")[0];
  const storageKey = `stats_${today}`;

  try {
    const result = await chrome.storage.local.get(storageKey);
    const stats = result[storageKey] || {
      compressions: 0,
      tokensSaved: 0,
      continuations: 0,
      summarizations: 0,
      splits: 0,
    };

    switch (stat) {
      case "compression":
        stats.compressions += 1;
        stats.tokensSaved += value || 0;
        break;
      case "continuation":
        stats.continuations += 1;
        break;
      case "summarization":
        stats.summarizations += 1;
        break;
      case "split":
        stats.splits += 1;
        break;
    }

    await chrome.storage.local.set({ [storageKey]: stats });
    log("info", `Stats updated: ${stat}`, stats);
    return { success: true, stats };
  } catch (error) {
    log("error", "Failed to update stats", error.message);
    return { success: false };
  }
}

/**
 * Retrieves today's stats from chrome.storage.local.
 * @returns {Promise<Object>} Today's stats
 */
async function getStats() {
  const today = new Date().toISOString().split("T")[0];
  const storageKey = `stats_${today}`;

  try {
    const result = await chrome.storage.local.get(storageKey);
    return result[storageKey] || {
      compressions: 0,
      tokensSaved: 0,
      continuations: 0,
      summarizations: 0,
      splits: 0,
    };
  } catch (error) {
    log("error", "Failed to get stats", error.message);
    return {
      compressions: 0,
      tokensSaved: 0,
      continuations: 0,
      summarizations: 0,
      splits: 0,
    };
  }
}

/**
 * Extension install/update handler.
 * Sets default settings on first install.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    log("info", "TokenSaver installed — setting defaults");
    await chrome.storage.local.set({
      settings: {
        compressor: true,
        continueButton: true,
        memoryTrimmer: true,
        taskSplitter: true,
      },
    });
  }
  log("info", `TokenSaver ${details.reason}`, { version: chrome.runtime.getManifest().version });
});
