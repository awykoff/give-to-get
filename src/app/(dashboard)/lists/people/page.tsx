// src/app/(dashboard)/lists/people/page.tsx
// /lists/people — People Lists page. Server component: resolves the auth'd
// workspace context, calls the list_member_counts_contacts() RPC (019), and
// passes the rows to the shared ListsTable.
import { getWorkspaceContext } from "@/lib/workspace-credits";
import ListsTable from "@/components/lists/ListsTable";

export type ListRow = { list_name: string; record_count: number };

export default async function PeopleListsPage() {
  const { supabase } = await getWorkspaceContext();

  const { data, error } = await supabase.rpc("list_member_counts_contacts");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#F0EEFF" }}>
            People Lists
          </div>
          <div style={{ fontSize: 13, color: "#8B87A8", marginTop: 3 }}>
            Every list you've tagged contacts with, with member counts.
          </div>
        </div>
      </div>
      <ListsTable
        lists={(data as ListRow[]) ?? []}
        kind="people"
        error={error?.message ?? null}
      />
    </div>
  );
}