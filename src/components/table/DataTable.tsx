// src/components/table/DataTable.tsx
// Shared sortable + drag-reorderable table renderer (Contacts/Companies).
// SERVER-DRIVEN: rows arrive pre-searched/sorted from the 015 RPCs; no
// client-side filter/sort. Controlled by the parent.
// D1: @dnd-kit/core + @dnd-kit/sortable. B1: lucide-react.
// C2: URL cells clickable (target=_blank rel=noopener noreferrer).
// Frozen: checkbox col sticky left:0; first display col sticky left:40px.
"use client";

import { useMemo, type CSSProperties } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Search, Lock, ArrowUp, ArrowDown, ArrowUpDown, GripVertical } from "lucide-react";

import type { ColumnDef } from "@/lib/table/column-defs";
import { SEARCH_CAPTION } from "@/lib/table/column-defs";

type SortDir = "asc" | "desc";
type Row = Record<string, unknown>;

export type SelectionState = {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  someSelected: boolean;
};

export type DataTableProps = {
  columns: ColumnDef[];
  rows: Row[];
  count: number | null;
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  sortKey: string;
  sortDir: SortDir;
  onSort: (k: string) => void;
  columnOrder: string[];
  onColumnOrderChange: (o: string[]) => void;
  query: string;
  onQueryChange: (q: string) => void;
  loading: boolean;
  error: string | null;
  selection?: SelectionState;
  hasGatedColumns?: boolean;
  placeholder?: string;
};

function Checkbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate?: boolean; onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      aria-label="toggle row"
      style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0, padding: 0, cursor: "pointer",
        border: checked || indeterminate ? "none" : "1px solid rgba(255,255,255,0.15)",
        background: checked ? "#8B5CF6" : indeterminate ? "rgba(139,92,246,0.4)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {checked && (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && !checked && (
        <svg width="8" height="2" viewBox="0 0 8 2" fill="none" aria-hidden="true">
          <line x1="0" y1="1" x2="8" y2="1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

const surface = "#18181D";
const muted = "#8B87A8";
const border = "1px solid rgba(255,255,255,0.07)";

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

function CellValue({ value, col }: { value: unknown; col: ColumnDef }) {
  if (col.gated) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: muted, fontSize: 11 }}>
        <Lock size={10} /> Gated
      </span>
    );
  }
  const empty = value === null || value === undefined || value === "" ||
    (Array.isArray(value) && value.length === 0);
  if (empty) return <span style={{ color: muted }}>—</span>;

  switch (col.type) {
    case "bool":
      return value ? <span style={{ color: "#6EE7B7" }}>Yes</span> : <span style={{ color: muted }}>No</span>;
    case "number": {
      const n = coerceNumber(value);
      return n === null ? <span style={{ color: muted }}>—</span> : n.toLocaleString();
    }
    case "date":
      return formatDate(value);
    case "array":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "url": {
      const href = typeof value === "string" ? value : "";
      if (!href) return "—";
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ color: "#8B5CF6", textDecoration: "underline", textUnderlineOffset: 2 }}
        >
          {href}
        </a>
      );
    }
    default:
      return String(value);
  }
}

function SortableHeader({ col, frozenLeft, sortKey, sortDir, onSort }: {
  col: ColumnDef; frozenLeft: number | null; sortKey: string; sortDir: SortDir; onSort: (k: string) => void;
}) {
  const { setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key });
  const active = sortKey === col.key;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: "sticky", top: 0, zIndex: frozenLeft !== null ? 2 : 1,
    background: surface,
    padding: "10px 14px", textAlign: "left",
    fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
    color: active ? "#C4B5FD" : muted,
    whiteSpace: "nowrap", minWidth: col.width || 140,
    borderBottom: border,
  };
  if (frozenLeft !== null) {
    style.left = frozenLeft;
    style.boxShadow = "2px 0 4px rgba(0,0,0,0.3)";
  }
  return (
    <th ref={setNodeRef} style={style} scope="col">
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "grab" }}>
        <GripVertical size={11} style={{ opacity: 0.35, flexShrink: 0 }} />
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSort(col.key); }}
          aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: "transparent", border: "none", padding: 0,
            font: "inherit", color: "inherit", cursor: "pointer",
          }}
        >
          {col.label}
        </button>
        <span style={{ display: "inline-flex" }}>
          {active ? (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} style={{ opacity: 0.25 }} />}
        </span>
      </div>
    </th>
  );
}

