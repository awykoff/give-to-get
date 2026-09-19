"use client";

import { useState, useCallback } from "react";
import ContactsTable from "@/components/contacts/ContactsTable";
import SelectionToolbar from "@/components/table/SelectionToolbar";

export default function ContactsPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids);
  }, []);

  const handleExportComplete = useCallback(() => {
    // Clear the selection after a successful export so the bar above the
    // table collapses. ContactsTable will reset its own selection on the
    // next fetch.
    setSelectedIds([]);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Selection action bar — only renders while something is selected. */}
      {selectedIds.length > 0 && (
        <SelectionToolbar
          kind="contacts"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds([])}
          exportActive
          onExportComplete={handleExportComplete}
        />
      )}

      <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
        <ContactsTable onSelectionChange={handleSelectionChange} />
      </div>
    </div>
  );
}