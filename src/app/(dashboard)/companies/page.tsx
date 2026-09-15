// src/app/(dashboard)/companies/page.tsx
// /companies — separate route (LOCKED v2 decision: two separate routes, not
// tabs). Browse-only: renders CompaniesTable inline, no selection/export bar
// (E1 scope). Page header matches the Contacts page's tone; no data shown
// until the companies table is populated.
import CompaniesTable from "@/components/companies/CompaniesTable";

export default function CompaniesPage() {
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
      <CompaniesTable />
    </div>
  );
}