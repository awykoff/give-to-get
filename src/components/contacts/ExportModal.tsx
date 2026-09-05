"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ExportFormat = "csv" | "xlsx" | "json";

interface ExportSuccess {
  export_id: string;
  contact_count: number;
  credits_spent: number;
  format: ExportFormat;
  signed_url: string;
  expires_at: string | null;
  url_expires_in_seconds: number;
}

interface ExportError {
  error: string;
  code?: string;
  details?: string;
  balance?: number;
  required?: number;
}

interface Props {
  selectedIds: string[];
  onClose: () => void;
  onComplete: () => void;
}

// Default field set — must stay in sync with the Edge Function's
// DEFAULT_FIELDS. The server is the source of truth, but the modal
// needs to render the option list so the user can see what they'll get.
const FIELD_OPTIONS: { key: string; label: string; defaultOn: boolean; required?: boolean }[] = [
  { key: "first_name",     label: "First name",     defaultOn: true,  required: true },
  { key: "last_name",      label: "Last name",      defaultOn: true },
  { key: "email",          label: "Email address",  defaultOn: true,  required: true },
  { key: "title",          label: "Job title",      defaultOn: true },
  { key: "seniority",      label: "Seniority",      defaultOn: true },
  { key: "company_name",   label: "Company name",   defaultOn: true },
  { key: "city",           label: "City",           defaultOn: true },
  { key: "state",          label: "State",          defaultOn: true },
  { key: "country",        label: "Country",        defaultOn: true },
  { key: "vertical",       label: "Vertical",       defaultOn: true },
  { key: "linkedin_url",   label: "LinkedIn URL",   defaultOn: true },
  { key: "work_direct_phone", label: "Work direct phone", defaultOn: false },
  { key: "mobile_phone",   label: "Mobile phone",   defaultOn: false },
  { key: "corporate_phone",label: "Corporate phone",defaultOn: false },
  { key: "num_employees",  label: "Company size",   defaultOn: false },
];

const DEFAULT_FIELDS_ON = FIELD_OPTIONS.filter((f) => f.defaultOn).map((f) => f.key);

