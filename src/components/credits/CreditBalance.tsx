interface Props {
  balance: number;
  totalEarned: number;
  totalSpent: number;
}

export default function CreditBalance({ balance, totalEarned, totalSpent }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "10px", alignItems: "stretch" }}>
      {/* Main balance */}
      <div style={{
        background: "#18181D",
        border: "1px solid rgba(139,92,246,0.35)",
        borderRadius: "10px",
        padding: "28px 28px",
        display: "flex",
        alignItems: "center",
        gap: "20px",
      }}>
        <div style={{
          width: "52px",
          height: "52px",
          borderRadius: "12px",
          background: "rgba(139,92,246,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", marginBottom: "6px" }}>
            Available credits
          </div>
          <div style={{ fontSize: "44px", fontWeight: 700, color: "#C4B5FD", lineHeight: 1, letterSpacing: "-0.03em" }}>
            {balance.toLocaleString()}
          </div>
          <div style={{ fontSize: "12px", color: "#4E4A66", marginTop: "6px" }}>
            1 credit = 1 contact downloaded
          </div>
        </div>
      </div>

      {/* Earn / Spend breakdown */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: "180px" }}>
        <div style={{ background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "18px 20px", flex: 1 }}>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", marginBottom: "8px" }}>
            Total earned
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#34D399", letterSpacing: "-0.02em" }}>
            +{totalEarned.toLocaleString()}
          </div>
        </div>
        <div style={{ background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "18px 20px", flex: 1 }}>
          <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", marginBottom: "8px" }}>
            Total spent
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#F87171", letterSpacing: "-0.02em" }}>
            -{totalSpent.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}
