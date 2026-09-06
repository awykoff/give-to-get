import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import { getWorkspaceCredits } from "@/lib/workspace-credits";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const credits = await getWorkspaceCredits();

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0C0C0F" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar credits={credits} />
        <main style={{ flex: 1, padding: "24px" }}>
          {children}
        </main>
      </div>
    </div>
  );
}