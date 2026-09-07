"use client";

// src/app/(dashboard)/network/SeeContactsModal.tsx
//
// Modal that shows a friend's contributed contacts, paginated
// server-side. Read-only — no checkboxes, no export, no download.
//
// Hard requirements (PRD §5.7):
//   - Server-side pagination. The client NEVER holds the friend's
//     full contact list. Every page is a fresh roundtrip to
//     /api/network/contacts/[connectionId].
//   - In-modal search/filter re-queries the server with a fresh
//     cursor reset to the first page.
//
// Privacy (PRD §7):
//   - We never join the result with anything outside the modal.
//     In particular, we never forward the result to the global
//     Contacts search or export path. This modal is the only surface
//     that displays connection-gated contacts.
//   - No "Add to selection" or "Export these" button — the modal is
//     purely a read view. A user wanting to export must do so via
//     the general Contacts page's export flow, which has its own
//     credit/RLS gates and does not (by the defensive filter on the
//     Contacts page query) include connection-gated rows.

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionContactRow,
  ConnectionContactsPage,
} from "@/lib/network";

interface Props {
  connectionId: string;
  friendLabel: string;
  onClose: () => void;
}

const PAGE_SIZE = 25;

export default function SeeContactsModal({
  connectionId,
  friendLabel,
  onClose,
}: Props) {
  const [page, setPage] = useState<ConnectionContactsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(
    async (cursor: { created_at: string; id: string } | null) => {
      setLoading(true);
      setError(null);
      try {
        const url = new URL(
          `/api/network/contacts/${encodeURIComponent(connectionId)}`,
          window.location.origin,
        );
        if (cursor) {
          url.searchParams.set("cursor_created_at", cursor.created_at);
          url.searchParams.set("cursor_id", cursor.id);
        }
        if (activeSearch.trim().length > 0) {
          url.searchParams.set("q", activeSearch.trim());
        }
        url.searchParams.set("pageSize", String(PAGE_SIZE));

        const res = await fetch(url.toString());
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(data.error ?? `Failed (${res.status})`);
          setPage({ rows: [], nextCursor: null });
          return;
        }
        const data = (await res.json()) as ConnectionContactsPage;
        setPage(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
        setPage({ rows: [], nextCursor: null });
      } finally {
        setLoading(false);
      }
    },
    [connectionId, activeSearch],
  );

  // First-page load whenever the modal opens, the connection changes,
  // or the active search term changes (debounced via the input handler
  // below).
  useEffect(() => {
    fetchPage(null);
  }, [fetchPage]);

  // Debounce the search input.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setActiveSearch(searchInput);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Contacts contributed by ${friendLabel}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "24px",
      }}
    >
      <div
        style={{
          background: "#18181D",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "960px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <header
          style={{
            padding: "16px 22px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3
              style={{
                margin: 0,
                fontSize: "14px",
                fontWeight: 700,
                color: "#F0EEFF",
              }}
            >
              {friendLabel}&apos;s contributed contacts
            </h3>
            <p
              style={{
                margin: "2px 0 0",
                fontSize: "11px",
                color: "#4E4A66",
              }}
            >
              Read-only. Server-paginated — only the current page is in
              memory.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "6px",
              padding: "6px 10px",
              color: "#8B87A8",
              fontSize: "12px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Close
          </button>
        </header>

        {/* Search bar */}
        <div
          style={{
            padding: "12px 22px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            display: "flex",
            gap: "8px",
            alignItems: "center",
          }}
        >
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, company, or title…"
            disabled={loading}
            style={{
              flex: 1,
              background: "#0C0C0F",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "7px",
              padding: "8px 12px",
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
          {searchInput.trim().length > 0 && (
            <button
              onClick={() => setSearchInput("")}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "6px",
                padding: "6px 10px",
                color: "#8B87A8",
                fontSize: "11px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "0 0 0 0",
          }}
        >
          {error && (
            <div
              style={{
                padding: "20px 22px",
                fontSize: "12px",
                color: "#F87171",
                background: "rgba(248,113,113,0.06)",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              {error}
            </div>
          )}

          {loading && !page && (
            <div
              style={{
                padding: "32px",
                textAlign: "center",
                color: "#4E4A66",
                fontSize: "13px",
              }}
            >
              Loading…
            </div>
          )}

          {page && page.rows.length === 0 && !loading && (
            <div
              style={{
                padding: "32px",
                textAlign: "center",
                color: "#4E4A66",
                fontSize: "13px",
              }}
            >
              {activeSearch.trim().length > 0
                ? `No contacts match "${activeSearch.trim()}".`
                : "No contributed contacts yet."}
            </div>
          )}

          {page && page.rows.length > 0 && (
            <ContactList rows={page.rows} />
          )}
        </div>

        {/* Footer pagination */}
        <footer
          style={{
            padding: "12px 22px",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "11px", color: "#4E4A66" }}>
            {page
              ? `${page.rows.length} row${page.rows.length === 1 ? "" : "s"} on this page`
              : ""}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => fetchPage(null)}
              disabled={loading || !page?.nextCursor}
              style={pageNavButtonStyle}
            >
              ← First page
            </button>
            <button
              onClick={() => page && fetchPage(page.nextCursor)}
              disabled={loading || !page?.nextCursor}
              style={pageNavButtonStyle}
            >
              Next page →
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

const pageNavButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "6px",
  padding: "6px 12px",
  color: "#F0EEFF",
  fontSize: "12px",
  cursor: "pointer",
  fontFamily: "inherit",
};

// ─────────────────────────────────────────────────────────────
// ContactList — pure read-only row rendering
// ─────────────────────────────────────────────────────────────

function ContactList({ rows }: { rows: ConnectionContactRow[] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ background: "rgba(255,255,255,0.02)" }}>
          <Th>Name</Th>
          <Th>Title</Th>
          <Th>Company</Th>
          <Th>Email</Th>
          <Th>Phone</Th>
          <Th>LinkedIn</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
          >
            <Td>
              {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
            </Td>
            <Td muted>{r.title ?? "—"}</Td>
            <Td muted>{r.company_name ?? "—"}</Td>
            <Td muted>{r.email ?? "—"}</Td>
            <Td muted>
              {r.work_direct_phone ?? r.mobile_phone ?? r.corporate_phone ?? "—"}
            </Td>
            <Td muted>
              {r.linkedin_url ? (
                <a
                  href={r.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#C4B5FD", textDecoration: "none" }}
                >
                  Open ↗
                </a>
              ) : (
                "—"
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "10px 14px",
        fontSize: "10px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "#4E4A66",
        textAlign: "left",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <td
      style={{
        padding: "10px 14px",
        fontSize: "12px",
        color: muted ? "#8B87A8" : "#F0EEFF",
        whiteSpace: "nowrap",
        maxWidth: "220px",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </td>
  );
}