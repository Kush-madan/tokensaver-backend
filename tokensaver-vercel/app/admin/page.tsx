import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function assertAdmin() {
  "use server";
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const allowedAdmin = process.env.NEXT_PUBLIC_ALLOWED_ADMIN_EMAIL;
  if (!user || user.email?.toLowerCase() !== allowedAdmin?.toLowerCase()) {
    throw new Error("Unauthorized");
  }
}

async function setUserPlan(formData: FormData) {
  "use server";
  await assertAdmin();

  const userId = String(formData.get("userId") || "");
  const plan = String(formData.get("plan") || "free");
  if (!userId || plan !== "free") {
    return;
  }

  await supabaseAdmin.from("profiles").update({ plan }).eq("id", userId);
}

async function setUserBlock(formData: FormData) {
  "use server";
  await assertAdmin();

  const userId = String(formData.get("userId") || "");
  const block = String(formData.get("block") || "false") === "true";
  if (!userId) {
    return;
  }

  await supabaseAdmin.from("profiles").update({ is_blocked: block }).eq("id", userId);
}

export default async function AdminPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const allowedAdmin = process.env.NEXT_PUBLIC_ALLOWED_ADMIN_EMAIL;
  if (!user || user.email?.toLowerCase() !== allowedAdmin?.toLowerCase()) {
    redirect("/");
  }

  const [profilesRes, subsRes, usageRes] = await Promise.all([
    supabase.from("profiles").select("id,email,plan,is_blocked,created_at").order("created_at", { ascending: false }),
    supabase.from("usage_logs").select("id", { count: "exact", head: true }),
    supabase.from("usage_logs").select("tokens_saved,created_at")
  ]);

  const profiles = profilesRes.data || [];
  const totalCompressions = subsRes.count || 0;
  const usageRows = usageRes.data || [];

  const totalUsers = profiles.length;
  const blockedUsers = profiles.filter((p) => p.is_blocked).length;
  const totalSaved = usageRows.reduce((sum, row) => sum + (row.tokens_saved || 0), 0);

  return (
    <main className="container" style={{ paddingTop: 28, paddingBottom: 40 }}>
      <h1>Admin Dashboard</h1>
      <p className="muted">Protected admin view for platform metrics and moderation.</p>

      <div className="grid grid-3" style={{ marginTop: 12 }}>
        <div className="card">
          <p className="muted">Total users</p>
          <p className="kpi">{totalUsers}</p>
        </div>
        <div className="card">
          <p className="muted">Blocked users</p>
          <p className="kpi">{blockedUsers}</p>
        </div>
        <div className="card">
          <p className="muted">Total compressions</p>
          <p className="kpi">{totalCompressions}</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Usage snapshot</h3>
        <p className="muted">Total tokens saved across all users: {totalSaved.toLocaleString()}</p>
        <p className="muted">Compression records tracked: {totalCompressions}</p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Users</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Plan</th>
              <th>Blocked</th>
              <th>Action hint</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id}>
                <td>{profile.email || "(no email)"}</td>
                <td style={{ textTransform: "capitalize" }}>{profile.plan}</td>
                <td>{profile.is_blocked ? "Yes" : "No"}</td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <form action={setUserPlan}>
                      <input type="hidden" name="userId" value={profile.id} />
                      <input type="hidden" name="plan" value="free" />
                      <button className="btn btn-secondary" type="submit">
                        Set Free
                      </button>
                    </form>
                    <form action={setUserBlock}>
                      <input type="hidden" name="userId" value={profile.id} />
                      <input type="hidden" name="block" value={profile.is_blocked ? "false" : "true"} />
                      <button className="btn btn-secondary" type="submit">
                        {profile.is_blocked ? "Unblock" : "Block"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
