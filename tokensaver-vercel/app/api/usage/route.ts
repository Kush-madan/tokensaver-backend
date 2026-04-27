import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

const FREE_DAILY_LIMIT = 20;

const supabaseAnon = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    const { data, error } = await supabaseAnon.auth.getUser(token);

    if (error || !data.user) {
      return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
    }

    const user = data.user;

    const [{ data: profile }, usageCountResult, totalSavedResult] = await Promise.all([
      supabaseAdmin.from("profiles").select("plan").eq("id", user.id).single(),
      supabaseAdmin
        .from("usage_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("usage_date", todayDate()),
      supabaseAdmin
        .from("usage_logs")
        .select("tokens_saved")
        .eq("user_id", user.id)
    ]);

    const plan = "free";
    const used = usageCountResult.count || 0;
    const limit = FREE_DAILY_LIMIT;
    const totalTokensSaved = (totalSavedResult.data || []).reduce(
      (acc, row) => acc + (row.tokens_saved || 0),
      0
    );

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        plan
      },
      usage: {
        used,
        limit,
        remaining: Math.max(0, limit - used),
        totalTokensSaved
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error" },
      { status: 500 }
    );
  }
}
