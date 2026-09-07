"use client";

// src/app/(dashboard)/settings/SettingsForm.tsx
//
// Settings profile form. Edits the caller's user_profiles row
// (first_name, last_name, phone_number). Email is read-only — it
// comes from auth.users and is passed in by the page server
// component. phone_number stays optional; the field renders cleanly
// with an "Add phone number" placeholder when the row is empty.
//
// Submit calls PATCH /api/user-profiles. On success we call
// router.refresh() so the server component re-renders with the
// saved row (matches the existing My Network / contacts patterns —
// we deliberately avoid client-side state for the saved values so
// the page never disagrees with the server).
//
// Privacy: this form NEVER writes to contacts. The body shape is
// fixed to first_name / last_name / phone_number. No company, no
// title, no email field. The wall-off between user_profiles and
// contacts is preserved.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface SettingsFormInitial {
  first_name: string;
  last_name: string;
  phone_number: string | null;
}

interface SettingsFormProps {
  initial: SettingsFormInitial;
}

export default function SettingsForm({ initial }: SettingsFormProps) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.first_name);
  const [lastName, setLastName] = useState(initial.last_name);
  const [phone, setPhone] = useState(initial.phone_number ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty =
    firstName.trim() !== initial.first_name.trim() ||
    lastName.trim() !== initial.last_name.trim() ||
    (phone.trim() || null) !==
      (initial.phone_number && initial.phone_number.trim().length > 0
        ? initial.phone_number
        : null);

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    !isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSavedAt(null);

    const payload = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone_number: phone.trim().length === 0 ? null : phone.trim(),
    };

    try {
      const res = await fetch("/api/user-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `Save failed (${res.status})`);
        return;
      }
      // Re-pull the saved row so the form's initial values reflect
      // what the server now has. Cheaper than threading the
      // response body through and avoids drift between server and
      // client state.
      startTransition(() => {
        router.refresh();
        setSavedAt(new Date().toLocaleTimeString());
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error — try again.",
      );
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "#18181D",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "10px",
        padding: "22px 24px",
        display: "flex",
        flexDirection: "column",
        gap: "18px",
      }}
    >
      {/* First name */}
      <Field
        label="First name"
        required
        value={firstName}
        onChange={setFirstName}
        placeholder="First name"
        maxLength={80}
        autoComplete="given-name"
      />

      {/* Last name */}
      <Field
        label="Last name"
        required
        value={lastName}
        onChange={setLastName}
        placeholder="Last name"
        maxLength={80}
        autoComplete="family-name"
      />

      {/* Phone number — optional. Renders the "Add phone number"
          placeholder when the row has no phone yet; otherwise shows
          the stored value. */}
      <Field
        label="Phone number"
        value={phone}
        onChange={setPhone}
        placeholder={
          initial.phone_number && initial.phone_number.trim().length > 0
            ? initial.phone_number
            : "Add phone number"
        }
        hint="Optional. Used by connections in your network — never shown publicly."
        maxLength={32}
        autoComplete="tel"
      />

      {/* Error + save state */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          marginTop: "2px",
        }}
      >
        <div style={{ fontSize: "12px", color: "#4E4A66", minHeight: "16px" }}>
          {error ? (
            <span style={{ color: "#F87171" }}>{error}</span>
          ) : savedAt ? (
            <span style={{ color: "#6EE7B7" }}>Saved at {savedAt}</span>
          ) : dirty ? (
            <span>Unsaved changes</span>
          ) : (
            <span>All changes saved</span>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
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
            transition: "background 0.15s, opacity 0.15s",
          }}
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

// A single labelled text input, with optional hint text below and a
// "required" dot in the label. Style mirrors the rest of the
// dashboard — surface background, ghost border, focus in the brand
// accent.
interface FieldProps {
  label: string;
  required?: boolean;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  autoComplete?: string;
}

function Field({
  label,
  required,
  value,
  onChange,
  placeholder,
  hint,
  maxLength,
  autoComplete,
}: FieldProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span
        style={{
          fontSize: "11px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#4E4A66",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        {label}
        {required && (
          <span style={{ color: "#8B5CF6", fontWeight: 700 }}>•</span>
        )}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete={autoComplete}
        style={{
          background: "#0C0C0F",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "7px",
          padding: "10px 12px",
          color: "#F0EEFF",
          fontSize: "13px",
          fontFamily: "inherit",
          outline: "none",
          transition: "border-color 0.15s",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
        }}
      />
      {hint && (
        <span style={{ fontSize: "11px", color: "#4E4A66" }}>{hint}</span>
      )}
    </label>
  );
}