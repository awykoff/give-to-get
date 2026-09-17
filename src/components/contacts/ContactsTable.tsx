// src/components/contacts/ContactsTable.tsx
// ---------------------------------------------------------------------------
// Contacts page table — a thin stateful wrapper around the shared DataTable.
//
// Owns the page/sort/query/selection state and calls the search RPCs:
//   - rows/count come from searchContacts (015) + search_contacts_count (016);
//   - NO network-contributed-row exclusion — PR #20 merged network-partner
//     contacts into the general pool; 015's WHERE has zero workspace logic
//     and we keep it that way;
//   - count is cached per distinct query string in search.ts, so page turns
//     and sort-header clicks don't refetch it;
//   - gated emails never reach the client (search.ts projects to the
//     non-gated set + id + contributed_by_workspace_id).
//
// Preserves the existing page contract: `onSelectionChange(ids)` feeds
// contacts/page.tsx's selection bar + ExportModal, and is called whenever
// selection changes (including reset on each fetch).
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import DataTable from "@/components/table/DataTable";
import { CONTACT_COLUMNS } from "@/lib/table/column-defs";
import { searchContacts, CONTACT_PAGE_SIZE, type ContactRow, type SortDir } from "@/lib/table/search";
import { useColumnOrder } from "@/lib/table/useColumnOrder";

type Props = {
  onSelectionChange: (ids: string[]) => void;
};

// Debounce: don't fire a search RPC on every keystroke. Wait for a quiet
// gap so the server-side substring search runs on a settled query.
function useDebouncedValue(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function ContactsTable({ onSelectionChange }: Props) {
  const searchParams = useSearchParams();
  // Already URL-decoded by useSearchParams — never re-decode (double-decodes
  // names that legitimately contain % or +).
  const listFilter = searchParams.get("list");

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);

  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [rows, setRows] = useState<ContactRow[]>([]);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [columnOrder, setColumnOrder] = useColumnOrder(
    "give-to-get-contacts-column-order",
    CONTACT_COLUMNS.map((c) => c.key)
  );

  // Reset to page 0 whenever the query/sort/filter changes.
  useEffect(() => {
    setPage(0);
  }, [debouncedQuery, sortKey, sortDir, listFilter]);

  // Fetch on mount + page/query/sort changes. count is cached per query in
  // search.ts, so only rows refetch on page/sort changes for the same query.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    searchContacts({
      query: debouncedQuery,
      page,
      pageSize: CONTACT_PAGE_SIZE,
      sortColumn: sortKey,
      sortAscending: sortDir === "asc",
      p_list: listFilter,
    })
      .then(({ data, count: c }) => {
        if (cancelled) return;
        setRows(data);
        setCount(c ?? 0);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't load contacts. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, page, sortKey, sortDir, listFilter]);

  // Reset selection on each fetch (matches the old ContactsTable behavior —
  // the exported selection must reflect what's currently visible).
  useEffect(() => {
    setSelected(new Set());
  }, [debouncedQuery, page, sortKey, sortDir, listFilter]);

  // Push selection up to the page (selection bar + ExportModal).
  useEffect(() => {
    onSelectionChange(Array.from(selected));
  }, [selected, onSelectionChange]);

  const handleSort = useCallback(
    (key: string) => {
      if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  const handleToggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelected((prev) => {
      const allVisibleOnPage = rows.length > 0 && rows.every((r) => prev.has(String(r.id)));
      const next = new Set(prev);
      if (allVisibleOnPage) rows.forEach((r) => next.delete(String(r.id)));
      else rows.forEach((r) => next.add(String(r.id)));
      return next;
    });
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(count / CONTACT_PAGE_SIZE));
  // DataTable receives totalPages (parent-computed); it has no pageSize prop.

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {listFilter && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "10px",
            padding: "5px 10px 5px 12px",
            background: "rgba(139,92,246,0.12)",
            border: "1px solid rgba(139,92,246,0.3)",
            borderRadius: "999px",
            fontSize: "12px",
            color: "#C4B5FD",
          }}
        >
          <span>
            Filtered by list: <strong>{listFilter}</strong>
          </span>
          <a
            href="/contacts"
            aria-label="Clear list filter"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#C4B5FD",
              textDecoration: "none",
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: "rgba(139,92,246,0.2)",
              fontSize: "12px",
              lineHeight: "1",
            }}
          >
            ×
          </a>
        </div>
      )}
      <DataTable
        columns={CONTACT_COLUMNS}
        rows={rows as Record<string, unknown>[]}
        count={count}
        page={page}
        totalPages={totalPages}
        onPageChange={(p) => setPage(p)}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        columnOrder={columnOrder}
        onColumnOrderChange={setColumnOrder}
        query={query}
        onQueryChange={setQuery}
        loading={loading}
        error={error}
        hasGatedColumns
        placeholder="Search by name, company, title... or paste a full email"
        selection={{
          selected,
          onToggle: handleToggle,
          onToggleAll: handleToggleAll,
          allSelected: rows.length > 0 && rows.every((r) => selected.has(String(r.id))),
          someSelected: selected.size > 0 && !(rows.length > 0 && rows.every((r) => selected.has(String(r.id)))),
        }}
      />
    </div>
  );
}