"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ContactFilters } from "./FilterPanel";

const PAGE_SIZE = 50;

const VERTICAL_COLORS: Record<string, { bg: string; text: string }> = {
  SaaS:        { bg: "rgba(139,92,246,0.18)",  text: "#C4B5FD" },
  FinTech:     { bg: "rgba(52,211,153,0.15)",  text: "#6EE7B7" },
  MarTech:     { bg: "rgba(251,191,36,0.15)",  text: "#FDE68A" },
  "Data & AI": { bg: "rgba(96,165,250,0.15)",  text: "#93C5FD" },
  HRTech:      { bg: "rgba(248,113,113,0.15)", text: "#FCA5A5" },
  HealthTech:  { bg: "rgba(52,211,153,0.12)",  text: "#6EE7B7" },
  Other:       { bg: "rgba(255,255,255,0.07)", text: "#8B87A8" },
};

interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company_name: string | null;
  vertical: string | null;
  seniority: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  company_size: string | null;
}

interface Props {
  filters: ContactFilters;
  onSelectionChange: (ids: string[]) => void;
}

const COLS = ["Name", "Title", "Company", "Vertical", "Seniority", "Location", "Co. size", "Email"];

export default function ContactsTable({ filters, onSelectionChange }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchContacts = useCallback(async (pageNum: number) => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, title, company_name, vertical, seniority, city, state, country, company_size",
        { count: "exact" }
      )
      .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)
      .order("created_at", { ascending: false });

    if (filters.verticals.length > 0) {
      query = query.in("vertical", filters.verticals);
    }
    if (filters.seniorities.length > 0) {
      query = query.in("seniority", filters.seniorities);
    }
    if (filters.companySize) {
      query = query.eq("company_size", filters.companySize);
    }
    if (filters.location) {
      query = query.or(
        `city.ilike.%${filters.location}%,state.ilike.%${filters.location}%,country.ilike.%${filters.location}%`
      );
    }

    const { data, count } = await query;
    setContacts(data ?? []);
    setTotal(count ?? 0);
    setLoading(false);
    setSelected(new Set());
  }, [filters]);

  useEffect(() => {
    setPage(0);
    fetchContacts(0);
  }, [filters, fetchContacts]);

  useEffect(() => {
    if (page > 0) fetchContacts(page);
  }, [page, fetchContacts]);

  useEffect(() => {
    onSelectionChange(Array.from(selected));
  }, [selected, onSelectionChange]);

  const allSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        contacts.forEach((c) => next.delete(c.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        contacts.forEach((c) => next.add(c.id));
        return next;
      });
    }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const location = (c: Contact) =>
    [c.city, c.state, c.country].filter(Boolean).join(", ") || "—";

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Results bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "12px", color: "#4E4A66" }}>
          {loading ? "Loading…" : `${total.toLocaleString()} contacts`}
          {selected.size > 0 && (
            <span style={{ color: "#C4B5FD", marginLeft: "10px", fontWeight: 600 }}>
              {selected.size} selected
            </span>
          )}
        </span>
        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "5px", padding: "4px 10px", color: page === 0 ? "#4E4A66" : "#F0EEFF", fontSize: "12px", cursor: page === 0 ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              ←
            </button>
            <span style={{ fontSize: "12px", color: "#8B87A8" }}>
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "5px", padding: "4px 10px", color: page >= totalPages - 1 ? "#4E4A66" : "#F0EEFF", fontSize: "12px", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              →
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                {/* Select all */}
                <th style={{ width: "40px", padding: "10px 12px 10px 16px" }}>
                  <Checkbox checked={allSelected} indeterminate={selected.size > 0 && !allSelected} onChange={toggleAll} />
                </th>
                {COLS.map((col) => (
                  <th key={col} style={{
                    padding: "10px 12px",
                    textAlign: "left",
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "#4E4A66",
                    whiteSpace: "nowrap",
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "10px 12px 10px 16px" }} />
                    {COLS.map((c) => (
                      <td key={c} style={{ padding: "10px 12px" }}>
                        <div style={{ height: "12px", borderRadius: "4px", background: "rgba(255,255,255,0.05)", width: `${50 + Math.random() * 40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length + 1} style={{ padding: "48px 20px", textAlign: "center", color: "#4E4A66", fontSize: "13px" }}>
                    No contacts match your filters.
                  </td>
                </tr>
              ) : (
                contacts.map((c) => {
                  const isSelected = selected.has(c.id);
                  const vColors = c.vertical ? (VERTICAL_COLORS[c.vertical] ?? VERTICAL_COLORS.Other) : null;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => toggleRow(c.id)}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        background: isSelected ? "rgba(139,92,246,0.06)" : "transparent",
                        cursor: "pointer",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgba(139,92,246,0.04)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = isSelected ? "rgba(139,92,246,0.06)" : "transparent";
                      }}
                    >
                      <td style={{ padding: "0 12px 0 16px", width: "40px" }} onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSelected} onChange={() => toggleRow(c.id)} />
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "13px", color: "#F0EEFF", whiteSpace: "nowrap", fontWeight: 500 }}>
                        {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "13px", color: "#8B87A8", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.title ?? "—"}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "13px", color: "#8B87A8", maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.company_name ?? "—"}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {vColors && c.vertical ? (
                          <span style={{ fontSize: "11px", fontWeight: 600, background: vColors.bg, color: vColors.text, borderRadius: "5px", padding: "2px 8px", whiteSpace: "nowrap" }}>
                            {c.vertical}
                          </span>
                        ) : <span style={{ color: "#4E4A66", fontSize: "13px" }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "12px", color: "#8B87A8", whiteSpace: "nowrap" }}>
                        {c.seniority ?? "—"}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "12px", color: "#8B87A8", whiteSpace: "nowrap" }}>
                        {location(c)}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "12px", color: "#8B87A8", whiteSpace: "nowrap" }}>
                        {c.company_size ?? "—"}
                      </td>
                      {/* Email — always gated */}
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#4E4A66" }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          Gated
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      style={{
        width: "16px",
        height: "16px",
        borderRadius: "4px",
        border: checked || indeterminate ? "none" : "1px solid rgba(255,255,255,0.15)",
        background: checked ? "#8B5CF6" : indeterminate ? "rgba(139,92,246,0.4)" : "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        padding: 0,
      }}
    >
      {checked && (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
          <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && !checked && (
        <svg width="8" height="2" viewBox="0 0 8 2" fill="none">
          <line x1="0" y1="1" x2="8" y2="1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
