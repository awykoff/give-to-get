// src/components/companies/CompaniesTable.tsx
// ---------------------------------------------------------------------------
// Companies page table — a thin stateful wrapper around the shared DataTable.
//
// Mirrors ContactsTable's architecture exactly:
//   - rows/count come from searchCompanies (015) + search_companies_count (016);
//   - count is cached per distinct query string in search.ts;
//   - Companies has NO gated columns, so no email projection concern and no
//     exact-match hint; search_companies has no workspace logic.
//
// Difference from ContactsTable (per E1 scope): this is BROWSE-ONLY — no
// selection, no export wiring. The /companies page just shows the sortable/
// reorderable/searchable dataset.
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import DataTable from "@/components/table/DataTable";
import { COMPANY_COLUMNS } from "@/lib/table/column-defs";
import { searchCompanies, COMPANY_PAGE_SIZE, type CompanyRow, type SortDir } from "@/lib/table/search";
import { useColumnOrder } from "@/lib/table/useColumnOrder";

// Debounce: don't fire a search RPC on every keystroke.
function useDebouncedValue(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

type Props = {
  onSelectionChange: (ids: string[]) => void;
};

export default function CompaniesTable({ onSelectionChange }: Props) {
  const searchParams = useSearchParams();
  // Already URL-decoded by useSearchParams — never re-decode.
  const listFilter = searchParams.get("list");

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);

  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [columnOrder, setColumnOrder] = useColumnOrder(
    "give-to-get-companies-column-order",
    COMPANY_COLUMNS.map((c) => c.key)
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

    searchCompanies({
      query: debouncedQuery,
      page,
      pageSize: COMPANY_PAGE_SIZE,
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
        setError(e instanceof Error ? e.message : "Couldn't load companies. Try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, page, sortKey, sortDir, listFilter]);

  // Reset selection on each fetch — the exported selection must reflect what's
  // currently visible.
  useEffect(() => {
    setSelected(new Set());
  }, [debouncedQuery, page, sortKey, sortDir, listFilter]);

  // Push selection up to the page (selection toolbar).
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

  const totalPages = Math.max(1, Math.ceil(count / COMPANY_PAGE_SIZE));

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
            href="/companies"
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
        columns={COMPANY_COLUMNS}
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
        placeholder="Search companies..."
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