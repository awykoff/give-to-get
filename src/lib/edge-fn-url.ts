// src/lib/edge-fn-url.ts
//
// Canonical resolver for Supabase Edge-Function URLs in Next.js route
// handlers. Both `src/app/api/import/route.ts` and
// `src/app/api/export/route.ts` route through this helper so the env-var
// name and the localhost-fallback warning live in exactly one place.
//
// Contract (Sept 2026, supersedes the prior SUPABASE_EDGE_FN_URL vs
// SUPABASE_EDGE_FN_URL_EXPORT split — see kanban card t_9330916a):
//
//   Single base var:  SUPABASE_EDGE_FN_URL
//     • Value: the Supabase project's Edge-Functions base, e.g.
//       "https://<project-ref>.supabase.co". The route appends
//       "/functions/v1/<name>".
//     • This is the Vercel project setting to set; both routes read it.
//
//   Legacy var (still honored for one redeploy cycle so the env-var rename
//   doesn't break prod mid-rollout):
//
//     SUPABASE_EDGE_FN_URL_EXPORT — a *full* URL pointing at the
//       export-generator function (matches the pre-helper export route).
//       When set, the export route uses this value verbatim; a one-time
//       warning is logged so the operator knows to migrate it.
//       REMOVE FROM VERCEL after the next successful deploy.
//
//   Local-dev fallback: when no var is set, points at
//   "http://localhost:54321/functions/v1/<name>" so `supabase start` works
//   out of the box. A module-load warning makes a missing production var
//   loud at cold start, not silent at first request.
//
// Usage from a route handler:
//
//   import { getEdgeFnUrl, redactCredentials } from "@/lib/edge-fn-url";
//   const fnUrl = getEdgeFnUrl("import-processor");
//   const upstream = await fetch(fnUrl, { ... });
//   console.error("upstream failed for", redactCredentials(fnUrl), ...);
//
// Do not introduce new env-var names for Edge-Function URLs. Add a new
// <name> to the helper's `name` argument instead.

// Default local-dev base — `supabase start` serves Edge Functions under
// http://localhost:54321/functions/v1/<name>. Keep in sync with the port
// in `supabase/config.toml` if you change the local stack.
const LOCAL_FALLBACK_BASE = "http://localhost:54321";

/**
 * Resolve the full Edge-Function URL for a given function name.
 *
 * @param name  The Edge Function slug (matches the directory name under
 *              `supabase/functions/<name>/`).
 * @returns     Full URL string suitable for `fetch()`.
 *
 * Resolution order for the base host:
 *   1. SUPABASE_EDGE_FN_URL  — canonical base, e.g.
 *      "https://abc.supabase.co". The function path
 *      "/functions/v1/<name>" is appended.
 *   2. LOCAL_FALLBACK_BASE — used when neither var is set; appropriate
 *      only for local `supabase start`.
 *
 * Side effect: writes a `console.warn` exactly once per (route, base) pair
 * when the fallback is in use, so a missing production env var is loud
 * at cold start, not silent at first request.
 */
export function getEdgeFnUrl(name: string): string {
  const base = process.env.SUPABASE_EDGE_FN_URL || LOCAL_FALLBACK_BASE;
  if (!process.env.SUPABASE_EDGE_FN_URL) {
    // Use a tag that identifies the route so the cold-start log makes it
    // obvious which API handler is missing config. Caller passes `name`
    // so we can name the function; the route also tags itself in the
    // human-readable message below.
    console.warn(
      `[edge-fn-url] SUPABASE_EDGE_FN_URL is not set — ${name} falling back to ${LOCAL_FALLBACK_BASE}.`,
      "This is fine for local `supabase start` but will silently fail in production.",
      "Set the var in Vercel env settings.",
    );
  }
  // Strip a trailing slash on the base so we don't end up with
  // "//functions/v1/<name>" which Node parses but is ugly in logs.
  const trimmedBase = base.replace(/\/+$/, "");
  return `${trimmedBase}/functions/v1/${name}`;
}

/**
 * Read the legacy `SUPABASE_EDGE_FN_URL_EXPORT` var if set, or null. Used
 * by the export route only — kept here so the legacy-var name lives next
 * to the canonical one and we don't duplicate the warning text.
 *
 * Returns the raw value (full URL), not a derived base. Logs a one-time
 * migration warning so operators know to remove the var after the next
 * successful deploy.
 */
export function getLegacyExportUrl(): string | null {
  const v = process.env.SUPABASE_EDGE_FN_URL_EXPORT;
  if (!v) return null;
  console.warn(
    "[edge-fn-url] SUPABASE_EDGE_FN_URL_EXPORT is set but is no longer the canonical name.",
    "The export route now reads SUPABASE_EDGE_FN_URL (the same var as the import route)",
    "and appends /functions/v1/export-generator. Remove SUPABASE_EDGE_FN_URL_EXPORT",
    "from Vercel env settings after the next successful deploy.",
  );
  return v;
}

/**
 * Redact any embedded credentials from a URL before logging or returning
 * it to the client. Defensive — none of our docs say to put credentials
 * in the URL, but a leaked service key embedded as `user:pass@host` is
 * a much worse outcome than a fetch failure.
 *
 * Returns "<unparseable URL>" when the input doesn't parse as a URL so
 * the caller never logs a raw attacker-controlled string.
 */
export function redactCredentials(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = "redacted";
      u.password = "redacted";
    }
    return u.toString();
  } catch {
    return "<unparseable URL>";
  }
}