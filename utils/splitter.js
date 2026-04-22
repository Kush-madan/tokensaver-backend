/**
 * TokenSaver — Task Splitter Utility
 *
 * Handles detection of large prompts and communication with the
 * backend to split them into manageable parts.
 */

/** @type {number} Word count threshold for triggering the split suggestion */
const SPLIT_WORD_THRESHOLD = 400;

/**
 * Checks if a prompt is large enough to warrant splitting.
 * @param {string} prompt - The user's prompt text
 * @returns {boolean} Whether the prompt exceeds the split threshold
 */
function shouldSuggestSplit(prompt) {
  if (!prompt || typeof prompt !== "string") return false;
  const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
  return wordCount > SPLIT_WORD_THRESHOLD;
}

/**
 * Sends a large prompt to the backend for intelligent splitting.
 * @param {string} prompt - The large prompt to split
 * @returns {Promise<{parts: string[], success: boolean}>}
 */
async function splitPrompt(prompt) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SPLIT",
      prompt: prompt,
    });

    if (response && response.parts && Array.isArray(response.parts)) {
      // Update stats
      chrome.runtime.sendMessage({
        type: "UPDATE_STATS",
        stat: "split",
        value: 0,
      });

      return {
        parts: response.parts,
        success: response.success !== false,
      };
    }

    return { parts: [prompt], success: false };
  } catch (error) {
    console.error("[TokenSaver] Split request failed:", error);
    return { parts: [prompt], success: false };
  }
}

/**
 * Stores the current split task state in session storage.
 * @param {Object} state - The split task state
 * @param {string[]} state.parts - The split parts
 * @param {number} state.currentPart - Index of the current part being sent
 * @param {boolean} state.active - Whether a split task is in progress
 * @returns {Promise<void>}
 */
async function saveSplitState(state) {
  try {
    await chrome.storage.session.set({ splitState: state });
    console.log("[TokenSaver] Split state saved:", state);
  } catch (error) {
    // Fallback to local storage if session storage fails
    console.warn("[TokenSaver] Session storage unavailable, using local:", error);
    await chrome.storage.local.set({ splitState: state });
  }
}

/**
 * Retrieves the current split task state.
 * @returns {Promise<Object|null>} The split state, or null if none exists
 */
async function getSplitState() {
  try {
    let result = await chrome.storage.session.get("splitState");
    if (!result.splitState) {
      // Fallback to local storage
      result = await chrome.storage.local.get("splitState");
    }
    return result.splitState || null;
  } catch (error) {
    console.error("[TokenSaver] Failed to get split state:", error);
    return null;
  }
}

/**
 * Clears the split task state.
 * @returns {Promise<void>}
 */
async function clearSplitState() {
  try {
    await chrome.storage.session.remove("splitState");
    await chrome.storage.local.remove("splitState");
    console.log("[TokenSaver] Split state cleared");
  } catch (error) {
    console.error("[TokenSaver] Failed to clear split state:", error);
  }
}

// Make available globally
if (typeof window !== "undefined") {
  window.TokenSaverSplitter = {
    SPLIT_WORD_THRESHOLD,
    shouldSuggestSplit,
    splitPrompt,
    saveSplitState,
    getSplitState,
    clearSplitState,
  };
}
