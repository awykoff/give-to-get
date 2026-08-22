"use client";

export interface ContactFilters {
  verticals: string[];
  seniorities: string[];
  companySize: string;
  location: string;
}

const VERTICALS = ["SaaS", "FinTech", "MarTech", "Data & AI", "HRTech", "HealthTech", "Other"];
const SENIORITIES = ["C-Suite", "VP", "Director", "Manager", "Individual Contributor", "Entry Level"];
const COMPANY_SIZES = ["", "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"];

const VERTICAL_COLORS: Record<string, { bg: string; text: string }> = {
  SaaS:        { bg: "rgba(139,92,246,0.18)",  text: "#C4B5FD" },
  FinTech:     { bg: "rgba(52,211,153,0.15)",  text: "#6EE7B7" },
  MarTech:     { bg: "rgba(251,191,36,0.15)",  text: "#FDE68A" },
  "Data & AI": { bg: "rgba(96,165,250,0.15)",  text: "#93C5FD" },
  HRTech:      { bg: "rgba(248,113,113,0.15)", text: "#FCA5A5" },
  HealthTech:  { bg: "rgba(52,211,153,0.12)",  text: "#6EE7B7" },
  Other:       { bg: "rgba(255,255,255,0.07)", text: "#8B87A8" },
};

interface Props {
  filters: ContactFilters;
  onChange: (f: ContactFilters) => void;
  onClear: () => void;
}

export default function FilterPanel({ filters, onChange, onClear }: Props) {
  const toggleVertical = (v: string) => {
    const next = filters.verticals.includes(v)
      ? filters.verticals.filter((x) => x !== v)
      : [...filters.verticals, v];
    onChange({ ...filters, verticals: next });
  };

  const toggleSeniority = (s: string) => {
    const next = filters.seniorities.includes(s)
      ? filters.seniorities.filter((x) => x !== s)
      : [...filters.seniorities, s];
    onChange({ ...filters, seniorities: next });
  };

  const hasFilters =
    filters.verticals.length > 0 ||
    filters.seniorities.length > 0 ||
    filters.companySize !== "" ||
    filters.location !== "";

  return (
    <aside style={{
      width: "200px",
      minWidth: "200px",
      display: "flex",
      flexDirection: "column",
      gap: "20px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66" }}>
          Filters
        </span>
        {hasFilters && (
          <button
            onClick={onClear}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", color: "#8B5CF6", fontFamily: "inherit", fontWeight: 600, padding: 0 }}
          >
            Clear all
          </button>
        )}
      </div>

      {/* Location */}
      <div>
        <label style={{ display: "block", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", marginBottom: "8px" }}>
          Location
        </label>
        <input
          type="text"
          value={filters.location}
          onChange={(e) => onChange({ ...filters, location: e.target.value })}
          placeholder="City, state, or country"
          style={{
            width: "100%",
            background: "#18181D",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "7px",
            padding: "7px 10px",
            color: "#F0EEFF",
            fontSize: "12px",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Vertical */}
      <div>
        <label style={{ display: "block", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", marginBottom: "8px" }}>
          Vertical
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {VERTICALS.map((v) => {
            const active = filters.verticals.includes(v);
            const colors = VERTICAL_COLORS[v];
            return (
              <button
                key={v}
                onClick={() => toggleVertical(v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: active ? colors.bg : "transparent",
                  border: `1px solid ${active ? "transparent" : "transparent"}`,
                  borderRadius: "6px",
                  padding: "5px 8px",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "background 0.12s",
                }}
              >
                <span style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "3px",
                  border: active ? "none" : "1px solid rgba(255,255,255,0.15)",
                  background: active ? colors.text : "transparent",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  {active && (
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                      <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="#0C0C0F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span style={{ fontSize: "12px", color: active ? colors.text : "#8B87A8", fontWeight: active ? 600 : 400 }}>
                  {v}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Seniority */}
      <div>
        <label style={{ display: "block", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", marginBottom: "8px" }}>
          Seniority
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {SENIORITIES.map((s) => {
            const active = filters.seniorities.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleSeniority(s)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  background: "transparent",
                  border: "none",
                  borderRadius: "6px",
                  padding: "5px 8px",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                }}
              >
                <span style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "3px",
                  border: active ? "none" : "1px solid rgba(255,255,255,0.15)",
                  background: active ? "#8B5CF6" : "transparent",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  {active && (
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                      <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span style={{ fontSize: "12px", color: active ? "#F0EEFF" : "#8B87A8", fontWeight: active ? 600 : 400 }}>
                  {s}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Company size */}
      <div>
        <label style={{ display: "block", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", marginBottom: "8px" }}>
          Company size
        </label>
        <select
          value={filters.companySize}
          onChange={(e) => onChange({ ...filters, companySize: e.target.value })}
          style={{
            width: "100%",
            background: "#18181D",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "7px",
            padding: "7px 10px",
            color: filters.companySize ? "#F0EEFF" : "#4E4A66",
            fontSize: "12px",
            fontFamily: "inherit",
            cursor: "pointer",
            appearance: "none",
          }}
        >
          <option value="">Any size</option>
          {COMPANY_SIZES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s} employees</option>
          ))}
        </select>
      </div>
    </aside>
  );
}
