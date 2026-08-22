"use client";

import { useState } from "react";
import { REQUIRED_FIELDS, OPTIONAL_FIELDS } from "@/lib/csv";
import type { ParsedFile } from "./UploadZone";

export interface ImportResult {
  new_contacts_count: number;
  duplicate_count: number;
  invalid_count: number;
  credits_earned: number;
}

interface Props {
  file: ParsedFile;
  onBack: () => void;
  onComplete: (result: ImportResult) => void;
}

export default function ImportReview({ file, onBack, onComplete }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const mappedFields = new Set(Object.values(file.mapping));
  const foundRequired = REQUIRED_FIELDS.filter((f) => mappedFields.has(f));
  const foundOptional = OPTIONAL_FIELDS.filter((f) => mappedFields.has(f));
  const canSubmit = file.missingRequired.length === 0 && file.rows.length > 0;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: file.rows, mapping: file.mapping, fileName: file.name }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: "Upload failed." }));
        throw new Error(msg ?? "Upload failed.");
      }
      const result: ImportResult = await res.json();
      onComplete(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  };

  // Preview first 5 rows using the mapped field names
  const previewCols = [...REQUIRED_FIELDS, ...foundOptional].slice(0, 6);
  const reverseMap: Record<string, string> = {};
  for (const [raw, canonical] of Object.entries(file.mapping)) reverseMap[canonical] = raw;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button
          onClick={onBack}
          style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "7px", padding: "6px 12px", color: "#8B87A8", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}
        >
          ← Back
        </button>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#F0EEFF" }}>{file.name}</div>
          <div style={{ fontSize: "12px", color: "#4E4A66" }}>{file.rows.length.toLocaleString()} rows detected</div>
        </div>
      </div>

      {/* Missing required columns error */}
      {file.missingRequired.length > 0 && (
        <div style={{ background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "7px", padding: "12px 16px" }}>
          <p style={{ fontSize: "13px", fontWeight: 600, color: "#F87171", margin: "0 0 6px" }}>
            Missing required columns
          </p>
          <p style={{ fontSize: "12px", color: "#F87171", margin: 0, opacity: 0.8 }}>
            Your CSV must include: <code>{file.missingRequired.join(", ")}</code>. Rename the columns and re-upload.
          </p>
        </div>
      )}

      {/* Column detection */}
      <div style={{ background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "20px 22px" }}>
        <p style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", margin: "0 0 14px" }}>
          Column detection
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {REQUIRED_FIELDS.map((f) => {
            const found = mappedFields.has(f);
            return (
              <span key={f} style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 9px",
                borderRadius: "5px",
                background: found ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.10)",
                color: found ? "#6EE7B7" : "#F87171",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}>
                {found ? "✓" : "✗"} {f}
              </span>
            );
          })}
          {foundOptional.map((f) => (
            <span key={f} style={{ fontSize: "11px", fontWeight: 600, padding: "3px 9px", borderRadius: "5px", background: "rgba(139,92,246,0.12)", color: "#C4B5FD" }}>
              + {f}
            </span>
          ))}
        </div>
      </div>

      {/* Preview table */}
      {canSubmit && file.rows.length > 0 && (
        <div style={{ background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66" }}>
              Preview — first 5 rows
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  {previewCols.map((col) => (
                    <th key={col} style={{ padding: "8px 14px", textAlign: "left", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", whiteSpace: "nowrap" }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {file.rows.slice(0, 5).map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    {previewCols.map((col) => {
                      const rawKey = reverseMap[col];
                      const val = rawKey ? row[rawKey] : "";
                      return (
                        <td key={col} style={{ padding: "9px 14px", fontSize: "12px", color: val ? "#F0EEFF" : "#4E4A66", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {val || "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "7px", padding: "10px 14px", color: "#F87171", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {/* Submit */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          style={{
            background: canSubmit ? "#8B5CF6" : "rgba(139,92,246,0.3)",
            border: "none",
            borderRadius: "7px",
            padding: "10px 22px",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Uploading…" : `Import ${file.rows.length.toLocaleString()} contacts`}
        </button>
        <span style={{ fontSize: "12px", color: "#4E4A66" }}>
          Personal email domains are filtered automatically
        </span>
      </div>
    </div>
  );
}
