export default function Home() {
  return (
    <main style={{ background: "#0C0C0F", minHeight: "100vh", color: "#F0EEFF", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", WebkitFontSmoothing: "antialiased" }}>
      {/* Nav */}
      <nav style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 40px", height: "60px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#0C0C0F", zIndex: 10 }}>
        <span style={{ fontSize: "15px", fontWeight: 700, color: "#F0EEFF", letterSpacing: "-0.01em" }}>
          give-to-get.com
        </span>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <a href="/login" style={{ fontSize: "13px", fontWeight: 600, color: "#8B87A8", textDecoration: "none", padding: "7px 14px" }}>
            Log in
          </a>
          <a href="/signup" style={{ fontSize: "13px", fontWeight: 600, color: "#fff", textDecoration: "none", background: "#8B5CF6", padding: "7px 16px", borderRadius: "7px" }}>
            Get started free
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: "760px", margin: "0 auto", padding: "100px 40px 80px", textAlign: "center" }}>
        <div style={{ display: "inline-block", fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8B5CF6", background: "rgba(139,92,246,0.12)", padding: "5px 12px", borderRadius: "100px", marginBottom: "28px" }}>
          B2B Contact Database Exchange
        </div>
        <h1 style={{ fontSize: "52px", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.03em", margin: "0 0 24px", color: "#F0EEFF" }}>
          Give contacts.{" "}
          <span style={{ color: "#8B5CF6" }}>Get contacts.</span>
        </h1>
        <p style={{ fontSize: "18px", fontWeight: 400, color: "#8B87A8", lineHeight: 1.6, margin: "0 0 40px", maxWidth: "560px", marginLeft: "auto", marginRight: "auto" }}>
          Upload your B2B contact list, earn credits for every unique contact you contribute, and spend credits to download verified contacts filtered by vertical, seniority, and company size.
        </p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/signup" style={{ fontSize: "14px", fontWeight: 600, color: "#fff", textDecoration: "none", background: "#8B5CF6", padding: "12px 28px", borderRadius: "7px", display: "inline-block" }}>
            Start for free — 100 credits on signup
          </a>
          <a href="#how-it-works" style={{ fontSize: "14px", fontWeight: 600, color: "#F0EEFF", textDecoration: "none", background: "transparent", border: "1px solid rgba(255,255,255,0.07)", padding: "12px 28px", borderRadius: "7px", display: "inline-block" }}>
            How it works
          </a>
        </div>
      </section>

      {/* Social proof strip */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "20px 40px", display: "flex", justifyContent: "center", gap: "60px", flexWrap: "wrap" }}>
        {[
          { value: "1 credit", label: "per unique contact uploaded" },
          { value: "1 credit", label: "per contact downloaded" },
          { value: "100 free", label: "credits on signup" },
        ].map((stat) => (
          <div key={stat.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#C4B5FD", marginBottom: "4px" }}>{stat.value}</div>
            <div style={{ fontSize: "12px", color: "#8B87A8" }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <section id="how-it-works" style={{ maxWidth: "900px", margin: "0 auto", padding: "80px 40px" }}>
        <div style={{ textAlign: "center", marginBottom: "56px" }}>
          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4E4A66", marginBottom: "12px" }}>How it works</p>
          <h2 style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>The contact exchange loop</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {[
            {
              step: "01",
              title: "Upload your list",
              body: "Drag and drop a CSV of B2B contacts you already own — past leads, event lists, CRM exports. Required: name + work email.",
            },
            {
              step: "02",
              title: "Earn credits",
              body: "We validate, deduplicate, and add unique contacts to the shared pool. You earn 1 credit for every net-new contact contributed.",
            },
            {
              step: "03",
              title: "Download contacts",
              body: "Browse the global database. Filter by vertical, seniority, location, or company size. Spend 1 credit per contact you export.",
            },
          ].map((item) => (
            <div key={item.step} style={{ background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "28px 24px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8B5CF6", marginBottom: "14px" }}>{item.step}</div>
              <h3 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 10px", color: "#F0EEFF" }}>{item.title}</h3>
              <p style={{ fontSize: "13px", color: "#8B87A8", lineHeight: 1.65, margin: 0 }}>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why give-to-get */}
      <section style={{ maxWidth: "900px", margin: "0 auto", padding: "0 40px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: "56px" }}>
          <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4E4A66", marginBottom: "12px" }}>Why give-to-get</p>
          <h2 style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Stop paying for stale data</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
          {[
            {
              title: "Turn idle lists into credits",
              body: "Every team has orphaned contact lists rotting in spreadsheets. Contribute them and unlock fresh data in return.",
            },
            {
              title: "Community-sourced freshness",
              body: "Contacts come from real sales teams who worked these accounts — not scraped bots. The more teams contribute, the richer the pool.",
            },
            {
              title: "Vertical-specific filters",
              body: "Filter by SaaS, FinTech, MarTech, Data & AI, HRTech, HealthTech — and by seniority, company size, and location.",
            },
            {
              title: "Credits never expire",
              body: "Earn now, spend whenever. Your credit balance is an append-only ledger — there are no monthly resets or expirations.",
            },
          ].map((item) => (
            <div key={item.title} style={{ background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "24px" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 8px", color: "#F0EEFF" }}>{item.title}</h3>
              <p style={{ fontSize: "13px", color: "#8B87A8", lineHeight: 1.65, margin: 0 }}>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ maxWidth: "640px", margin: "0 auto", padding: "0 40px 100px", textAlign: "center" }}>
        <div style={{ background: "#18181D", border: "1px solid rgba(139,92,246,0.35)", borderRadius: "14px", padding: "56px 40px" }}>
          <h2 style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 16px" }}>Ready to start?</h2>
          <p style={{ fontSize: "14px", color: "#8B87A8", lineHeight: 1.6, margin: "0 0 32px" }}>
            Create a free account and get 100 credits instantly. Start uploading your contact list in minutes.
          </p>
          <a href="/signup" style={{ fontSize: "14px", fontWeight: 600, color: "#fff", textDecoration: "none", background: "#8B5CF6", padding: "13px 32px", borderRadius: "7px", display: "inline-block" }}>
            Create free account
          </a>
          <p style={{ fontSize: "11px", color: "#4E4A66", marginTop: "16px", marginBottom: 0 }}>
            No credit card required
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "28px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#F0EEFF" }}>give-to-get.com</span>
        <span style={{ fontSize: "12px", color: "#4E4A66" }}>A. Wykoff Consulting &mdash; Give contacts. Get contacts.</span>
      </footer>
    </main>
  );
}
