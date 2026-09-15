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

export default function CompaniesTable() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);

  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [columnOrder, setColumnOrder] = useColumnOrder(
    "give-to-get-companies-column-order",
    COMPANY_COLUMNS.map((c) => c.key)
  );

  // Reset to page 0 whenever the query/sort changes.
  useEffect(() => {
    setPage(0);
  }, [debouncedQuery, sortKey, sortDir]);

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
  }, [debouncedQuery, page, sortKey, sortDir]);

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

  const totalPages = Math.max(1, Math.ceil(count / COMPANY_PAGE_SIZE));

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
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
      />
    </div>
  );
}