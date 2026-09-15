// src/lib/table/useColumnOrder.ts
// ---------------------------------------------------------------------------
// localStorage column-order persistence with a stale-order guard.
//
// On read:
//   1. filter out any saved key that isn't in the current column set
//      (columns removed from schema since the user last visited);
//   2. append any current-set keys that aren't in the saved order
//      (columns added since the user last visited);
//   3. if the result is empty or exactly matches the default order, use the
//      default (prevents persisting a degenerately-empty order).
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";

export function useColumnOrder(
  storageKey: string,
  defaultOrder: readonly string[]
): [string[], (order: string[]) => void] {
  const [order, setOrder] = useState<string[]>(() => {
    const currentKeys = [...defaultOrder];

    if (typeof window === "undefined") return currentKeys;

    let saved: string[] | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) saved = parsed.filter((k) => typeof k === "string");
      }
    } catch {
      saved = null; // corrupt entry -> ignore, fall through to default
    }

    if (!saved) return currentKeys;

    const validKeys = saved.filter((k) => currentKeys.includes(k));
    const missingKeys = currentKeys.filter((k) => !validKeys.includes(k));
    const merged = [...validKeys, ...missingKeys];

    // Degenerate guard: if the merge lost set-size parity, fall back.
    if (merged.length !== currentKeys.length) return currentKeys;
    // If it exactly reproduces the default, don't persist/use a redundant blob.
    if (merged.every((k, i) => k === currentKeys[i])) return currentKeys;

    return merged;
  });

  const setColumnOrder = useCallback(
    (next: string[]) => {
      setOrder(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage full/blocked — non-fatal, just won't persist */
      }
    },
    [storageKey]
  );

  return [order, setColumnOrder];
}