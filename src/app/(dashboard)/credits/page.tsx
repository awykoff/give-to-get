import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CreditBalance from "@/components/credits/CreditBalance";
import TransactionHistory from "@/components/credits/TransactionHistory";

export default async function CreditsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  const workspaceId = member?.workspace_id;

  let entries: { id: string; amount: number; type: string; description: string | null; created_at: string }[] = [];

  if (workspaceId) {
    const { data } = await supabase
      .from("credits_ledger")
      .select("id, amount, type, description, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    entries = data ?? [];
  }

  const totalEarned = entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const totalSpent  = entries.filter((e) => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
  const balance     = totalEarned - totalSpent;

  return (
    <div style={{ maxWidth: "860px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <CreditBalance balance={balance} totalEarned={totalEarned} totalSpent={totalSpent} />
      <TransactionHistory entries={entries} />
    </div>
  );
}
