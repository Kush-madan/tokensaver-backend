import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const FREE_DAILY_LIMIT = 20;
const MODEL_NAME = "gemini-1.5-flash";

const supabaseAnon = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

async function getUserFromBearer(authHeader?: string | null) {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }

  return data.user;
}

async function getProfilePlanAndStatus(userId: string): Promise<{ plan: "free"; blocked: boolean }> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("plan,is_blocked")
    .eq("id", userId)
    .single();

  if (!profile) {
    return { plan: "free", blocked: false };
  }

  return {
    plan: "free",
    blocked: Boolean(profile.is_blocked)
  };
}

async function getTodayUsageCount(userId: string): Promise<number> {
  const date = todayDate();
  const { count } = await supabaseAdmin
    .from("usage_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("usage_date", date);

  return count || 0;
}

async function insertUsageLog(userId: string, promptLength: number, compressedLength: number) {
  const savedTokens = Math.max(0, promptLength - compressedLength);
  await supabaseAdmin.from("usage_logs").insert({
    user_id: userId,
    usage_date: todayDate(),
    prompt_length: promptLength,
    compressed_length: compressedLength,
    tokens_saved: savedTokens,
    source: "extension"
  });
}

async function compressWithGemini(prompt: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "Compress this text while preserving all key meaning, constraints, and requested output format. " +
              "Do not add new facts. Return only the compressed text.\n\n" +
              prompt
          }
        ]
      }
    ]
  });

  const compressed = result.response.text().trim();
  if (!compressed) {
    throw new Error("Gemini returned empty compression output");
  }

  return compressed;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const user = await getUserFromBearer(request.headers.get("authorization"));

    // Anonymous users are enforced client-side with chrome.storage.local.
    if (!user) {
      const compressed = await compressWithGemini(prompt);
      return NextResponse.json({
        original: prompt,
        compressed,
        plan: "free",
        usage: null
      });
    }

    const profile = await getProfilePlanAndStatus(user.id);
    if (profile.blocked) {
      return NextResponse.json({ error: "Account blocked" }, { status: 403 });
    }

    const usedToday = await getTodayUsageCount(user.id);
    const dailyLimit = FREE_DAILY_LIMIT;

    if (usedToday >= dailyLimit) {
      return NextResponse.json(
        {
          error: "Daily compression limit reached",
          code: "LIMIT_REACHED",
          usage: { used: usedToday, limit: dailyLimit, remaining: 0 }
        },
        { status: 429 }
      );
    }

    const compressed = await compressWithGemini(prompt);
    await insertUsageLog(user.id, prompt.length, compressed.length);

    const used = usedToday + 1;
    return NextResponse.json({
      original: prompt,
      compressed,
      plan: profile.plan,
      usage: {
        used,
        limit: dailyLimit,
        remaining: Math.max(0, dailyLimit - used)
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      { status: 500 }
    );
  }
}
