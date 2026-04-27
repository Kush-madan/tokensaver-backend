import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="container" style={{ paddingTop: 40 }}>
        <div className="card">
          <h1>Dashboard</h1>
          <p className="muted">Please sign in from the extension or website first.</p>
          <Link href="/" className="btn btn-primary">
            Back to Home
          </Link>
        </div>
      </main>
    );
  }

  const [{ data: profile }, { count }, { data: usageRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single(),
    supabase
      .from("usage_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("usage_date", todayDate()),
    supabase.from("usage_logs").select("tokens_saved").eq("user_id", user.id)
  ]);

  const plan = profile?.plan || "free";
  const usedToday = count || 0;
  const dailyLimit = 20;
  const totalTokensSaved = (usageRows || []).reduce((acc, row) => acc + (row.tokens_saved || 0), 0);

  return (
    <main className="container" style={{ paddingTop: 30, paddingBottom: 40 }}>
      <h1>Dashboard</h1>
      <p className="muted">Signed in as {user.email}</p>

      <div className="grid grid-3" style={{ marginTop: 12 }}>
        <div className="card">
          <p className="muted">Usage today</p>
          <p className="kpi">
            {usedToday} / {dailyLimit}
          </p>
        </div>
        <div className="card">
          <p className="muted">Total tokens saved</p>
          <p className="kpi">{totalTokensSaved.toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="muted">Current plan</p>
          <p className="kpi" style={{ textTransform: "capitalize" }}>
            {plan}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Extension Access</h3>
        <p className="muted">Use the extension in anonymous mode or sign in to sync usage across devices.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn btn-primary" href="https://chrome.google.com/webstore" target="_blank">
            Download Extension
          </a>
          <Link className="btn btn-secondary" href="/">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
