const BASE_URL = "http://localhost:3000";

async function testEndpoint(name, endpoint, payload) {
  console.log(`\n--- Testing ${name} ---`);

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }

    if (!response.ok) {
      console.error(`[FAIL] ${name} (status ${response.status})`);
    } else {
      console.log(`[PASS] ${name}`);
    }

    console.log(
      "Response:",
      typeof parsed === "object" ? JSON.stringify(parsed, null, 2) : parsed
    );
  } catch (error) {
    console.error(`[FAIL] ${name}: ${error.message}`);
  }
}

async function runTests() {
  console.log("Starting TokenSaver backend API tests against http://localhost:3000");

  await testEndpoint("Compress API", "/api/compress", {
    prompt:
      "Hey can you please help me write a detailed business plan for my new restaurant idea, I would really appreciate it very much thank you",
  });

  await testEndpoint("Summarize API", "/api/summarize", {
    messages: [
      { role: "user", content: "I want to build a Chrome extension for saving token usage." },
      { role: "assistant", content: "Great, let's design popup UI, content scripts, and backend APIs." },
      { role: "user", content: "Also ensure we can summarize context and split long prompts." },
    ],
  });

  await testEndpoint("Split API", "/api/split", {
    prompt:
      "Write a complete restaurant business plan with executive summary, competitive market analysis, ideal customer persona, pricing strategy, branding strategy, menu engineering, kitchen workflow, staffing plan, hiring timeline, supplier sourcing strategy, legal compliance checklist, financial projections, break-even analysis, and a 12-month marketing calendar.",
  });

  console.log("\nAll tests finished.");
}

runTests();
