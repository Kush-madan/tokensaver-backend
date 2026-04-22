/**
 * TokenSaver — Compressor Utility
 *
 * Client-side compression helpers. The actual AI-powered compression
 * happens on the backend; this module handles the communication
 * and provides a local fallback compressor for offline use.
 */

/**
 * Sends a prompt to the backend for AI-powered compression.
 * @param {string} prompt - The raw user prompt
 * @returns {Promise<{compressed: string, originalTokens: number, compressedTokens: number}>}
 */
async function compressPrompt(prompt) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "COMPRESS",
      prompt: prompt,
    });

    if (response && response.compressed) {
      return {
        compressed: response.compressed,
        originalTokens: response.originalTokens || Math.ceil(prompt.length / 4),
        compressedTokens: response.compressedTokens || Math.ceil(response.compressed.length / 4),
        wasCompressed: response.success !== false,
      };
    }

    // Fallback if response is malformed
    return localCompress(prompt);
  } catch (error) {
    console.error("[TokenSaver] Compression request failed:", error);
    return localCompress(prompt);
  }
}

/**
 * Local fallback compressor. Removes obvious filler words and
 * redundancies without AI assistance. Used when the backend is unavailable.
 * @param {string} prompt - The raw user prompt
 * @returns {{compressed: string, originalTokens: number, compressedTokens: number, wasCompressed: boolean}}
 */
function localCompress(prompt) {
  const originalTokens = Math.ceil(prompt.length / 4);

  // Filler phrases to remove
  const fillers = [
    /\b(hey|hi|hello)\s*(so|there|,)?\s*/gi,
    /\bI was (just )?(wondering|thinking)\s*(if|about|whether)\b/gi,
    /\bcould you (possibly|maybe|perhaps)\b/gi,
    /\bwould you (be able to|mind)\b/gi,
    /\bif you (could|would|don't mind)\b/gi,
    /\bI would really appreciate (it )?(if )?\b/gi,
    /\bplease and thank you\b/gi,
    /\bthanks in advance\b/gi,
    /\bI think (that )?\b/gi,
    /\bbasically,?\s*/gi,
    /\bactually,?\s*/gi,
    /\bessentially,?\s*/gi,
    /\bjust\s+/gi,
    /\breally\s+/gi,
    /\bvery\s+/gi,
    /\bkind of\s+/gi,
    /\bsort of\s+/gi,
    /\ba little bit\s*/gi,
    /\bif that makes sense\b/gi,
    /\bif you know what I mean\b/gi,
    /\bto be honest\b/gi,
    /\bin my opinion\b/gi,
  ];

  let compressed = prompt;
  for (const filler of fillers) {
    compressed = compressed.replace(filler, " ");
  }

  // Clean up extra whitespace
  compressed = compressed.replace(/\s{2,}/g, " ").trim();

  // Capitalize first letter
  if (compressed.length > 0) {
    compressed = compressed.charAt(0).toUpperCase() + compressed.slice(1);
  }

  const compressedTokens = Math.ceil(compressed.length / 4);

  return {
    compressed,
    originalTokens,
    compressedTokens,
    wasCompressed: compressed.length < prompt.length,
  };
}

// Make available globally
if (typeof window !== "undefined") {
  window.TokenSaverCompressor = {
    compressPrompt,
    localCompress,
  };
}
