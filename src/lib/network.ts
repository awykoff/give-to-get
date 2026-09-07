// src/lib/network.ts
//
// Server-side helpers for the My Network feature.
//
// Privacy rule (PRD §7): user_profiles is permanently walled off from
// contacts. The two tables are read independently here — user_profiles
// supplies the friend's display fields (first/last name, phone, email
// from auth.users via the join), and contacts supplies the friend's
// contributed contacts. The two are NEVER joined together, and neither
// is ever joined into the global contacts search or export path. A
// `getMyAcceptedConnections` join into `contacts` would be a critical
// privacy bug — see the architectural comment in src/lib/types/
// database.types.ts and PRD §7.

import { getWorkspaceContext } from "@/lib/workspace-credits";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Display fields for a friend (the connected workspace's primary
 * admin) as rendered on the My Network page. Pulled from user_profiles
 * + a separate read of auth.users for the email — the two are kept
 * architecturally separate from contacts.
 */
export interface FriendDisplay {
  /** user_profiles.user_id of the friend */
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
}

/**
 * One connection row, with the friend's display fields denormalized
 * onto it. Used by the page-level 'Your connections' section.
 */
export interface AcceptedConnection {
  /** workspace_connections.id */
  id: string;
  /** The friend's workspace (the side that is NOT the caller) */
  friend_workspace_id: string;
  /** The friend's display record (user_profiles + auth.users.email) */
  friend: FriendDisplay;
  created_at: string;
}

/**
 * A pending invite row. `direction` is computed from the caller's
 * workspace — 'incoming' if the caller is the recipient, 'outgoing'
 * if the caller is the requester. The friend fields are still
 * resolved against user_profiles so the page can render
 * "First Last invited you" without a second roundtrip.
 */
export interface PendingInvite {
  id: string;
  direction: "incoming" | "outgoing";
  friend_workspace_id: string;
  friend: FriendDisplay;
  created_at: string;
}

/**
 * Connection rows joined with the friend's display fields, returned
 * to client components. Used for the See Contacts modal's row list.
 */
export interface ConnectionWithFriend {
  id: string;
  /** Workspace id on the friend's side — needed to scope the See Contacts query */
  friend_workspace_id: string;
  friend: FriendDisplay;
  status: string;
  created_at: string;
  responded_at: string | null;
}

/**
 * One row of a friend's contacts, scoped to a single accepted
 * connection. Fields are a subset of the contacts row — enough to
 * render the See Contacts modal without exposing anything that
 * shouldn't be gated behind an accepted connection.
 */
export interface ConnectionContactRow {
  id: string;
  first_name: string;
  last_name: string | null;
  title: string | null;
  company_name: string | null;
  email: string | null;
  work_direct_phone: string | null;
  mobile_phone: string | null;
  corporate_phone: string | null;
  linkedin_url: string | null;
  created_at: string;
}

/**
 * Cursor-based pagination result. `nextCursor` is null when there are
 * no more rows. The cursor itself is opaque to the client (a created_at
 * ISO + id tuple) but a typed shape keeps the modal simple.
 */