export default function DataTable(props: DataTableProps) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));
  const colByKey = useMemo(
    () => Object.fromEntries(props.columns.map((c) => [c.key, c])),
    [props.columns]
  );
  const orderedColumns = props.columnOrder.map((k) => colByKey[k]).filter(Boolean) as ColumnDef[];
  const hasSelection = !!props.selection;
  const colSpan = orderedColumns.length + (hasSelection ? 1 : 0);
  const trimmedQuery = props.query.trim();
  const queryHasAt = trimmedQuery.includes("@");
  const isCompleteEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedQuery);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const oldIdx = props.columnOrder.indexOf(active.id as string);
      const newIdx = props.columnOrder.indexOf(over.id as string);
      props.onColumnOrderChange(arrayMove(props.columnOrder, oldIdx, newIdx));
    }
  }

  const headerCells = orderedColumns.map((col, idx) => (
    <SortableHeader
      key={col.key}
      col={col}
      // Freeze the first display column at left:0 (no checkbox) or left:40
      // (checkbox present) so row identity stays visible while scrolling.
      frozenLeft={idx === 0 ? (hasSelection ? 40 : 0) : null}
      sortKey={props.sortKey}
      sortDir={props.sortDir}
      onSort={props.onSort}
    />
  ));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* search + caption + count */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 420 }}>
          <div style={{ position: "relative", width: 340, maxWidth: "100%" }}>
            <Search size={14} style={{ position: "absolute", left: 11, top: 10, color: muted }} />
            <input
              value={props.query}
              onChange={(e) => props.onQueryChange(e.target.value)}
              placeholder={props.placeholder ?? "Search..."}
              aria-label={props.hasGatedColumns ? "Search contacts. Paste a full email for an exact match." : "Search"}
              style={{
                width: "100%", boxSizing: "border-box",
                background: surface, border, borderRadius: 8,
                padding: "8px 12px 8px 32px", color: "#F0EEFF", fontSize: 13,
                fontFamily: "inherit", outline: "none",
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: muted, paddingLeft: 2, lineHeight: 1.5 }}>{SEARCH_CAPTION}</div>
          {props.hasGatedColumns && queryHasAt && !isCompleteEmail && (
            <div style={{ fontSize: 11, color: muted, paddingLeft: 2 }}>
              Keep typing the full address &mdash; partial email text won&apos;t match, only a complete one.
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: muted, whiteSpace: "nowrap" }}>
          {props.count === null ? "" : `${props.count.toLocaleString()} result${props.count === 1 ? "" : "s"}`}
          <span style={{ marginLeft: 8 }}>&middot; drag a header to reorder, click to sort</span>
        </div>
      </div>

      {props.error && (
        <div style={{ padding: "12px 14px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, color: "#FCA5A5", fontSize: 13 }}>
          {props.error}
        </div>
      )}

      <div style={{ background: surface, border, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ overflow: "auto", maxHeight: 560 }}>
          <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <thead>
                <tr>
                  {props.selection && (
                    <th scope="col" aria-label="select all" style={{ position: "sticky", left: 0, zIndex: 3, width: 40, minWidth: 40, padding: "10px 12px 10px 16px", background: surface, borderBottom: border }}>
                      <Checkbox checked={props.selection.allSelected} indeterminate={props.selection.someSelected} onChange={props.selection.onToggleAll} />
                    </th>
                  )}
                  <SortableContext items={props.columnOrder} strategy={horizontalListSortingStrategy}>
                    {headerCells}
                  </SortableContext>
                </tr>
              </thead>
            </DndContext>
            <tbody>
              {props.loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    {props.selection && <td style={{ position: "sticky", left: 0, background: surface, zIndex: 2, width: 40, minWidth: 40 }} />}
                    {orderedColumns.map((c, idx) => (
                      <td
                        key={c.key}
                        style={{
                          padding: "10px 14px",
                          ...(idx === 0 ? {
                            position: "sticky" as const,
                            left: hasSelection ? 40 : 0,
                            background: surface,
                            zIndex: 1,
                          } : {}),
                        }}
                      >
                        <div style={{ height: 12, borderRadius: 4, background: "rgba(255,255,255,0.05)", width: `${50 + ((i * 7) % 40)}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : props.rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} style={{ padding: "48px 20px", textAlign: "center", color: muted, fontSize: 13 }}>
                    {trimmedQuery ? `No results match \u201C${trimmedQuery}\u201D.` : "No matches yet."}
                  </td>
                </tr>
              ) : (
                props.rows.map((row) => (
                  <tr key={String(row.id)} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    {props.selection && (
                      <td style={{ position: "sticky", left: 0, background: surface, zIndex: 2, width: 40, minWidth: 40, padding: "0 12px 0 16px", borderRight: border }} onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={props.selection.selected.has(String(row.id))} onChange={() => props.selection!.onToggle(String(row.id))} />
                      </td>
                    )}
                    {orderedColumns.map((col, idx) => (
                      <td
                        key={col.key}
                        style={{
                          padding: "9px 14px", fontSize: 12.5, color: "#F0EEFF",
                          whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden",
                          textOverflow: "ellipsis",
                          // Freeze the first display column so row identity stays
                          // visible on horizontal scroll (matches frozen <th>).
                          ...(idx === 0 ? {
                            position: "sticky" as const,
                            left: hasSelection ? 40 : 0,
                            background: surface,
                            zIndex: 1,
                          } : {}),
                        }}
                      >
                        <CellValue value={row[col.key]} col={col} />
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {props.count !== null && props.totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={() => props.onPageChange(Math.max(0, props.page - 1))} disabled={props.page === 0}
            style={{ background: "transparent", border, borderRadius: 5, padding: "4px 10px", color: props.page === 0 ? "#4E4A66" : "#F0EEFF", fontSize: 12, cursor: props.page === 0 ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            &larr;
          </button>
          <span style={{ fontSize: 12, color: muted }}>{props.page + 1} / {props.totalPages}</span>
          <button onClick={() => props.onPageChange(Math.min(props.totalPages - 1, props.page + 1))} disabled={props.page >= props.totalPages - 1}
            style={{ background: "transparent", border, borderRadius: 5, padding: "4px 10px", color: props.page >= props.totalPages - 1 ? "#4E4A66" : "#F0EEFF", fontSize: 12, cursor: props.page >= props.totalPages - 1 ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            &rarr;
          </button>
        </div>
      )}
    </div>
  );
}