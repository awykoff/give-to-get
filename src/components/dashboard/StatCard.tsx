interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  icon: React.ReactNode;
}

export default function StatCard({ label, value, sub, accent, icon }: StatCardProps) {
  return (
    <div style={{
      background: "#18181D",
      border: `1px solid ${accent ? "rgba(139,92,246,0.35)" : "rgba(255,255,255,0.07)"}`,
      borderRadius: "10px",
      padding: "20px 22px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    }}>
      {/* Icon + label row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          fontSize: "10px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#4E4A66",
        }}>
          {label}
        </span>
        <span style={{
          color: accent ? "#8B5CF6" : "#4E4A66",
          display: "flex",
          alignItems: "center",
        }}>
          {icon}
        </span>
      </div>

      {/* Value */}
      <div>
        <div style={{
          fontSize: "32px",
          fontWeight: 700,
          color: accent ? "#C4B5FD" : "#F0EEFF",
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {sub && (
          <div style={{ fontSize: "12px", color: "#4E4A66", marginTop: "6px" }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
