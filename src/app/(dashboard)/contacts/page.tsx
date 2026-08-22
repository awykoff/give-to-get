"use client";

import { useState, useCallback } from "react";
import FilterPanel, { type ContactFilters } from "@/components/contacts/FilterPanel";
import ContactsTable from "@/components/contacts/ContactsTable";

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

  return (
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
  );
}
