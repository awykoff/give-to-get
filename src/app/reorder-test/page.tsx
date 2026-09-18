"use client";
// TEST-ONLY harness route. Renders the real shared DataTable with four columns
// whose per-row values are all mutually distinct, so a header drag either
// visibly reorders the body or it provably does not (no Email-vs-Normalized
// masking). Driven by tests/e2e/reorder.spec.ts.
//
// Production gate: NODE_ENV is inlined at build time, so the prod bundle
// renders a blank page and never ships these fake rows. Dev/test builds
// render the fixture for the Playwright drag-reorder regression test.
import { useState } from "react";
import DataTable from "@/components/table/DataTable";
import type { ColumnDef } from "@/lib/table/column-defs";

const COLS: ColumnDef[] = [
  { key: "city", label: "City", type: "text", width: 130 },
  { key: "first_name", label: "First Name", type: "text", width: 120 },
  { key: "company", label: "Company", type: "text", width: 180 },
  { key: "last_name", label: "Last Name", type: "text", width: 120 },
];
const DEFAULT_ORDER = COLS.map((c) => c.key);

// Distinct per-row values in every column: dragging "City" to the front must
// move "London"/"Arlington"/"Manchester" under the first header, or the body
// did not follow the header.
const ROWS = [
  { id: "1", city: "London", first_name: "Ada", company: "Analytical", last_name: "Lovelace" },
  { id: "2", city: "Arlington", first_name: "Grace", company: "US Navy", last_name: "Hopper" },
  { id: "3", city: "Manchester", first_name: "Alan", company: "NPL", last_name: "Turing" },
];

export default function ReorderTestPage() {
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div style={{ padding: 24, background: "#0C0C0F", minHeight: "100vh" }}>
      <DataTable
        columns={COLS}
        rows={ROWS}
        count={3}
        page={0}
        totalPages={1}
        onPageChange={() => {}}
        sortKey=""
        sortDir="desc"
        onSort={() => {}}
        columnOrder={order}
        onColumnOrderChange={setOrder}
        query=""
        onQueryChange={() => {}}
        loading={false}
        error={null}
      />
    </div>
  );
}
