/**
 * TokenSaver Backend — POST /api/summarize
 *
 * Receives an array of conversation messages and returns
 * a dense summary paragraph for context preservation.
 *
 * Environment Variables:
 *   GEMINI_API_KEY  — Your Google Gemini API key
 *   ALLOWED_ORIGIN  — chrome-extension://YOUR_EXTENSION_ID
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

/** System prompt for the summarizer */
const SYSTEM_PROMPT = `You are a conversation summarizer. Given a list of messages from a conversation, write a single dense paragraph that captures: the main topic, key decisions made, important information shared, and where the conversation currently stands. This summary will be used to preserve context. Be factual, dense, no filler. Return ONLY the summary paragraph.`;

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
 * Formats the messages array into a readable string for the AI.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {string}
 */
function formatMessages(messages) {
  return messages
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join("\n\n---\n\n");
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

  const { messages } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "Missing or invalid 'messages' field. Expected a non-empty array.",
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: SYSTEM_PROMPT,
    });

    const formattedConversation = formatMessages(messages);

    const result = await model.generateContent(
      `Please summarize this conversation:\n\n${formattedConversation}`
    );
    const response = result.response;
    const summary = response.text().trim() || "";

    console.log(
      `[TokenSaver /api/summarize] Summarized ${messages.length} messages → ${summary.length} chars`
    );

    return res.status(200).json({ summary });
  } catch (error) {
    console.error("[TokenSaver /api/summarize] Error:", error.message);

    // Fallback: create a basic summary from the messages
    const fallback = messages
      .slice(0, 5)
      .map((m) => `${m.role}: ${m.content.substring(0, 150)}`)
      .join(" | ");

    return res.status(200).json({
      summary: fallback.substring(0, 500),
      error: "AI summarization failed, returning basic summary",
    });
  }
};
