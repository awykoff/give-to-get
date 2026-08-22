"use client";

import { usePathname } from "next/navigation";

const NAV = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    label: "Contacts",
    href: "/contacts",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    label: "Import",
    href: "/import",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    label: "Credits",
    href: "/credits",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside style={{
      width: "224px",
      minWidth: "224px",
      background: "#111115",
      borderRight: "1px solid rgba(255,255,255,0.07)",
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      position: "sticky",
      top: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <a href="/dashboard" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none" }}>
          {/* G mark placeholder — swap for <img src="/images/gmark-white.png"> when asset is ready */}
          <div style={{
            width: "28px",
            height: "28px",
            background: "linear-gradient(135deg, #8B5CF6, #7C3AED)",
            borderRadius: "7px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <span style={{ color: "#fff", fontSize: "13px", fontWeight: 700, fontFamily: "inherit" }}>G</span>
          </div>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#F0EEFF", letterSpacing: "-0.01em" }}>
            give-to-get.com
          </span>
        </a>
      </div>

      {/* Nav */}
      <nav style={{ padding: "8px 8px", flex: 1 }}>
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <a
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 10px",
                borderRadius: "7px",
                marginBottom: "2px",
                textDecoration: "none",
                fontSize: "13px",
                fontWeight: active ? 600 : 400,
                color: active ? "#C4B5FD" : "#8B87A8",
                background: active ? "rgba(139,92,246,0.12)" : "transparent",
                borderLeft: active ? "3px solid #8B5CF6" : "3px solid transparent",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              <span style={{ color: active ? "#C4B5FD" : "#8B87A8", flexShrink: 0 }}>
                {item.icon}
              </span>
              {item.label}
            </a>
          );
        })}
      </nav>

      {/* User / sign out */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        <SignOutButton />
      </div>
    </aside>
  );
}

function SignOutButton() {
  const handleSignOut = async () => {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <button
      onClick={handleSignOut}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: "#4E4A66",
        fontSize: "12px",
        fontWeight: 500,
        fontFamily: "inherit",
        padding: "6px 0",
        width: "100%",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      Sign out
    </button>
  );
}
