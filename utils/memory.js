/**
 * TokenSaver — Memory Manager Utility
 *
 * Handles conversation memory: extracting messages from the DOM,
 * estimating token usage, triggering summarization when needed,
 * and prepending context summaries to new messages.
 */

/**
 * Stores a conversation summary for a specific tab.
 * @param {number|string} tabId - The tab ID to store the summary for
 * @param {string} summary - The summary text
 * @returns {Promise<void>}
 */
async function storeSummary(tabId, summary) {
  const key = `summary_tab_${tabId}`;
  try {
    await chrome.storage.local.set({ [key]: summary });
    console.log(`[TokenSaver] Summary stored for tab ${tabId}: ${summary.substring(0, 100)}...`);
  } catch (error) {
    console.error("[TokenSaver] Failed to store summary:", error);
  }
}

/**
 * Retrieves the stored summary for a specific tab.
 * @param {number|string} tabId - The tab ID to get the summary for
 * @returns {Promise<string|null>} The stored summary, or null
 */
async function getSummary(tabId) {
  const key = `summary_tab_${tabId}`;
  try {
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  } catch (error) {
    console.error("[TokenSaver] Failed to get summary:", error);
    return null;
  }
}

/**
 * Clears the stored summary for a specific tab.
 * @param {number|string} tabId - The tab ID to clear the summary for
 * @returns {Promise<void>}
 */
async function clearSummary(tabId) {
  const key = `summary_tab_${tabId}`;
  try {
    await chrome.storage.local.remove(key);
    console.log(`[TokenSaver] Summary cleared for tab ${tabId}`);
  } catch (error) {
    console.error("[TokenSaver] Failed to clear summary:", error);
  }
}

/**
 * Requests summarization of older messages from the backend.
 * Keeps the last N messages intact and summarizes everything else.
 * @param {Array<{role: string, content: string}>} allMessages - All conversation messages
 * @param {number} [keepLast=6] - Number of recent messages to keep intact
 * @returns {Promise<{summary: string, success: boolean}>}
 */
async function triggerSummarization(allMessages, keepLast = 6) {
  if (allMessages.length <= keepLast) {
    console.log("[TokenSaver] Not enough messages to summarize");
    return { summary: "", success: false };
  }

  const messagesToSummarize = allMessages.slice(0, allMessages.length - keepLast);

  console.log(
    `[TokenSaver] Summarizing ${messagesToSummarize.length} older messages, keeping last ${keepLast}`
  );

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SUMMARIZE",
      messages: messagesToSummarize,
    });

    if (response && response.summary) {
      // Update stats
      chrome.runtime.sendMessage({
        type: "UPDATE_STATS",
        stat: "summarization",
        value: 0,
      });

      return { summary: response.summary, success: response.success !== false };
    }

    return { summary: "", success: false };
  } catch (error) {
    console.error("[TokenSaver] Summarization request failed:", error);
    return { summary: "", success: false };
  }
}

/**
 * Checks if the conversation has exceeded the context threshold
 * and needs summarization.
 * @param {number} totalTokens - Current total tokens in conversation
 * @param {string} platform - "claude" or "chatgpt"
 * @param {number} [threshold=0.6] - Percentage threshold (0-1) to trigger summarization
 * @returns {boolean} Whether summarization should be triggered
 */
function shouldSummarize(totalTokens, platform, threshold = 0.6) {
  const tc = window.TokenSaverTokenCounter;
  if (!tc) return false;

  const windowSize = tc.getContextWindowSize(platform);
  const usage = totalTokens / windowSize;

  console.log(
    `[TokenSaver] Context usage: ${Math.round(usage * 100)}% (${totalTokens}/${windowSize} tokens)`
  );

  return usage >= threshold;
}

/**
 * Prepends the stored summary to a user's message as invisible context.
 * @param {string} userMessage - The user's new message
 * @param {string} summary - The stored conversation summary
 * @returns {string} The message with prepended context
 */
function prependSummaryContext(userMessage, summary) {
  if (!summary) return userMessage;
  const contextPrefix = `[Earlier context: ${summary}]\n\n`;
  console.log("[TokenSaver] Prepending summary context to message");
  return contextPrefix + userMessage;
}

// Make available globally
if (typeof window !== "undefined") {
  window.TokenSaverMemory = {
    storeSummary,
    getSummary,
    clearSummary,
    triggerSummarization,
    shouldSummarize,
    prependSummaryContext,
  };
}
