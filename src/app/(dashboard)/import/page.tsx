"use client";

import { useState } from "react";
import UploadZone, { type ParsedFile } from "@/components/import/UploadZone";
import ImportReview, { type ImportResult } from "@/components/import/ImportReview";

type Stage = "upload" | "review" | "done";

export default function ImportPage() {
  const [stage, setStage] = useState<Stage>("upload");
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleParsed = (file: ParsedFile) => {
    setParsedFile(file);
    setStage("review");
  };

  const handleComplete = (res: ImportResult) => {
    setResult(res);
    setStage("done");
  };

  return (
    <div style={{ maxWidth: "680px" }}>
      {stage === "upload" && (
        <UploadZone onParsed={handleParsed} />
      )}

      {stage === "review" && parsedFile && (
        <ImportReview
          file={parsedFile}
          onBack={() => setStage("upload")}
          onComplete={handleComplete}
        />
      )}

      {stage === "done" && result && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Success header */}
          <div style={{ background: "#18181D", border: "1px solid rgba(52,211,153,0.25)", borderRadius: "10px", padding: "28px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "20px" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "rgba(52,211,153,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "#F0EEFF" }}>Import complete</div>
                <div style={{ fontSize: "12px", color: "#4E4A66" }}>Credits have been added to your balance</div>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
              <div style={{ background: "rgba(52,211,153,0.08)", borderRadius: "8px", padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", fontWeight: 700, color: "#34D399", letterSpacing: "-0.02em" }}>
                  +{result.new_contacts_count.toLocaleString()}
                </div>
                <div style={{ fontSize: "11px", color: "#6EE7B7", marginTop: "4px" }}>credits earned</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", fontWeight: 700, color: "#8B87A8", letterSpacing: "-0.02em" }}>
                  {result.duplicate_count.toLocaleString()}
                </div>
                <div style={{ fontSize: "11px", color: "#4E4A66", marginTop: "4px" }}>duplicates skipped</div>
              </div>
              <div style={{ background: result.invalid_count > 0 ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", fontWeight: 700, color: result.invalid_count > 0 ? "#F87171" : "#4E4A66", letterSpacing: "-0.02em" }}>
                  {result.invalid_count.toLocaleString()}
                </div>
                <div style={{ fontSize: "11px", color: result.invalid_count > 0 ? "#FCA5A5" : "#4E4A66", marginTop: "4px" }}>invalid / personal</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => { setStage("upload"); setParsedFile(null); setResult(null); }}
              style={{ background: "#8B5CF6", border: "none", borderRadius: "7px", padding: "9px 18px", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Import another file
            </button>
            <a href="/contacts" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "7px", padding: "9px 18px", color: "#F0EEFF", fontSize: "13px", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Browse contacts →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
