import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import { getWorkspaceCredits } from "@/lib/workspace-credits";
import { getHeaderProfile } from "@/lib/user-profiles";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Credits + user profile are fetched in parallel; both queries are
  // small and RLS-gated to the caller's workspace / own row. We pass
  // the profile down as a narrow HeaderProfile rather than the full
  // UserProfile so the TopBar's interface stays minimal (and so
  // TopBar never accidentally starts rendering fields it shouldn't,
  // like phone_number or audit timestamps).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [credits, profile] = await Promise.all([
    getWorkspaceCredits(),
    getHeaderProfile(user?.email ?? null),
  ]);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0C0C0F" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar credits={credits} user={profile} />
        <main style={{ flex: 1, padding: "24px" }}>
          {children}
        </main>
      </div>
    </div>
  );
}