import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import StatCard from "@/components/dashboard/StatCard";

async function getDashboardData(workspaceId: string) {
  const supabase = await createClient();

  const [creditsRes, importsRes, exportsRes, poolRes] = await Promise.all([
    // Credit balance = sum of all ledger entries for this workspace
    supabase
      .from("credits_ledger")
      .select("amount")
      .eq("workspace_id", workspaceId),

    // Total contacts this workspace has contributed
    supabase
      .from("imports")
      .select("new_contacts_count")
      .eq("workspace_id", workspaceId)
      .eq("status", "complete"),

    // Total contacts this workspace has exported
    supabase
      .from("exports")
      .select("contact_count")
      .eq("workspace_id", workspaceId),

    // Total contacts in the global pool
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true }),
  ]);

  const credits = (creditsRes.data ?? []).reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const contributed = (importsRes.data ?? []).reduce((sum, r) => sum + (r.new_contacts_count ?? 0), 0);
  const downloaded = (exportsRes.data ?? []).reduce((sum, r) => sum + (r.contact_count ?? 0), 0);
  const poolSize = poolRes.count ?? 0;

  return { credits, contributed, downloaded, poolSize };
}

async function getRecentImports(workspaceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("imports")
    .select("id, created_at, file_name, total_rows, new_contacts_count, duplicate_count, invalid_count, status")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(5);
  return data ?? [];
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Get workspace for this user
  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  const workspaceId = member?.workspace_id;

  const [stats, recentImports] = workspaceId
    ? await Promise.all([
        getDashboardData(workspaceId),
        getRecentImports(workspaceId),
      ])
    : [{ credits: 0, contributed: 0, downloaded: 0, poolSize: 0 }, []];

  return (
    <div style={{ maxWidth: "1000px" }}>
      {/* Stat cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: "10px",
        marginBottom: "28px",
      }}>
        <StatCard
          label="Credits available"
          value={stats.credits}
          sub="Earn 1 per unique contact uploaded"
          accent
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          }
        />
        <StatCard
          label="Contacts contributed"
          value={stats.contributed}
          sub="Net-new contacts you've uploaded"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          }
        />
        <StatCard
          label="Contacts downloaded"
          value={stats.downloaded}
          sub="Contacts exported from the pool"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          }
        />
        <StatCard
          label="Global pool"
          value={stats.poolSize}
          sub="Total verified contacts available"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          }
        />
      </div>

      {/* Recent imports */}
      <div style={{
        background: "#18181D",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: "10px",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#F0EEFF" }}>Recent imports</span>
          <a href="/import" style={{ fontSize: "12px", color: "#8B5CF6", textDecoration: "none", fontWeight: 600 }}>
            Import contacts →
          </a>
        </div>

        {recentImports.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <p style={{ fontSize: "13px", color: "#4E4A66", margin: "0 0 16px" }}>
              No imports yet. Upload a CSV to earn credits.
            </p>
            <a href="/import" style={{
              display: "inline-block",
              background: "#8B5CF6",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              textDecoration: "none",
              padding: "8px 18px",
              borderRadius: "7px",
            }}>
              Upload your first list
            </a>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["File", "Total rows", "New", "Dupes", "Invalid", "Status", "When"].map((h) => (
                  <th key={h} style={{
                    padding: "10px 20px",
                    textAlign: "left",
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "#4E4A66",
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                    whiteSpace: "nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentImports.map((imp) => (
                <tr key={imp.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "11px 20px", fontSize: "13px", color: "#F0EEFF", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {imp.file_name ?? "—"}
                  </td>
                  <td style={{ padding: "11px 20px", fontSize: "13px", color: "#8B87A8" }}>{imp.total_rows ?? 0}</td>
                  <td style={{ padding: "11px 20px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, background: "rgba(52,211,153,0.15)", color: "#6EE7B7", borderRadius: "5px", padding: "2px 7px" }}>
                      +{imp.new_contacts_count ?? 0}
                    </span>
                  </td>
                  <td style={{ padding: "11px 20px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, background: "rgba(255,255,255,0.07)", color: "#8B87A8", borderRadius: "5px", padding: "2px 7px" }}>
                      {imp.duplicate_count ?? 0}
                    </span>
                  </td>
                  <td style={{ padding: "11px 20px" }}>
                    {(imp.invalid_count ?? 0) > 0 ? (
                      <span style={{ fontSize: "11px", fontWeight: 600, background: "rgba(248,113,113,0.10)", color: "#F87171", borderRadius: "5px", padding: "2px 7px" }}>
                        {imp.invalid_count}
                      </span>
                    ) : (
                      <span style={{ fontSize: "13px", color: "#4E4A66" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "11px 20px" }}>
                    <span style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      borderRadius: "5px",
                      padding: "2px 7px",
                      background: imp.status === "complete" ? "rgba(52,211,153,0.12)" : "rgba(251,191,36,0.10)",
                      color: imp.status === "complete" ? "#6EE7B7" : "#FDE68A",
                    }}>
                      {imp.status}
                    </span>
                  </td>
                  <td style={{ padding: "11px 20px", fontSize: "12px", color: "#4E4A66", whiteSpace: "nowrap" }}>
                    {timeAgo(imp.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
