/**
 * TokenSaver Backend — Test Script
 *
 * Tests all 3 API endpoints against the deployed Vercel backend.
 * Run with: node test.js
 */

const BASE_URL = "https://tokensaver-backend.vercel.app";

let passed = 0;
let failed = 0;

/**
 * Runs a single test against an endpoint.
 * @param {string} name - Test label
 * @param {string} endpoint - API path (e.g. "/api/compress")
 * @param {object} body - Request payload
 * @param {function} validate - Validation function that returns true/false
 */
async function runTest(name, endpoint, body, validate) {
  const divider = "=".repeat(60);
  console.log(`\n${divider}`);
  console.log(`TEST: ${name}`);
  console.log(`POST ${BASE_URL}${endpoint}`);
  console.log(`${divider}`);

  try {
    const start = Date.now();
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const elapsed = Date.now() - start;

    const data = await res.json();

    console.log(`Status: ${res.status}`);
    console.log(`Time:   ${elapsed}ms`);
    console.log(`Response:`);
    console.log(JSON.stringify(data, null, 2));

    if (res.status === 200 && validate(data)) {
      console.log(`\n✅ PASS`);
      passed++;
    } else {
      console.log(`\n❌ FAIL — unexpected response shape or status`);
      failed++;
    }
  } catch (error) {
    console.log(`\n❌ FAIL — ${error.message}`);
    failed++;
  }
}

async function main() {
  console.log("🚀 TokenSaver Backend Test Suite");
  console.log(`   Target: ${BASE_URL}\n`);

  // ── Test 1: Compress ──────────────────────────────────────────
  await runTest(
    "/api/compress",
    "/api/compress",
    {
      prompt:
        "Hey can you please help me write a business plan for my new restaurant idea, I would really appreciate it very much thank you",
    },
    (data) => {
      return (
        typeof data.compressed === "string" &&
        typeof data.originalTokens === "number" &&
        typeof data.compressedTokens === "number"
      );
    }
  );

  // ── Test 2: Summarize ─────────────────────────────────────────
  await runTest(
    "/api/summarize",
    "/api/summarize",
    {
      messages: [
        { role: "user", content: "I want to build a chrome extension" },
        { role: "assistant", content: "Great idea! Let me help you with that." },
      ],
    },
    (data) => {
      return typeof data.summary === "string" && data.summary.length > 0;
    }
  );

  // ── Test 3: Split ─────────────────────────────────────────────
  await runTest(
    "/api/split",
    "/api/split",
    {
      prompt:
        "Write a complete business plan for a restaurant. Include executive summary, market analysis, menu planning, staffing plan, financial projections, and marketing strategy.",
    },
    (data) => {
      return Array.isArray(data.parts) && data.parts.length >= 1;
    }
  );

  // ── Summary ───────────────────────────────────────────────────
  const divider = "=".repeat(60);
  console.log(`\n${divider}`);
  console.log(`📊 RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(divider);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
