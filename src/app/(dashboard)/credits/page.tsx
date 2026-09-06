import CreditBalance from "@/components/credits/CreditBalance";
import TransactionHistory from "@/components/credits/TransactionHistory";
import { getWorkspaceLedgerEntries } from "@/lib/workspace-credits";

export default async function CreditsPage() {
  const entries = await getWorkspaceLedgerEntries();

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