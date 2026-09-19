"use client";
// src/components/table/SelectionToolbar.tsx
// Shared "N selected" action bar for the Contacts and Companies tables.
//
// Renders whenever the parent has >=1 row checked. Actions:
//   1. Add to list — popover that searches existing lists (with member
//      counts) and can create a new list inline. Writes go through the
//      already-deployed migration-019 RPCs (contact_list_append /
//      company_list_append) — atomic, idempotent, ownership-scoped. No
//      backend work here.
//   2. Export selected — reused via the contacts ExportButton/ExportModal.
//      Contacts-only: Companies has no export backend yet, so the Export
//      button is OMITTED (not greyed out) when exportActive is false.
//   3. Clear — exits selection mode.
//
// Design notes:
//   - A "list" is a text tag in the `lists` array column (global/shared tag
//     model, no lists table). A list only "exists" once a row carries the
//     tag. So "+ Create new list" below types a name and immediately tags
//     it onto ALL currently-selected rows — that is both the create and the
//     add. The toolbar only renders with >=1 selected, so a new list always
//     gains at least one member and becomes visible on the Lists pages.
//   - The add RPC only updates rows where contributed_by_workspace_id =
//     the caller's workspace. Pool/partner rows you don't own return false
//     and are skipped, so the feedback reports "Added X of N" honestly.
//   - Selection is preserved after an add (lets the user tag into several
//     lists, then export). The parent owns the selection; we only report
//     and act.
//
// Tokens per AGENTS.md design system. No <form>. No box-shadow.

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ExportButton from "@/components/contacts/ExportButton";

type Kind = "contacts" | "companies";
type ListRow = { list_name: string; record_count: number };

interface Props {
  kind: Kind;
  selectedIds: string[];
  onClear: () => void;
  /** true -> render "Export selected" (contacts only; companies has no export backend). */
  exportActive?: boolean;
  /** Called after a completed export so the parent can clear its selection. */
  onExportComplete?: () => void;
}

const surface = "#18181D";
const accentText = "#C4B5FD";
const muted = "#8B87A8";
const border = "1px solid rgba(255,255,255,0.07)";

