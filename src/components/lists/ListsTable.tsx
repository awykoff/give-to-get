// src/components/lists/ListsTable.tsx
// Shared renderer for the /lists/people and /lists/companies pages.
// Client component: owns search filtering, the "+ New list" create flow,
// and the per-list Delete action. Create/Delete call the migration-022
// SECURITY DEFINER RPCs (create_people_list/company_list, delete_...) and
// then router.refresh() so the server pages re-fetch member counts.
// (Export list is intentionally left unbound; exporting membership is a
// separate concern.)

"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const createRpc = kind === "people" ? "create_people_list" : "create_company_list";
  const deleteRpc = kind === "people" ? "delete_people_list" : "delete_company_list";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter((l) => l.list_name.toLowerCase().includes(q));
  }, [lists, query]);

  const baseHref = kind === "people" ? "/contacts" : "/companies";

  const startCreate = () => {
    setNotice(null);
    setCreating(true);
    setNewName("");
  };
  const cancelCreate = () => {
    setCreating(false);
    setNewName("");
  };

  // "+ New list" — idempotent create RPC (returns the existing list if the
  // name already exists), then re-fetch so the 0-member list appears.
  const confirmCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(false);
    setNewName("");
    setNotice(null);
    const { error } = await createClient().rpc(createRpc, { p_name: name });
    if (error) {
      setNotice(`Couldn't create "${name}": ${error.message}`);
    }
    router.refresh();
  };

  // Delete removes the list row AND un-tags its members (migration-022 RPC),
  // then re-fetch.
  const handleDelete = async (name: string) => {
    if (!window.confirm(`Delete "${name}"? This removes the list and un-tags all its members.`)) return;
    setNotice(null);
    const { error } = await createClient().rpc(deleteRpc, { p_name: name });
    if (error) {
      setNotice(`Couldn't delete "${name}": ${error.message}`);
    }
    router.refresh();
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

      {/* Load error */}
      {error && (
        <div style={{ fontSize: 13, color: "#F87171" }}>
          Couldn't load lists: {error}
        </div>
      )}

      {/* Mutation feedback */}
      {notice && (
        <div style={{ fontSize: 13, color: "#F87171" }}>{notice}</div>
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
                  {query ? "No lists match your search." : "No lists yet. Use “+ New list”, or select contacts and use “Add to list” to create one."}
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
                  <button
                    style={{ ...linkButtonStyle, color: "#F87171" }}
                    data-action="delete"
                    onClick={() => handleDelete(l.list_name)}
                  >
                    Delete
                  </button>
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