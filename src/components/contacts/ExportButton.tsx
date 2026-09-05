"use client";

import { useState } from "react";
import ExportModal from "./ExportModal";

interface Props {
  selectedIds: string[];
  onComplete: () => void;
}

// "Export N contacts" button. Disabled when nothing is selected.
// Owns the open/close state of the ExportModal and the "after success"
// callback that the contacts page uses to clear its selection.
export default function ExportButton({ selectedIds, onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const count = selectedIds.length;
  const disabled = count === 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        style={{
          background: disabled ? "rgba(139,92,246,0.25)" : "#8B5CF6",
          border: "none",
          borderRadius: "7px",
          padding: "7px 14px",
          color: "#fff",
          fontSize: "13px",
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          opacity: disabled ? 0.7 : 1,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        {disabled ? "Export selected" : `Export ${count} ${count === 1 ? "contact" : "contacts"}`}
      </button>

      {open && (
        <ExportModal
          selectedIds={selectedIds}
          onClose={() => setOpen(false)}
          onComplete={() => {
            setOpen(false);
            onComplete();
          }}
        />
      )}
    </>
  );
}
