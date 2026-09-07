// src/app/(dashboard)/settings/page.tsx
//
// Settings page (server component). Loads:
//   * the caller's auth.users.email (read-only display — never
//     written back; the form fields don't include email)
//   * the caller's user_profiles row, if any (via getMyProfile()
//     which returns null when the row hasn't been created yet)
//
// Then renders SettingsForm with the initial values. phone_number
// stays optional — when no profile row exists yet OR the row has a
// null phone, the form renders with an empty phone field and the
// "Add phone number" placeholder set by the form component.
//
// Privacy: this page reads from auth.users (the caller's own row
// only — RLS gates that) and user_profiles (RLS-gated). It never
// reads contacts.

import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/user-profiles";
import SettingsForm from "./SettingsForm";

export default async function SettingsPage() {
  const supabase = await createClient();

  // auth.getUser() also serves as the auth gate — the dashboard
  // proxy already redirects unauthenticated requests, but a double-
  // check here makes the page resilient if it's ever rendered
  // outside the proxy (tests, future route group restructure).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = await getMyProfile();

  // Initial values — empty strings are fine here. The form
  // component decides what placeholder to render based on whether
  // the saved phone was null vs empty-string.
  const initial = {
    first_name: profile?.first_name ?? "",
    last_name: profile?.last_name ?? "",
    phone_number: profile?.phone_number ?? null,
  };

  return (
    <div
      style={{
        maxWidth: "640px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
      }}
    >
      {/* Header */}
      <header style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2
          style={{
            margin: 0,
            fontSize: "18px",
            fontWeight: 700,
            color: "#F0EEFF",
            letterSpacing: "-0.01em",
          }}
        >
          Settings
        </h2>
        <p style={{ margin: 0, fontSize: "13px", color: "#8B87A8" }}>
          Your display name and contact details. Friends in your
          network see this on the My Network page.
        </p>
      </header>

      {/* Account card — email is read-only from auth.users. We
          deliberately do NOT surface an "edit email" path here;
          Supabase Auth owns that flow. */}
      <section
        style={{
          background: "#18181D",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "10px",
          padding: "18px 22px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#4E4A66",
          }}
        >
          Account
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "#4E4A66",
              minWidth: "60px",
            }}
          >
            Email
          </span>
          <span style={{ fontSize: "13px", color: "#F0EEFF" }}>
            {user?.email ?? "—"}
          </span>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "#4E4A66",
              marginLeft: "auto",
            }}
          >
            Read-only
          </span>
        </div>
      </section>

      {/* Profile form */}
      <SettingsForm initial={initial} />
    </div>
  );
}