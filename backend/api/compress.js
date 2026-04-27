/**
 * TokenSaver Backend — POST /api/compress
 *
 * Receives a user prompt, sends it to Google Gemini for compression,
 * and returns the compressed version with token counts.
 *
 * Environment Variables:
 *   GEMINI_API_KEY  — Your Google Gemini API key
 *   ALLOWED_ORIGIN  — chrome-extension://YOUR_EXTENSION_ID
 */

const { GoogleGenAI } = require("@google/genai");
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

/** System prompt for the compression engine */
const SYSTEM_PROMPT = `You are a prompt compression engine. Your only job is to make the user's message shorter while keeping 100% of the meaning and intent. Remove filler words, pleasantries, redundancy. Never remove technical details, specific requirements, or constraints. Return ONLY the compressed prompt, nothing else. No explanation. No preamble.`;

/**
 * Sets CORS headers on the response.
 * @param {import('@vercel/node').VercelResponse} res
 */
function setCorsHeaders(res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Estimates token count (~4 chars per token).
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Vercel serverless function handler.
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt } = req.body || {};

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'prompt' field" });
  }

  // Skip compression for very short prompts
  if (prompt.trim().length < 30) {
    return res.status(200).json({
      compressed: prompt.trim(),
      originalTokens: estimateTokens(prompt),
      compressedTokens: estimateTokens(prompt),
    });
  }

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `${SYSTEM_PROMPT}\n\nUser prompt:\n${prompt}`,
    });
    const compressed = (response.text || "").trim() || prompt;

    const originalTokens = estimateTokens(prompt);
    const compressedTokens = estimateTokens(compressed);

    console.log(
      `[TokenSaver /api/compress] ${originalTokens} → ${compressedTokens} tokens`
    );

    return res.status(200).json({
      compressed,
      originalTokens,
      compressedTokens,
    });
  } catch (error) {
    console.error("[TokenSaver /api/compress] Error:", error.message);

    // Return original prompt on failure
    return res.status(200).json({
      compressed: prompt,
      originalTokens: estimateTokens(prompt),
      compressedTokens: estimateTokens(prompt),
      error: "Compression failed, returning original",
      details: error.message,
    });
  }
};
