"use client";

import { useRef, useState } from "react";
import { parseCSV, mapHeaders, REQUIRED_FIELDS } from "@/lib/csv";

export interface ParsedFile {
  name: string;
  rows: Record<string, string>[];
  headers: string[];
  mapping: Record<string, string>;
  missingRequired: string[];
}

interface Props {
  onParsed: (result: ParsedFile) => void;
}

export default function UploadZone({ onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);

  const processFile = (file: File) => {
    if (!file.name.endsWith(".csv")) {
      setError("Only .csv files are supported.");
      return;
    }
    setParsing(true);
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);
      const mapping = mapHeaders(headers);
      const mappedFields = new Set(Object.values(mapping));
      const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));
      setParsing(false);
      onParsed({ name: file.name, rows, headers, mapping, missingRequired });
    };
    reader.onerror = () => { setParsing(false); setError("Failed to read the file."); };
    reader.readAsText(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  return (
    <div>
      {/* Drop zone */}
      <div
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "rgba(139,92,246,0.6)" : "rgba(255,255,255,0.1)"}`,
          borderRadius: "10px",
          background: dragging ? "rgba(139,92,246,0.06)" : "#18181D",
          padding: "56px 40px",
          textAlign: "center",
          cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <input ref={inputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={onFileInput} />

        <div style={{ width: "48px", height: "48px", borderRadius: "10px", background: "rgba(139,92,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>

        {parsing ? (
          <p style={{ fontSize: "14px", color: "#8B87A8", margin: 0 }}>Parsing CSV…</p>
        ) : (
          <>
            <p style={{ fontSize: "15px", fontWeight: 600, color: "#F0EEFF", margin: "0 0 6px" }}>
              Drop your CSV here, or <span style={{ color: "#8B5CF6" }}>browse</span>
            </p>
            <p style={{ fontSize: "12px", color: "#4E4A66", margin: 0 }}>
              .csv files only · Required columns: first_name, last_name, email
            </p>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginTop: "12px", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "7px", padding: "10px 14px", color: "#F87171", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {/* Column guide */}
      <div style={{ marginTop: "24px", background: "#18181D", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "20px 22px" }}>
        <p style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4E4A66", margin: "0 0 14px" }}>
          Column reference
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
          {[
            { name: "first_name", req: true },
            { name: "last_name", req: true },
            { name: "email", req: true },
            { name: "title", req: false },
            { name: "company", req: false },
            { name: "vertical", req: false },
            { name: "seniority", req: false },
            { name: "city / state / country", req: false },
            { name: "company_size", req: false },
            { name: "linkedin_url", req: false },
          ].map((col) => (
            <div key={col.name} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{
                fontSize: "10px",
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: "4px",
                background: col.req ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.05)",
                color: col.req ? "#C4B5FD" : "#4E4A66",
              }}>
                {col.req ? "required" : "optional"}
              </span>
              <code style={{ fontSize: "12px", color: "#8B87A8" }}>{col.name}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
