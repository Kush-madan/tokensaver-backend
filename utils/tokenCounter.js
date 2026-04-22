/**
 * TokenSaver — Token Counter Utility
 *
 * Provides token estimation functions used across the extension.
 * Uses the ~4 characters per token approximation.
 */

/**
 * Estimates the number of tokens in a given text.
 * Uses the approximation of ~4 characters per token.
 * @param {string} text - The text to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimates total tokens across an array of messages.
 * @param {Array<{role: string, content: string}>} messages - Array of conversation messages
 * @returns {number} Total estimated token count
 */
function estimateConversationTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, msg) => {
    return total + estimateTokens(msg.content || "");
  }, 0);
}

/**
 * Gets the estimated context window size for a given AI platform.
 * @param {string} platform - "claude" or "chatgpt"
 * @returns {number} Estimated context window in tokens
 */
function getContextWindowSize(platform) {
  const windows = {
    claude: 200000,   // Claude 3+ has 200K context
    chatgpt: 128000,  // GPT-4 Turbo has 128K context
  };
  return windows[platform] || 128000;
}

/**
 * Calculates the percentage of context window used.
 * @param {number} tokensUsed - Current tokens used
 * @param {string} platform - "claude" or "chatgpt"
 * @returns {number} Percentage used (0-100)
 */
function getContextUsagePercent(tokensUsed, platform) {
  const windowSize = getContextWindowSize(platform);
  return Math.min(100, Math.round((tokensUsed / windowSize) * 100));
}

/**
 * Gets the health status based on context usage percentage.
 * @param {number} percent - Usage percentage (0-100)
 * @returns {{ status: string, color: string, label: string, emoji: string }}
 */
function getHealthStatus(percent) {
  if (percent <= 50) {
    return { status: "healthy", color: "#22c55e", label: "Plenty of space", emoji: "🟢" };
  } else if (percent <= 75) {
    return { status: "warning", color: "#eab308", label: "Getting full", emoji: "🟡" };
  } else {
    return { status: "critical", color: "#ef4444", label: "Almost at limit — memory trimmer will activate", emoji: "🔴" };
  }
}

/**
 * Counts words in a text string.
 * @param {string} text - The text to count words in
 * @returns {number} Word count
 */
function countWords(text) {
  if (!text || typeof text !== "string") return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Make available globally in content script context
if (typeof window !== "undefined") {
  window.TokenSaverTokenCounter = {
    estimateTokens,
    estimateConversationTokens,
    getContextWindowSize,
    getContextUsagePercent,
    getHealthStatus,
    countWords,
  };
}
