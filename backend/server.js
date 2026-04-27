require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const express = require("express");
const cors = require("cors");

const compressHandler = require("./api/compress");
const summarizeHandler = require("./api/summarize");
const splitHandler = require("./api/split");

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));

app.options("/api/compress", (req, res) => compressHandler(req, res));
app.options("/api/summarize", (req, res) => summarizeHandler(req, res));
app.options("/api/split", (req, res) => splitHandler(req, res));

app.post("/api/compress", (req, res) => compressHandler(req, res));
app.post("/api/summarize", (req, res) => summarizeHandler(req, res));
app.post("/api/split", (req, res) => splitHandler(req, res));

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: "tokensaver-backend" });
});

app.listen(PORT, () => {
  console.log("API Key loaded:", process.env.GEMINI_API_KEY ? "YES" : "NO - MISSING!");
  console.log(`TokenSaver backend running on http://localhost:${PORT}`);
  console.log("POST /api/compress");
  console.log("POST /api/summarize");
  console.log("POST /api/split");
});
