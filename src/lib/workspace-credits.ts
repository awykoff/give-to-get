// src/lib/workspace-credits.ts
//
// Canonical helpers for the "auth + workspace + credits_ledger" chain
// used across the (dashboard) route group. Prior to this module the
// lookup lived inline in three places — the dashboard layout (for the
// topbar credits pill), the dashboard page body (for the stat card),
// and the credits page (for the full ledger entries). That duplication
// was the surface area behind the original "topbar shows 0 while the
// dashboard body shows the real number" bug, where one rendering path
// received a value and the other didn't.
//
// Contract:
//
//   • getWorkspaceCredits() — sum of credits_ledger.amount for the
//     caller's workspace. Returns 0 if the user has no workspace yet.
//     Redirects to /login when there is no authenticated user (same
//     gate as the prior inline code).
//
//   • getWorkspaceLedgerEntries() — full credits_ledger rows for the
//     caller's workspace, newest first. Returns [] when no workspace.
//
//   • getWorkspaceContext() — internal helper. Resolves the authenticated
//     Supabase client, the current user, and the user's workspace_id in
//     one round-trip per (auth, members). Exposed for callers that
//     already need a Supabase client and the workspace id (e.g. the
//     dashboard page which then runs its own imports/exports queries);
//     NOT the recommended entry point if all you need is a number.
//
// Behavior preserved vs. the prior inline code:
//   - Same auth gate (uses the cookie-backed server client).
//   - Same RLS path (no service-role key, reads run as the user).
//   - Same numeric semantics (amount may be negative; sum includes both).
//   - Same freshness — each call is a fresh query; there's no shared
//     per-request cache. Within a single render Next.js may parallelize
//     the layout's call and the page's call; that's fine, both produce
//     the same number.
//
// Not covered:
//   - We do not memoize across requests (no `cache()` wrapper). The
//     credits_ledger grows on every import / export so per-request
//     staleness is the right default. If a page genuinely needs
//     request-scoped memoization, it should opt in itself.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type WorkspaceContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string };
  workspaceId: string | null;
};

/**
 * Resolve the authenticated Supabase client, the current user, and the
 * user's workspace id in one shot. Returns `workspaceId: null` if the
 * user is authenticated but not yet a member of any workspace (which
 * should only happen mid-bootstrap or if the workspace-bootstrap
 * trigger from migration 006 isn't running — see AGENTS.md §9).
 *
 * Redirects to /login when there is no authenticated user. Callers
 * that don't want a hard redirect (rare) should call
 * `createClient()` and `auth.getUser()` themselves instead.
 */
export async function getWorkspaceContext(): Promise<WorkspaceContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .single();

  return {
    supabase,
    user: { id: user.id },
    workspaceId: member?.workspace_id ?? null,
  };
}

/**
 * Sum of credits_ledger.amount for the caller's workspace. Returns 0
 * when there is no user (redirect), no workspace, or no rows. This is
 * the canonical "credits available" number — use it from the topbar,
 * stat cards, anywhere that displays the balance.
 */
export async function getWorkspaceCredits(): Promise<number> {
  const { supabase, workspaceId } = await getWorkspaceContext();
  if (!workspaceId) return 0;

  const { data } = await supabase
    .from("credits_ledger")
    .select("amount")
    .eq("workspace_id", workspaceId);

  return (data ?? []).reduce((sum, row) => sum + (row.amount ?? 0), 0);
}

/**
 * All credits_ledger rows for the caller's workspace, newest first.
 * Returns [] when there is no workspace. The credits page uses this to
 * derive `balance`, `totalEarned`, and `totalSpent` from one query —
 * callers that only need the balance should use `getWorkspaceCredits()`
 * instead, which selects a narrower column set.
 */
export type WorkspaceLedgerEntry = {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  created_at: string;
};

export async function getWorkspaceLedgerEntries(): Promise<WorkspaceLedgerEntry[]> {
  const { supabase, workspaceId } = await getWorkspaceContext();
  if (!workspaceId) return [];

  const { data } = await supabase
    .from("credits_ledger")
    .select("id, amount, type, description, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  return (data ?? []) as WorkspaceLedgerEntry[];
}