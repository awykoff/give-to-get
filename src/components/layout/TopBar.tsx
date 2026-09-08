"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

interface HeaderUser {
  firstName: string | null;
  lastName: string | null;
  initials: string;
  avatarUrl: string | null;
}

interface TopBarProps {
  credits: number;
  user: HeaderUser;
}

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/contacts": "Contacts",
  "/import": "Import",
  "/credits": "Credits",
  "/settings": "Settings",
  "/network": "My Network",
};

export default function TopBar({ credits, user }: TopBarProps) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? "give-to-get.com";
  const showExport = pathname === "/contacts";

  // "Hi, {firstName}" when we have a name; neutral fallback when we
  // don't (existing users whose Settings form hasn't been filled out
  // yet — see supabase/migrations/007_user_profiles.sql).
  const greeting = user.firstName ? `Hi, ${user.firstName}` : "Hi there";

  return (
    <header style={{
      height: "52px",
      background: "#111115",
      borderBottom: "1px solid rgba(255,255,255,0.07)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 24px",
      position: "sticky",
      top: 0,
      zIndex: 5,
    }}>
      {/* Page title */}
      <h1 style={{ fontSize: "14px", fontWeight: 700, color: "#F0EEFF", margin: 0 }}>
        {title}
      </h1>

      {/* Right side */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {/* Profile element — circular avatar or initials, plus greeting.
            Linked to /settings (the natural home for the future photo
            upload control). Positioned LEFT of the credits pill per
            design. Phase 2 work (Supabase Storage + upload UI in
            Settings) is additive: the only branch in this component
            is "is avatarUrl set" vs "render initials." */}
        <Link
          href="/settings"
          aria-label="Open settings"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "3px 10px 3px 4px",
            borderRadius: "100px",
            border: "1px solid rgba(255,255,255,0.07)",
            textDecoration: "none",
            color: "#F0EEFF",
          }}
        >
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              width={28}
              height={28}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <span
              aria-hidden="true"
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                background: "rgba(139,92,246,0.12)",
                color: "#8B5CF6",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              {user.initials}
            </span>
          )}
          <span style={{ fontSize: "12px", fontWeight: 500, color: "#8B87A8" }}>
            {greeting}
          </span>
        </Link>

        {/* Credits pill */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "rgba(139,92,246,0.12)",
          border: "1px solid rgba(139,92,246,0.2)",
          borderRadius: "100px",
          padding: "4px 10px 4px 8px",
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "#C4B5FD" }}>
            {credits.toLocaleString()} credits
          </span>
        </div>

        {/* Export button — only on contacts page */}
        {showExport && (
          <button style={{
            background: "#8B5CF6",
            border: "none",
            borderRadius: "7px",
            padding: "7px 14px",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
        )}
      </div>
    </header>
  );
}
