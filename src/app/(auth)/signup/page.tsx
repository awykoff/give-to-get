"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSignup = async () => {
    setError("");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  };

  const handleGoogle = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
  };

  if (sent) {
    return (
      <main style={{ background: "#0C0C0F", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", padding: "24px" }}>
        <a href="/" style={{ fontSize: "15px", fontWeight: 700, color: "#F0EEFF", textDecoration: "none", marginBottom: "40px" }}>
          give-to-get.com
        </a>
        <div style={{ width: "100%", maxWidth: "400px", background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "40px 36px", textAlign: "center" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "rgba(52,211,153,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#F0EEFF", margin: "0 0 10px" }}>Check your email</h2>
          <p style={{ fontSize: "13px", color: "#8B87A8", lineHeight: 1.6, margin: "0 0 24px" }}>
            We sent a confirmation link to <strong style={{ color: "#F0EEFF" }}>{email}</strong>. Click it to activate your account and claim your 100 free credits.
          </p>
          <a href="/login" style={{ fontSize: "13px", color: "#C4B5FD", textDecoration: "none", fontWeight: 600 }}>
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main style={{ background: "#0C0C0F", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif", padding: "24px" }}>
      {/* Logo */}
      <a href="/" style={{ fontSize: "15px", fontWeight: 700, color: "#F0EEFF", textDecoration: "none", marginBottom: "40px" }}>
        give-to-get.com
      </a>

      <div style={{ width: "100%", maxWidth: "400px", background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "40px 36px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#F0EEFF", margin: "0 0 4px" }}>Create your account</h1>
        <p style={{ fontSize: "13px", color: "#8B87A8", margin: "0 0 28px" }}>
          Start with 100 free credits — no card required
        </p>

        {/* Google */}
        <button
          onClick={handleGoogle}
          style={{ width: "100%", background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "7px", padding: "10px 16px", color: "#F0EEFF", fontSize: "13px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "20px" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
          <span style={{ fontSize: "11px", color: "#4E4A66" }}>or</span>
          <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.07)" }} />
        </div>

        {/* Email */}
        <div style={{ marginBottom: "12px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#8B87A8", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Work email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            style={{ width: "100%", background: "#0C0C0F", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "7px", padding: "9px 12px", color: "#F0EEFF", fontSize: "13px", fontFamily: "inherit", boxSizing: "border-box" }}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#8B87A8", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSignup()}
            placeholder="Min. 8 characters"
            style={{ width: "100%", background: "#0C0C0F", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "7px", padding: "9px 12px", color: "#F0EEFF", fontSize: "13px", fontFamily: "inherit", boxSizing: "border-box" }}
          />
        </div>

        {/* Error */}
        {error && (
          <div data-testid="error-banner" style={{ background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "7px", padding: "10px 12px", color: "#F87171", fontSize: "12px", marginBottom: "16px" }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSignup}
          disabled={loading}
          style={{ width: "100%", background: "#8B5CF6", border: "none", borderRadius: "7px", padding: "10px 16px", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, fontFamily: "inherit" }}
        >
          {loading ? "Creating account…" : "Create free account"}
        </button>

        <p style={{ fontSize: "12px", color: "#4E4A66", textAlign: "center", margin: "20px 0 0" }}>
          Already have an account?{" "}
          <a href="/login" style={{ color: "#C4B5FD", textDecoration: "none", fontWeight: 600 }}>Sign in</a>
        </p>
      </div>
    </main>
  );
}
