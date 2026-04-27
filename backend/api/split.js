/**
 * TokenSaver Backend — POST /api/split
 *
 * Receives a large user prompt and uses Google Gemini to intelligently
 * split it into 2–4 logical parts that can be sent sequentially.
 *
 * Environment Variables:
 *   GEMINI_API_KEY  — Your Google Gemini API key
 *   ALLOWED_ORIGIN  — chrome-extension://YOUR_EXTENSION_ID
 */

const { GoogleGenAI } = require("@google/genai");
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

/** System prompt for the task splitter */
const SYSTEM_PROMPT = `You are a task splitter. The user has a large request that needs to be broken into smaller logical parts for an AI to handle one at a time. Split it into 2-4 parts where each part can stand alone but references the previous parts. Number each part clearly. Return a JSON array of strings, each string being one part of the task. Return ONLY the JSON array, no other text.`;

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
 * Attempts to parse a JSON array from the AI response.
 * Handles cases where the AI wraps the output in markdown or adds extra text.
 * @param {string} text - The raw AI response
 * @returns {string[]|null} Parsed array or null
 */
function parseJsonArray(text) {
  // Try direct parse first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // continue to next strategy
  }

  // Try extracting JSON array from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // continue
    }
  }

  // Try finding array pattern in the text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // continue
    }
  }

  return null;
}

/**
 * Vercel serverless function handler.
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
module.exports = async function handler(req, res) {
  setCorsHeaders(res);

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

  // Don't split short prompts
  const wordCount = prompt.trim().split(/\s+/).length;
  if (wordCount < 100) {
    return res.status(200).json({ parts: [prompt] });
  }

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `${SYSTEM_PROMPT}\n\nSplit this large task into 2-4 logical parts:\n\n${prompt}`,
    });
    const rawResponse = (response.text || "").trim() || "";
    const parts = parseJsonArray(rawResponse);

    if (parts && parts.length >= 2 && parts.length <= 4) {
      console.log(
        `[TokenSaver /api/split] Split into ${parts.length} parts`
      );
      return res.status(200).json({ parts });
    }

    // If parsing failed, try to split manually
    console.warn(
      "[TokenSaver /api/split] AI response was not a valid JSON array, falling back"
    );

    // Fallback: split by paragraphs
    const paragraphs = prompt
      .split(/\n\n+/)
      .filter((p) => p.trim().length > 50);

    if (paragraphs.length >= 2) {
      // Group paragraphs into 2-4 chunks
      const chunkSize = Math.ceil(paragraphs.length / 3);
      const chunks = [];
      for (let i = 0; i < paragraphs.length; i += chunkSize) {
        chunks.push(paragraphs.slice(i, i + chunkSize).join("\n\n"));
      }
      return res.status(200).json({ parts: chunks.slice(0, 4) });
    }

    // Cannot split meaningfully
    return res.status(200).json({ parts: [prompt] });
  } catch (error) {
    console.error("[TokenSaver /api/split] Error:", error.message);

    return res.status(200).json({
      parts: [prompt],
      error: "Splitting failed, returning original as single part",
      details: error.message,
    });
  }
};
