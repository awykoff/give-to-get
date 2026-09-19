"use client";
// TEMPORARY verification harness — renders the real SelectionToolbar for both
// variants (contacts w/ Export, companies w/o) so a Playwright test can assert
// the contract. NOT for production; working-tree-only, deleted after the test.
import SelectionToolbar from "@/components/table/SelectionToolbar";

export default function SelToolbarTestPage() {
  // Test-only route: gate behind non-production so prod never ships the
  // throwaway fixture (consistent with /reorder-test).
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div style={{ padding: 24, background: "#0C0C0F", minHeight: "100vh", display: "flex", flexDirection: "column", gap: 20 }}>
      <div data-k="contacts">
        <SelectionToolbar
          kind="contacts"
          selectedIds={["1", "2", "3"]}
          onClear={() => {}}
          exportActive
          onExportComplete={() => {}}
        />
      </div>
      <div data-k="companies">
        <SelectionToolbar
          kind="companies"
          selectedIds={["1"]}
          onClear={() => {}}
        />
      </div>
    </div>
  );
}