export interface ConnectionContactsPage {
  rows: ConnectionContactRow[];
  nextCursor: { created_at: string; id: string } | null;
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

type Supabase = SupabaseClient<any, "public", any>;

/**
 * Resolve the friend workspace's primary admin and pull their
 * user_profiles row + auth.users.email. The query joins
 * workspace_members → user_profiles → auth.users, returning at most
 * one row (the workspace's first admin). The friend's workspace is
 * not contacts — we never JOIN contacts here.
 *
 * If the friend has no user_profiles row yet (Settings not visited),
 * we still return a record with null display fields so the page can
 * render the connection row gracefully.
 */
async function getFriendDisplay(
  supabase: Supabase,
  friendWorkspaceId: string,
): Promise<FriendDisplay> {
  // Pick any member of the friend's workspace. There can be multiple
  // members; we take the first admin (the one with role='admin' and
  // earliest created_at) as the "primary" display. If there are no
  // admins (rare), fall back to the earliest member.
  const { data: member } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", friendWorkspaceId)
    .order("role", { ascending: true }) // 'admin' < 'member' alphabetically
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!member) {
    return {
      user_id: "",
      first_name: null,
      last_name: null,
      email: null,
      phone_number: null,
    };
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("user_id, first_name, last_name, phone_number")
    .eq("user_id", member.user_id)
    .maybeSingle();

  // auth.users.email is only readable by the row owner. For the
  // friend's email we have to fall back to a getUser()-style server
  // call against the service-role client, OR we display
  // "Email hidden" for connections where we can't see it. For MVP we
  // return null and the UI renders "—" — see the page-level note.
  // A future iteration can use a Postgres view that grants
  // workspace_members-of-an-accepted-connection access.
  //
  // Until that lands, we deliberately do NOT call admin.auth.getUserById
  // from this helper — that would require the service-role key on the
  // anon-keyed client and is out of scope. The page still renders a
  // useful row without the email.
  return {
    user_id: member.user_id,
    first_name: profile?.first_name ?? null,
    last_name: profile?.last_name ?? null,
    email: null,
    phone_number: profile?.phone_number ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────

/**
 * All accepted connections for the caller's workspace, with each
 * friend's display fields denormalized onto the row. Ordered by
 * most recently accepted (responded_at) descending, then id as a
 * tiebreaker.
 */
export async function getMyAcceptedConnections(): Promise<AcceptedConnection[]> {
  const { supabase, workspaceId } = await getWorkspaceContext();
  if (!workspaceId) return [];

  // workspace_connections rows where the caller is either side AND
  // status='accepted'. Pull the columns the page actually renders so
  // we don't over-fetch.
  const { data: rows, error } = await supabase
    .from("workspace_connections")
    .select(
      "id, requester_workspace_id, recipient_workspace_id, responded_at, created_at",
    )
    .eq("status", "accepted")
    .or(
      `requester_workspace_id.eq.${workspaceId},recipient_workspace_id.eq.${workspaceId}`,
    )
    .order("responded_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });

  if (error || !rows) return [];

  // For each row, derive the friend's workspace_id (the side that
  // isn't the caller) and resolve their display fields. These reads
  // run sequentially for simplicity — connection counts are small
  // (MVP scale, < 100 per workspace) and parallelizing via
  // Promise.all doesn't materially change wall-clock time at this
  // size.
  const out: AcceptedConnection[] = [];
  for (const r of rows) {
    const friendWorkspaceId =
      r.requester_workspace_id === workspaceId
        ? r.recipient_workspace_id
        : r.requester_workspace_id;
    const friend = await getFriendDisplay(supabase, friendWorkspaceId);
    out.push({
      id: r.id,
      friend_workspace_id: friendWorkspaceId,
      friend,
      created_at: r.created_at,
    });
  }
  return out;
}

/**
 * All pending invites touching the caller's workspace, split into
 * incoming (recipient is the caller — needs accept/decline) and
 * outgoing (requester is the caller — awaiting reply).
 */
export async function getMyPendingInvites(): Promise<{
  incoming: PendingInvite[];
  outgoing: PendingInvite[];
}> {
  const { supabase, workspaceId } = await getWorkspaceContext();
  if (!workspaceId) return { incoming: [], outgoing: [] };

  const { data: rows, error } = await supabase
    .from("workspace_connections")
    .select(
      "id, requester_workspace_id, recipient_workspace_id, created_at",
    )
    .eq("status", "pending")
    .or(
      `requester_workspace_id.eq.${workspaceId},recipient_workspace_id.eq.${workspaceId}`,
    )
    .order("created_at", { ascending: false });

  if (error || !rows) return { incoming: [], outgoing: [] };

  const incoming: PendingInvite[] = [];
  const outgoing: PendingInvite[] = [];
  for (const r of rows) {
    const friendWorkspaceId =
      r.requester_workspace_id === workspaceId
        ? r.recipient_workspace_id
        : r.requester_workspace_id;
    const friend = await getFriendDisplay(supabase, friendWorkspaceId);
    const item: PendingInvite = {
      id: r.id,
      direction: r.recipient_workspace_id === workspaceId ? "incoming" : "outgoing",
      friend_workspace_id: friendWorkspaceId,
      friend,
      created_at: r.created_at,
    };
    if (item.direction === "incoming") incoming.push(item);
    else outgoing.push(item);
  }
  return { incoming, outgoing };
}

/**
 * Single connection row by id, with both workspace ids. Used by
 * route handlers to authorize accept/decline/revoke before issuing
 * the UPDATE. Returns null if the row doesn't exist OR if the
 * caller isn't a member of either side (RLS will already filter
 * the SELECT, but the null-check keeps callers explicit).
 */
export async function getConnectionById(
  id: string,
): Promise<{
  id: string;
  requester_workspace_id: string;
  recipient_workspace_id: string;
  status: "pending" | "accepted" | "declined" | "revoked";
} | null> {
  const { supabase } = await getWorkspaceContext();
  const { data, error } = await supabase
    .from("workspace_connections")
    .select("id, requester_workspace_id, recipient_workspace_id, status")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as any;
}

/**
 * Cursor-paginated contacts query, scoped to a single accepted
 * connection's friend's workspace. Authorization is the caller's
 * responsibility — this helper does NOT verify the caller is part of
 * an accepted connection. The caller (typically the
 * /api/network/contacts/[connectionId]/route.ts route handler) must
 * have already confirmed the connection row and the caller's
 * workspace membership.
 *
 * Sort: (created_at DESC, id DESC) for stable pagination — the
 * `id` tiebreaker matters when many rows share a created_at.
 *
 * Search: optional case-insensitive substring match against
 * first_name, last_name, company_name, and title. Server-side, so a
 * 25-row page renders without sending the full contact list to the
 * client.
 */
export interface SearchConnectionContactsArgs {
  connectionId: string;
  friendWorkspaceId: string;
  cursor?: { created_at: string; id: string } | null;
  searchTerm?: string;
  pageSize?: number;
}

export async function searchConnectionContacts(
  args: SearchConnectionContactsArgs,
): Promise<ConnectionContactsPage> {
  const { supabase } = await getWorkspaceContext();
  const pageSize = Math.min(Math.max(args.pageSize ?? 25, 1), 100);

  let query = supabase
    .from("contacts")
    .select(
      "id, first_name, last_name, title, company_name, email, work_direct_phone, mobile_phone, corporate_phone, linkedin_url, created_at",
    )
    .eq("contributed_by_workspace_id", args.friendWorkspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize);

  // Cursor predicate: rows that come strictly AFTER the cursor in
  // the (created_at DESC, id DESC) ordering. Postgres row ordering
  // with two DESC columns means "after" is:
  //   created_at < cursor.created_at
  //   OR (created_at = cursor.created_at AND id < cursor.id)
  if (args.cursor) {
    const c = args.cursor;
    query = query.or(
      `created_at.lt.${c.created_at},and(created_at.eq.${c.created_at},id.lt.${c.id})`,
    );
  }

  // Search filter — ilike on the four display fields. The escape
  // characters for ilike are '%' and '_'; we strip those from the
  // user input before wrapping in '%...%' so a user typing a
  // literal underscore doesn't get a wildcard match.
  const term = (args.searchTerm ?? "").trim();
  if (term.length > 0) {
    const safe = term.replace(/[%_\\]/g, (m) => "\\" + m);
    const wild = `%${safe}%`;
    query = query.or(
      `first_name.ilike.${wild},last_name.ilike.${wild},company_name.ilike.${wild},title.ilike.${wild}`,
    );
  }

  const { data, error } = await query;
  if (error || !data) {
    return { rows: [], nextCursor: null };
  }

  // If we got a full page, assume there may be a next page and emit
  // the cursor pointing at the last row. If we got fewer than
  // pageSize rows, there are no more rows — emit null.
  const last = data.length === pageSize ? data[data.length - 1] : null;
  const nextCursor = last
    ? { created_at: last.created_at, id: last.id }
    : null;

  return {
    rows: data as ConnectionContactRow[],
    nextCursor,
  };
}