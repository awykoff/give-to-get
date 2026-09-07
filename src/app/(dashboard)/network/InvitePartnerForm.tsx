"use client";

// src/app/(dashboard)/network/InvitePartnerForm.tsx
//
// Sends a new connection invite. Single email input + send button.
// Resolves the email to a workspace_members row server-side and
// creates a pending workspace_connections row.
//
// Privacy: never touches contacts. The form body only carries the
// recipient's email — the server resolves it to a workspace_id and
// creates the connection. We never collect anything more from the
// user than the partner's email.

import { useState } from "react";

interface Props {
  currentUserEmail: string | null;
  onSuccess: () => void;
}

export default function InvitePartnerForm({
  currentUserEmail,
  onSuccess,
}: Props) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const isSelfEmail =
    !!currentUserEmail &&
    email.trim().toLowerCase() === currentUserEmail.trim().toLowerCase();

  const canSubmit =
    email.trim().length > 0 && !working && !isSelfEmail;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setWorking(true);
    try {
      const res = await fetch("/api/network/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_email: email.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `Failed (${res.status})`);
        return;
      }
      setEmail("");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      style={{
        background: "#18181D",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "10px",
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: "11px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#4E4A66",
        }}
      >
        Invite a partner
      </h3>
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "8px" }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="partner@company.com"
          disabled={working}
          style={{
            background: "#0C0C0F",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "7px",
            padding: "10px 12px",
            color: "#F0EEFF",
            fontSize: "13px",
            fontFamily: "inherit",
            outline: "none",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
          }}
        />
        {error && (
          <span style={{ fontSize: "11px", color: "#F87171" }}>{error}</span>
        )}
        {isSelfEmail && (
          <span style={{ fontSize: "11px", color: "#F87171" }}>
            You can&apos;t invite your own email.
          </span>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            alignSelf: "flex-start",
            background: canSubmit ? "#8B5CF6" : "rgba(139,92,246,0.25)",
            border: "none",
            borderRadius: "7px",
            padding: "8px 18px",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            opacity: canSubmit ? 1 : 0.7,
          }}
        >
          {working ? "Sending…" : "Send invite"}
        </button>
      </form>
    </section>
  );
}