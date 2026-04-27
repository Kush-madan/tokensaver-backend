import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <section className="container" style={{ paddingTop: 56, paddingBottom: 42 }}>
        <h1 style={{ fontSize: 46, marginBottom: 10 }}>Never hit token limits again</h1>
        <p className="muted" style={{ maxWidth: 720, fontSize: 18, lineHeight: 1.5 }}>
          TokenSaver auto-compresses prompts for ChatGPT and Claude using Google Gemini, so you get more output with fewer tokens.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <a className="btn btn-primary" href="https://chrome.google.com/webstore" target="_blank">
            Download Extension
          </a>
          <Link className="btn btn-secondary" href="/dashboard">
            Open Dashboard
          </Link>
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 26 }}>
        <h2>How it works</h2>
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          <div className="card">
            <h3>1. Type naturally</h3>
            <p className="muted">Write long prompts as usual in ChatGPT or Claude.</p>
          </div>
          <div className="card">
            <h3>2. Auto-compression</h3>
            <p className="muted">TokenSaver compresses your prompt while preserving intent and constraints.</p>
          </div>
          <div className="card">
            <h3>3. Get more output</h3>
            <p className="muted">Use saved tokens for better, longer responses.</p>
          </div>
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 48 }}>
        <h2>Current Plan</h2>
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Free Tier</h3>
          <p className="kpi">$0</p>
          <p className="muted">20 compressions/day, synced with Supabase when signed in.</p>
        </div>
      </section>

      <footer className="container" style={{ paddingBottom: 40, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", paddingTop: 18 }}>
          <Link href="/dashboard" className="muted">
            Dashboard
          </Link>
          <Link href="/admin" className="muted">
            Admin
          </Link>
          <a href="mailto:support@tokensaver.app" className="muted">
            Support
          </a>
          <a href="/privacy" className="muted">
            Privacy
          </a>
        </div>
      </footer>
    </main>
  );
}