export default function SelectionToolbar({
  kind,
  selectedIds,
  onClear,
  exportActive = false,
  onExportComplete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [lists, setLists] = useState<ListRow[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const count = selectedIds.length;
  const singular = kind === "contacts" ? "contact" : "company";
  const appendRpc = kind === "contacts" ? "contact_list_append" : "company_list_append";
  const memberRpc =
    kind === "contacts" ? "list_member_counts_contacts" : "list_member_counts_companies";
  const idArg = kind === "contacts" ? "p_contact_id" : "p_company_id";

  const loadLists = async () => {
    setListsLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.rpc(memberRpc);
      setLists(
        ((data ?? []) as ListRow[]).map((l) => ({
          list_name: String(l.list_name),
          record_count: Number(l.record_count ?? 0),
        }))
      );
    } finally {
      setListsLoading(false);
    }
  };

  // Fetch member counts when the menu opens; re-fetch after each add.
  useEffect(() => {
    if (menuOpen) loadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, kind]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter((l) => l.list_name.toLowerCase().includes(q));
  }, [lists, query]);

  const closeMenu = () => {
    setMenuOpen(false);
    setCreating(false);
    setNewName("");
    setQuery("");
  };

  // Close the popover on Escape or an outside mousedown.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent | KeyboardEvent) => {
      if (e.type === "mousedown" && rootRef.current?.contains(e.target as Node)) return;
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      closeMenu();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onDoc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  // Tag every selected row into `listName` via the migration-019 RPC.
  // Counts how many rows the ownership-scoped UPDATE actually touched.
  const addTo = async (listName: string) => {
    const name = listName.trim();
    if (!name || count === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    let added = 0;
    let failed: string | null = null;
    try {
      const supabase = createClient();
      for (const id of selectedIds) {
        const { data: updated, error } = await supabase
          .rpc(appendRpc, { [idArg]: id, p_list_name: name })
          .maybeSingle();
        if (error) {
          failed = error.message;
          break;
        }
        if (updated === true) added += 1;
      }
    } finally {
      setBusy(false);
    }
    closeMenu();
    if (failed) {
      setNotice(`Couldn't add to "${name}": ${failed}`);
    } else {
      setNotice(`${added.toLocaleString()} of ${count.toLocaleString()} added to "${name}"`);
    }
    loadLists();
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
        padding: "10px 14px",
        background: "rgba(139,92,246,0.06)",
        border,
        borderRadius: "10px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span
          style={{
            fontSize: "12px",
            color: "#4E4A66",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Selection
        </span>
        <span style={{ fontSize: "13px", color: accentText, fontWeight: 600 }}>
          {count.toLocaleString()} {count === 1 ? singular : `${singular}s`} selected
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {notice && (
          <span
            role="status"
            style={{ fontSize: "12px", color: muted, whiteSpace: "nowrap" }}
          >
            {notice}
          </span>
        )}

        <button
          onClick={() => setMenuOpen((v) => !v)}
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: "rgba(139,92,246,0.12)",
            border: "1px solid rgba(139,92,246,0.3)",
            color: accentText,
            borderRadius: "7px",
            padding: "7px 14px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: busy ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Add to list
        </button>

        {exportActive && (
          <ExportButton selectedIds={selectedIds} onComplete={onExportComplete ?? (() => {})} />
        )}

        <button
          onClick={onClear}
          style={{
            background: "transparent",
            border,
            borderRadius: "6px",
            padding: "7px 12px",
            color: muted,
            fontSize: "13px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Clear
        </button>
      </div>

      {menuOpen && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: "min(340px, 90vw)",
            zIndex: 50,
            background: surface,
            border,
            borderRadius: "10px",
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            padding: "8px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {/* Search existing lists */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeMenu();
            }}
            placeholder="Search lists…"
            autoFocus
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#111115",
              border,
              borderRadius: "8px",
              padding: "8px 10px",
              color: "#F0EEFF",
              fontSize: "13px",
              fontFamily: "inherit",
              outline: "none",
            }}
          />

          {/* Existing lists */}
          <div style={{ maxHeight: "200px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
            {listsLoading && (
              <div style={{ padding: "8px 10px", fontSize: "12px", color: muted }}>
                Loading lists…
              </div>
            )}
            {!listsLoading && filtered.length === 0 && !query && (
              <div style={{ padding: "8px 10px", fontSize: "12px", color: muted }}>
                No lists yet — use “Create new list” below.
              </div>
            )}
            {!listsLoading && filtered.length === 0 && query && (
              <div style={{ padding: "8px 10px", fontSize: "12px", color: muted }}>
                No lists match “{query}”.
              </div>
            )}
            {!listsLoading &&
              filtered.map((l) => (
                <button
                  key={l.list_name}
                  role="menuitem"
                  onClick={() => addTo(l.list_name)}
                  disabled={busy}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    background: "transparent",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 10px",
                    color: "#F0EEFF",
                    fontSize: "13px",
                    textAlign: "left",
                    cursor: busy ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.list_name}
                  </span>
                  <span style={{ color: muted, fontSize: "12px", flexShrink: 0 }}>
                    {l.record_count.toLocaleString()}
                  </span>
                </button>
              ))}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "4px 0" }} />

          {/* Create new list */}
          {!creating ? (
            <button
              role="menuitem"
              onClick={() => { setCreating(true); setNewName(""); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "transparent",
                border: "none",
                borderRadius: "6px",
                padding: "8px 10px",
                color: accentText,
                fontSize: "13px",
                fontWeight: 600,
                textAlign: "left",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span style={{ fontSize: "15px", lineHeight: 1 }}>+</span> Create new list
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "2px" }}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addTo(newName);
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="List name"
                autoFocus
                style={{
                  flex: 1,
                  background: "#111115",
                  border,
                  borderRadius: "8px",
                  padding: "7px 10px",
                  color: "#F0EEFF",
                  fontSize: "13px",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <button
                onClick={() => addTo(newName)}
                disabled={!newName.trim() || busy}
                style={{
                  background: "#8B5CF6",
                  border: "none",
                  color: "#fff",
                  borderRadius: "7px",
                  padding: "7px 12px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: !newName.trim() || busy ? "not-allowed" : "pointer",
                  opacity: !newName.trim() ? 0.5 : 1,
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                Create
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}