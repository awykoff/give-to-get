// src/components/lists/ListsTable.tsx
// Shared renderer for the /lists/people and /lists/companies pages.
// Client component: owns search filtering + the "Create new list" flow.
// Importing/exporting list membership is handled by the pages; the Actions
// column entries (Export list / Delete list) are wired as no-op stubs this
// step per the approved scope (real implementations deferred).

"use client";

import { useMemo, useState, type CSSProperties } from "react";

type ListRow = { list_name: string; record_count: number };

type Props = {
  lists: ListRow[];
  kind: "people" | "companies";
  error?: string | null;
};

const COL_HEADERS: { key: string; label: string }[] = [
  { key: "name", label: "List name" },
  { key: "records", label: "# Records" },
  { key: "actions", label: "Actions" },
];

export default function ListsTable({ lists, kind, error }: Props) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter((l) => l.list_name.toLowerCase().includes(q));
  }, [lists, query]);

  const baseHref = kind === "people" ? "/contacts" : "/companies";

  const startCreate = () => {
    setCreating(true);
    setNewName("");
  };
  const cancelCreate = () => {
    setCreating(false);
    setNewName("");
  };
  const confirmCreate = () => {
    // v1: creating a list is just tagging — the actual write path (Add to
    // list on selected contacts) is the next step. For now we close the
    // input and no-op; a re-fetch would return nothing until a contact is
    // actually tagged. Flagged in the approved scope.
    setCreating(false);
    setNewName("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Toolbar: search + create */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search lists…"
          style={{
            flex: 1,
            maxWidth: "320px",
            background: "#18181D",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "8px",
            padding: "8px 12px",
            color: "#F0EEFF",
            fontSize: "13px",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button
          onClick={startCreate}
          style={{
            background: "rgba(139,92,246,0.12)",
            border: "1px solid rgba(139,92,246,0.3)",
            color: "#C4B5FD",
            borderRadius: "7px",
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          + New list
        </button>
      </div>

      {/* Inline create input */}
      {creating && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmCreate();
              if (e.key === "Escape") cancelCreate();
            }}
            placeholder="List name"
            autoFocus
            style={{
              flex: 1,
              maxWidth: "320px",
              background: "#18181D",
              border: "1px solid rgba(139,92,246,0.4)",
              borderRadius: "8px",
              padding: "8px 12px",
              color: "#F0EEFF",
              fontSize: "13px",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          <button
            onClick={confirmCreate}
            disabled={!newName.trim()}
            style={{
              background: "#8B5CF6",
              border: "none",
              color: "#fff",
              borderRadius: "7px",
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: newName.trim() ? "pointer" : "not-allowed",
              opacity: newName.trim() ? 1 : 0.5,
              fontFamily: "inherit",
            }}
          >
            Create
          </button>
          <button
            onClick={cancelCreate}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.07)",
              color: "#8B87A8",
              borderRadius: "7px",
              padding: "8px 12px",
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ fontSize: 13, color: "#F87171" }}>
          Couldn't load lists: {error}
        </div>
      )}

      {/* Table */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "10px",
          overflow: "hidden",
          background: "#18181D",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#111115" }}>
              {COL_HEADERS.map((h) => (
                <th
                  key={h.key}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    color: "#4E4A66",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontSize: "11px",
                  }}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: "24px 14px", color: "#8B87A8", textAlign: "center" }}>
                  {query ? "No lists match your search." : "No lists yet. Select contacts and use “Add to list” to create one."}
                </td>
              </tr>
            )}
            {filtered.map((l) => (
              <tr key={l.list_name} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <td style={{ padding: "11px 14px" }}>
                  <a
                    href={`${baseHref}?list=${encodeURIComponent(l.list_name)}`}
                    style={{ color: "#C4B5FD", textDecoration: "none", fontWeight: 600 }}
                  >
                    {l.list_name}
                  </a>
                </td>
                <td style={{ padding: "11px 14px", color: "#8B87A8" }}>
                  {l.record_count.toLocaleString()}
                </td>
                <td style={{ padding: "11px 14px", color: "#8B87A8", whiteSpace: "nowrap" }}>
                  <button style={linkButtonStyle} data-action="export">Export</button>
                  <button style={{ ...linkButtonStyle, color: "#F87171" }} data-action="delete">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const linkButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#8B87A8",
  fontSize: "12px",
  cursor: "pointer",
  fontFamily: "inherit",
  padding: "2px 8px 2px 0",
};