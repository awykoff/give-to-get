"use client";

import { useState, useCallback } from "react";
import FilterPanel, { type ContactFilters } from "@/components/contacts/FilterPanel";
import ContactsTable from "@/components/contacts/ContactsTable";
import ExportButton from "@/components/contacts/ExportButton";

const DEFAULT_FILTERS: ContactFilters = {
  verticals: [],
  seniorities: [],
  companySize: "",
  location: "",
};

export default function ContactsPage() {
  const [filters, setFilters] = useState<ContactFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids);
  }, []);

  const handleExportComplete = useCallback(() => {
    // Clear the selection after a successful export so the export row above
    // the table collapses. ContactsTable will reset its own selection on
    // the next fetch (it already does this on filter changes).
    setSelectedIds([]);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Selection action bar — only renders while something is selected. */}
      {selectedIds.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            background: "rgba(139,92,246,0.06)",
            border: "1px solid rgba(139,92,246,0.2)",
            borderRadius: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "12px", color: "#4E4A66", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Selection
            </span>
            <span style={{ fontSize: "13px", color: "#C4B5FD", fontWeight: 600 }}>
              {selectedIds.length.toLocaleString()} {selectedIds.length === 1 ? "contact" : "contacts"} selected
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={() => setSelectedIds([])}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "6px",
                padding: "6px 12px",
                color: "#8B87A8",
                fontSize: "12px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Clear
            </button>
            <ExportButton selectedIds={selectedIds} onComplete={handleExportComplete} />
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
        <FilterPanel
          filters={filters}
          onChange={setFilters}
          onClear={() => setFilters(DEFAULT_FILTERS)}
        />
        <ContactsTable
          filters={filters}
          onSelectionChange={handleSelectionChange}
        />
      </div>
    </div>
  );
}