export default function ExportModal({ selectedIds, onClose, onComplete }: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);

  const [format, setFormat] = useState<ExportFormat>("csv");
  const [fields, setFields] = useState<Set<string>>(new Set(DEFAULT_FIELDS_ON));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<ExportSuccess | null>(null);
  const [copied, setCopied] = useState(false);

  const count = selectedIds.length;
  const cost = count; // 1 credit per contact
  const insufficient = balance !== null && balance < cost;

  // Fetch current credit balance once on mount. RLS lets the user see
  // their workspace's credits_ledger rows; summing gives the balance.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) {
            setBalance(0);
            setBalanceLoading(false);
            setError("You must be signed in.");
          }
          return;
        }

        const { data: member } = await supabase
          .from("workspace_members")
          .select("workspace_id")
          .eq("user_id", user.id)
          .single();
        const workspaceId = member?.workspace_id;
        if (!workspaceId) {
          if (!cancelled) {
            setBalance(0);
            setBalanceLoading(false);
          }
          return;
        }

        const { data } = await supabase
          .from("credits_ledger")
          .select("amount")
          .eq("workspace_id", workspaceId);

        const total = (data ?? []).reduce(
          (sum: number, r: { amount: number | null }) => sum + (r.amount ?? 0),
          0,
        );
        if (!cancelled) {
          setBalance(total);
          setBalanceLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setBalance(0);
          setBalanceLoading(false);
          setError(e instanceof Error ? e.message : "Failed to load balance");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lock body scroll while modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const toggleField = (key: string) => {
    // Required (gating) fields cannot be removed — email is the whole
    // point of an export.
    const opt = FIELD_OPTIONS.find((f) => f.key === key);
    if (opt?.required) return;
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (insufficient) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_ids: selectedIds,
          format,
          fields: Array.from(fields),
        }),
      });

      const body = (await res.json()) as ExportSuccess | ExportError;
      if (!res.ok) {
        const errBody = body as ExportError;
        if (errBody.code === "insufficient_credits" || res.status === 402) {
          setError("You don't have enough credits for this export.");
          if (typeof errBody.balance === "number") setBalance(errBody.balance);
        } else {
          setError(errBody.error ?? "Export failed.");
        }
        setSubmitting(false);
        return;
      }

      setSuccess(body as ExportSuccess);
      setSubmitting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!success?.signed_url) return;
    try {
      await navigator.clipboard.writeText(success.signed_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Older browsers / sandboxed contexts — fall back to selecting the text.
      const input = document.getElementById("export-signed-url") as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      }
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(12,12,15,0.7)",
        backdropFilter: "blur(4px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#18181D",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "12px",
          display: "flex",
          flexDirection: "column",
          fontFamily: "inherit",
        }}
      >
        {success ? (
          <SuccessPanel
            success={success}
            copied={copied}
            onCopy={handleCopyLink}
            onClose={() => {
              onComplete();
            }}
          />
        ) : (
          <ConfigurePanel
            count={count}
            cost={cost}
            balance={balance}
            balanceLoading={balanceLoading}
            insufficient={!!insufficient}
            format={format}
            setFormat={setFormat}
            fields={fields}
            toggleField={toggleField}
            submitting={submitting}
            error={error}
            onClose={onClose}
            onConfirm={handleConfirm}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-panels (kept in the same file to avoid the no-`<form>` rule
// splitting into too many files; both are pure presentational.)
// ─────────────────────────────────────────────────────────────────────

function ConfigurePanel(props: {
  count: number;
  cost: number;
  balance: number | null;
  balanceLoading: boolean;
  insufficient: boolean;
  format: ExportFormat;
  setFormat: (f: ExportFormat) => void;
  fields: Set<string>;
  toggleField: (key: string) => void;
  submitting: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const {
    count, cost, balance, balanceLoading, insufficient,
    format, setFormat, fields, toggleField,
    submitting, error, onClose, onConfirm,
  } = props;

  return (
    <>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66" }}>
            Export
          </div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#F0EEFF", marginTop: "4px" }}>
            {count.toLocaleString()} {count === 1 ? "contact" : "contacts"} selected
          </div>
        </div>
        <button
          onClick={onClose}
          disabled={submitting}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "6px",
            color: "#8B87A8",
            cursor: submitting ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            fontSize: "14px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Cost + balance row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px",
          }}
        >
          <div
            style={{
              background: "#111115",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "8px",
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66" }}>
              Cost
            </div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#C4B5FD", marginTop: "4px" }}>
              {cost.toLocaleString()} <span style={{ fontSize: "13px", color: "#8B87A8", fontWeight: 500 }}>credits</span>
            </div>
            <div style={{ fontSize: "11px", color: "#4E4A66", marginTop: "2px" }}>
              1 credit per contact
            </div>
          </div>
          <div
            style={{
              background: "#111115",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "8px",
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66" }}>
              Balance
            </div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: insufficient ? "#F87171" : "#F0EEFF", marginTop: "4px" }}>
              {balanceLoading ? "—" : (balance ?? 0).toLocaleString()}
            </div>
            <div style={{ fontSize: "11px", color: "#4E4A66", marginTop: "2px" }}>
              after export: {balanceLoading ? "—" : Math.max(0, (balance ?? 0) - cost).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Insufficient credits banner */}
        {insufficient && (
          <div
            style={{
              background: "rgba(248,113,113,0.10)",
              border: "1px solid rgba(248,113,113,0.25)",
              borderRadius: "8px",
              padding: "12px 14px",
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "1px" }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div style={{ fontSize: "12px", color: "#F87171" }}>
              You need {(cost - (balance ?? 0)).toLocaleString()} more credits.{" "}
              <a href="/credits" style={{ color: "#F87171", fontWeight: 600, textDecoration: "underline" }}>
                Earn credits →
              </a>
            </div>
          </div>
        )}

        {/* Format selector */}
        <div>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", marginBottom: "10px" }}>
            Format
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
            {(["csv", "xlsx", "json"] as const).map((f) => {
              const active = format === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  style={{
                    background: active ? "rgba(139,92,246,0.14)" : "transparent",
                    border: `1px solid ${active ? "rgba(139,92,246,0.45)" : "rgba(255,255,255,0.07)"}`,
                    borderRadius: "8px",
                    padding: "10px 12px",
                    color: active ? "#C4B5FD" : "#F0EEFF",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </div>

        {/* Fields checklist */}
        <div>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", marginBottom: "10px" }}>
            Fields ({fields.size} of {FIELD_OPTIONS.length})
          </div>
          <div
            style={{
              background: "#111115",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "8px",
              padding: "6px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "2px",
            }}
          >
            {FIELD_OPTIONS.map((opt) => {
              const checked = fields.has(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => toggleField(opt.key)}
                  disabled={opt.required}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "7px 10px",
                    background: "transparent",
                    border: "none",
                    borderRadius: "6px",
                    cursor: opt.required ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                    opacity: opt.required ? 0.85 : 1,
                  }}
                >
                  <span
                    style={{
                      width: "14px",
                      height: "14px",
                      borderRadius: "3px",
                      border: checked ? "none" : "1px solid rgba(255,255,255,0.15)",
                      background: checked ? "#8B5CF6" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {checked && (
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                        <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span style={{ fontSize: "12px", color: checked ? "#F0EEFF" : "#8B87A8" }}>
                    {opt.label}
                    {opt.required && (
                      <span style={{ fontSize: "10px", color: "#8B5CF6", marginLeft: "5px", fontWeight: 700 }}>
                        REQUIRED
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              background: "rgba(248,113,113,0.10)",
              border: "1px solid rgba(248,113,113,0.25)",
              borderRadius: "7px",
              padding: "10px 14px",
              color: "#F87171",
              fontSize: "12px",
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "14px 20px",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "7px",
            padding: "9px 16px",
            color: "#8B87A8",
            fontSize: "13px",
            fontWeight: 600,
            cursor: submitting ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting || insufficient || count === 0}
          style={{
            background: insufficient || count === 0 ? "rgba(139,92,246,0.25)" : "#8B5CF6",
            border: "none",
            borderRadius: "7px",
            padding: "9px 18px",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: insufficient || count === 0 || submitting ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting
            ? "Generating…"
            : insufficient
            ? "Insufficient credits"
            : `Confirm · ${cost.toLocaleString()} credit${cost === 1 ? "" : "s"}`}
        </button>
      </div>
    </>
  );
}

function SuccessPanel(props: {
  success: ExportSuccess;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  const { success, copied, onCopy, onClose } = props;
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              background: "rgba(52,211,153,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66" }}>
              Export complete
            </div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#F0EEFF", marginTop: "4px" }}>
              {success.contact_count.toLocaleString()} {success.contact_count === 1 ? "contact" : "contacts"} unlocked
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "6px",
            color: "#8B87A8",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "14px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "12px",
            color: "#8B87A8",
          }}
        >
          <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "5px", background: "rgba(139,92,246,0.12)", color: "#C4B5FD" }}>
            −{success.credits_spent.toLocaleString()} credits
          </span>
          <span style={{ fontSize: "11px", color: "#4E4A66" }}>
            recorded in your transaction history
          </span>
        </div>

        <div>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", marginBottom: "8px" }}>
            Download link
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              id="export-signed-url"
              readOnly
              value={success.signed_url}
              onFocus={(e) => e.currentTarget.select()}
              style={{
                flex: 1,
                background: "#111115",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "7px",
                padding: "9px 12px",
                color: "#F0EEFF",
                fontSize: "12px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                minWidth: 0,
              }}
            />
            <button
              type="button"
              onClick={onCopy}
              style={{
                background: copied ? "rgba(52,211,153,0.15)" : "#8B5CF6",
                border: "none",
                borderRadius: "7px",
                padding: "9px 14px",
                color: "#fff",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div style={{ fontSize: "11px", color: "#4E4A66", marginTop: "8px" }}>
            Link expires in 1 hour. Open it in a new tab to download your {success.format.toUpperCase()} file.
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "14px 20px",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "12px",
        }}
      >
        <a
          href={success.signed_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: "#8B5CF6",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            padding: "9px 18px",
            borderRadius: "7px",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </a>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "7px",
            padding: "9px 16px",
            color: "#8B87A8",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Done
        </button>
      </div>
    </>
  );
}
