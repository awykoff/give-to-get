"use client";
// /companies — separate route (LOCKED v2 decision: two separate routes, not
// tabs). Selection toolbar rendering — Add to list + Clear. Export is
// deliberately OMITTED here: no companies export backend exists yet
// (export-generator + /api/export are contacts-only). See PR scope note.
import { useState, useCallback } from "react";
import CompaniesTable from "@/components/companies/CompaniesTable";
import SelectionToolbar from "@/components/table/SelectionToolbar";

export default function CompaniesPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#F0EEFF" }}>
          Companies
        </div>
        <div style={{ fontSize: 13, color: "#8B87A8", marginTop: 3 }}>
          Every real field, sortable and reorderable — no filter panel, just search.
        </div>
      </div>

      {/* Selection toolbar — only renders while something is selected.
          Export-active=false (Companies has no export backend this PR). */}
      {selectedIds.length > 0 && (
        <SelectionToolbar
          kind="companies"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds([])}
        />
      )}

      <CompaniesTable onSelectionChange={handleSelectionChange} />
    </div>
  );
}