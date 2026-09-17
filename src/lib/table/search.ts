// src/lib/table/search.ts
// ---------------------------------------------------------------------------
// Data-layer for the Contacts/Companies tables.
//
// All reads go through the migration-015 SECURITY DEFINER RPCs
// (search_contacts / search_companies), which do the search + sort + limit/
// offset server-side and return SETOF contacts/companies. The RPC's own
// internal ORDER BY (including the c.id ASC tiebreaker) FULLY controls
// result order — we NEVER append a client-side .order() on top, because
// PostgREST would wrap the already-sorted output in a second, contradictory
// ORDER BY that could undo the tiebreaker.
//
// Count: the search RPCs return the PAGE, not the grand total (015 puts
// LIMIT p_limit inside the body, so count:"exact" sees only the limited
// set). The grand total comes from the companion count RPCs added in
// migration 016: search_contacts_count(p_query) / search_companies_count(p_query),
// verified against production 2026-09-13 (contacts '' -> 11,475 == count(*);
// 'marketing' -> 226 == manual count(*) with identical WHERE; companies table
// is empty so '' -> 0 == count(*) == 0).
//
// The count depends ONLY on p_query — not sort column, not direction, not
// page. We therefore cache it per distinct query string and reuse it across
// page-turn and sort-header changes for the same query, so a user clicking
// through pages or headers triggers no count refetch. The RPC signature
// enforces this (it accepts only p_query; there is no slot to pass a page
// number into), and the Map below makes the client honor the same rule.
//
// NO network-contributed-row exclusion here — PR #20 merged network-partner
// contacts into the general pool. Migration 015's WHERE has zero workspace
// logic and we keep it that way.
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/client";
import {
  CONTACT_PROJECTION,
  COMPANY_PROJECTION,
  CONTACT_COLUMNS,
  COMPANY_COLUMNS,
} from "@/lib/table/column-defs";

export const CONTACT_PAGE_SIZE = 50;
export const COMPANY_PAGE_SIZE = 50;

type SearchParams = {
  query: string;
  page: number; // 0-based
  pageSize: number;
  sortColumn: string;
  sortAscending: boolean;
  /** Optional list-name filter (migration 019 p_list). When set, results
   *  and the count are restricted to rows tagged in that list. */
  p_list?: string | null;
};

export type SortDir = "asc" | "desc";

export type ContactRow = Record<string, unknown> & { id: string };
export type CompanyRow = Record<string, unknown> & { id: string };

// Sort-whitelist coverage: every displayed column must exist in migration
// 015's ORDER BY CASE whitelist, or clicking its header silently falls back
// to created_at (the 22/60 gap this codebase already suffered once). 015's
// shipped whitelists are COMPLETE (contacts: all 60 sortable CASE keys;
// companies: all 33). This assert guards against a future column def being
// added to CONTACT_COLUMNS/COMPANY_COLUMNS without a matching RPC CASE key —
// it fails fast at fetch time instead of silently no-op'ing a header.
const CONTACT_SORT_KEYS = new Set(CONTACT_COLUMNS.map((c) => c.key));
const COMPANY_SORT_KEYS = new Set(COMPANY_COLUMNS.map((c) => c.key));

function assertValidSortKey(kind: "contacts" | "companies", sortColumn: string) {
  const whitelist = kind === "contacts" ? CONTACT_SORT_KEYS : COMPANY_SORT_KEYS;
  if (!whitelist.has(sortColumn)) {
    throw new Error(
      `${kind}: unsupported sort column "${sortColumn}" is not in the ${kind} column defs — ` +
        `add it to 015's ORDER BY whitelist before shipping.`
    );
  }
}

// ── Count RPCs (migration 016) ──────────────────────────────────────────
// Count depends ONLY on p_query. Cache per distinct query string so a page
// turn or sort-header change for the same query never refetches it. The
// cache is in-memory per page-load; a full reload naturally re-queries.
const countCache = new Map<string, number>();

async function getCount(rpcName: string, query: string, p_list?: string | null): Promise<number> {
  // Count depends on BOTH the query and (when filtering) the list. Include the
  // list in the key so a filtered view never reuses an unfiltered count.
  const key = rpcName + "\u0000" + (p_list ?? "") + "\u0000" + query;
  const cached = countCache.get(key);
  if (cached !== undefined) return cached;
  const supabase = createClient();
  const { data, error } = await supabase.rpc(rpcName, { p_query: query, p_list: p_list ?? null });
  if (error) throw error;
  const n = typeof data === "number" ? data : 0;
  countCache.set(key, n);
  return n;
}

function getContactCount(query: string, p_list?: string | null): Promise<number> {
  return getCount("search_contacts_count", query, p_list);
}

function getCompanyCount(query: string, p_list?: string | null): Promise<number> {
  return getCount("search_companies_count", query, p_list);
}

export async function searchContacts(
  params: SearchParams
): Promise<{ data: ContactRow[]; count: number | null }> {
  assertValidSortKey("contacts", params.sortColumn);
  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_contacts", {
    p_query: params.query,
    p_limit: params.pageSize,
    p_offset: params.page * params.pageSize,
    p_sort_column: params.sortColumn,
    p_sort_ascending: params.sortAscending,
    p_list: params.p_list ?? null,
  });

  if (error) throw error;

  // Project to id + contributed_by_workspace_id + non-gated columns so
  // gated emails never enter the client payload (015 returns SELECT c.*,
  // which WOULD include email/email_normalized/etc.).
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const out: Record<string, unknown> = { id: r["id"] };
    for (const key of CONTACT_PROJECTION) {
      if (key === "id") continue;
      out[key] = r[key];
    }
    return out as ContactRow;
  });

  const count = await getContactCount(params.query, params.p_list);

  return { data: rows, count };
}

export async function searchCompanies(
  params: SearchParams
): Promise<{ data: CompanyRow[]; count: number | null }> {
  assertValidSortKey("companies", params.sortColumn);
  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_companies", {
    p_query: params.query,
    p_limit: params.pageSize,
    p_offset: params.page * params.pageSize,
    p_sort_column: params.sortColumn,
    p_sort_ascending: params.sortAscending,
    p_list: params.p_list ?? null,
  });

  if (error) throw error;

  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const out: Record<string, unknown> = { id: r["id"] };
    for (const key of COMPANY_PROJECTION) {
      if (key === "id") continue;
      out[key] = r[key];
    }
    return out as CompanyRow;
  });

  const count = await getCompanyCount(params.query, params.p_list);

  return { data: rows, count };
}