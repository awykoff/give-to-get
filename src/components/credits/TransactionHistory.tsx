interface LedgerEntry {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  created_at: string;
}

interface Props {
  entries: LedgerEntry[];
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TransactionHistory({ entries }: Props) {
  // Calculate running balance from oldest → newest, display newest first
  let running = 0;
  const withBalance = [...entries]
    .reverse()
    .map((e) => { running += e.amount; return { ...e, runningBalance: running }; })
    .reverse();

  return (
    <div style={{ background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#F0EEFF" }}>Transaction history</span>
        <span style={{ fontSize: "11px", color: "#4E4A66", marginLeft: "8px" }}>
          {entries.length} {entries.length === 1 ? "entry" : "entries"} · append-only ledger
        </span>
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: "48px 20px", textAlign: "center" }}>
          <p style={{ fontSize: "13px", color: "#4E4A66", margin: "0 0 16px" }}>
            No transactions yet.
          </p>
          <a href="/import" style={{ display: "inline-block", background: "#8B5CF6", color: "#fff", fontSize: "13px", fontWeight: 600, textDecoration: "none", padding: "8px 18px", borderRadius: "7px" }}>
            Import contacts to earn credits
          </a>
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              {["Date", "Description", "Type", "Amount", "Balance"].map((h) => (
                <th key={h} style={{
                  padding: "10px 20px",
                  textAlign: "left",
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#4E4A66",
                  whiteSpace: "nowrap",
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {withBalance.map((entry) => {
              const isEarn = entry.amount > 0;
              return (
                <tr key={entry.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {/* Date */}
                  <td style={{ padding: "11px 20px", whiteSpace: "nowrap" }}>
                    <div style={{ fontSize: "13px", color: "#F0EEFF" }}>{formatDate(entry.created_at)}</div>
                    <div style={{ fontSize: "11px", color: "#4E4A66", marginTop: "1px" }}>{timeAgo(entry.created_at)}</div>
                  </td>

                  {/* Description */}
                  <td style={{ padding: "11px 20px", fontSize: "13px", color: "#8B87A8", maxWidth: "280px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.description ?? "—"}
                  </td>

                  {/* Type badge */}
                  <td style={{ padding: "11px 20px" }}>
                    <span style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "5px",
                      background: isEarn ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.10)",
                      color: isEarn ? "#6EE7B7" : "#F87171",
                    }}>
                      {isEarn ? "earn" : "spend"}
                    </span>
                  </td>

                  {/* Amount */}
                  <td style={{ padding: "11px 20px", fontSize: "13px", fontWeight: 600, color: isEarn ? "#34D399" : "#F87171", whiteSpace: "nowrap" }}>
                    {isEarn ? "+" : ""}{entry.amount.toLocaleString()}
                  </td>

                  {/* Running balance */}
                  <td style={{ padding: "11px 20px", fontSize: "13px", color: "#C4B5FD", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {entry.runningBalance.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
