// src/app/api/network/invites/route.ts
//
// POST /api/network/invites
//   Body: { recipient_email: string }
//   Resolves the email to a workspace_members row, creates a pending
//   workspace_connections row, and returns it. The requester_workspace_id
//   is the caller's workspace (from getWorkspaceContext). The
//   requester MUST NOT be a member of the recipient's workspace (PRD:
//   mutual acceptance -- can't connect to yourself).
//
// GET /api/network/invites
//   Returns the caller's pending invites split into incoming and
//   outgoing, matching the shape of src/lib/network.ts getMyPendingInvites.
//
// Privacy: never touches contacts. Reads from workspace_members (RLS
// gates to co-members of caller's workspace) and writes to
// workspace_connections (RLS pins auth.uid() to requested_by via
// the insert policy; see 008_workspace_connections.sql).

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/workspace-credits";
import { getMyPendingInvites } from "@/lib/network";
import { sendInviteEmail } from "@/lib/email/smtp";

export async function GET() {
  try {
    const invites = await getMyPendingInvites();
    return NextResponse.json(invites);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load invites" },
      { status: 500 },
    );
  }
}

interface PostBody {
  recipient_email?: unknown;
}

export async function POST(req: NextRequest) {
  const { supabase, workspaceId: callerWorkspaceId, user } = await getWorkspaceContext();
  if (!callerWorkspaceId || !user) {
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.recipient_email !== "string") {
    return NextResponse.json(
      { error: "recipient_email is required (string)" },
      { status: 400 },
    );
  }

  const email = body.recipient_email.trim().toLowerCase();
  // Mirror the contacts.email_normalized rule (LOWER(TRIM)) for consistency.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json(
      { error: "recipient_email is not a valid email address" },
      { status: 400 },
    );
  }

  // Resolve the recipient's user_id from the email. The anon-keyed
  // server client cannot read auth.users directly -- PostgREST does not
  // expose the auth schema, and using the service-role key from a
  // user-driven route handler would violate least-privilege. Instead
  // we call public.user_id_for_email(email), a SECURITY DEFINER RPC
  // added by 009_email_lookup_helper.sql, which returns ONLY the user_id
  // (no email leak). The function is GRANT EXECUTE to authenticated,
  // so an anonymous (unauthenticated) request would be rejected by
  // Postgres at function-call time.
  //
  // The RPC returns NULL when no user matches -- same shape as the
  // "user not found" branch the route already handles.
  const { data: recipientUserId, error: userErr } = await supabase.rpc(
    "user_id_for_email",
    { p_email: email },
  );

  if (userErr) {
    // The most common cause pre-009 was that auth schema isn't
    // exposed. With 009 applied, userErr would be a grant /
    // permissions error from a misapplied migration, or a network
    // blip. Surface a stable message either way so the client can
    // show something actionable.
    return NextResponse.json(
      {
        error: `Failed to resolve recipient email: ${userErr.message}`,
      },
      { status: 500 },
    );
  }
  if (!recipientUserId) {
    return NextResponse.json(
      { error: "No user with that email has an account yet." },
      { status: 404 },
    );
  }

  // Look up the recipient's workspace.
  //
  // This MUST go through the workspace_id_for_user() RPC (010), not a
  // direct .from("workspace_members") query. That query runs under the
  // CALLER's session and is subject to RLS -- workspace_members_select
  // (008) only allows a caller to see rows in their OWN workspace, so a
  // genuine cross-workspace invite recipient could never be found this
  // way (the route always fell into the "Recipient has no workspace"
  // branch, even when the recipient genuinely had one). This is RLS
  // working exactly as designed; the client-side query was simply the
  // wrong tool for a cross-workspace lookup.
  //
  // workspace_id_for_user() is a SECURITY DEFINER RPC (see
  // 010_workspace_lookup_helper.sql) that bypasses that RLS scope for
  // this one narrow, non-sensitive lookup and returns ONLY the bare
  // workspace_id -- no member list, no profile fields, no email --
  // so it stays within the PRD's privacy scope for this route.
  const { data: recipientWorkspaceId, error: memberErr } = await supabase.rpc(
    "workspace_id_for_user",
    { p_user_id: recipientUserId },
  );

  if (memberErr) {
    return NextResponse.json(
      { error: "Failed to resolve recipient workspace" },
      { status: 500 },
    );
  }
  if (!recipientWorkspaceId) {
    return NextResponse.json(
      { error: "Recipient has no workspace." },
      { status: 404 },
    );
  }

  if (recipientWorkspaceId === callerWorkspaceId) {
    return NextResponse.json(
      { error: "You can't invite your own workspace." },
      { status: 400 },
    );
  }

  // Insert the pending row. The partial unique index on
  // (LEAST/GREATEST) WHERE status IN ('pending','accepted') handles
  // dedup -- we don't need to pre-check.
  const { data, error: insertErr } = await supabase
    .from("workspace_connections")
    .insert({
      requester_workspace_id: callerWorkspaceId,
      recipient_workspace_id: recipientWorkspaceId,
      status: "pending",
      requested_by: user.id,
    })
    .select("id, status, created_at")
    .single();

  if (insertErr) {
    // The partial unique index will reject a duplicate active
    // connection with a 23505 unique_violation. Treat that as a
    // stable client error rather than 500.
    const msg = insertErr.message ?? "";
    if (
      /duplicate key|unique constraint/i.test(msg) ||
      /workspace_connections_active_pair/i.test(msg)
    ) {
      return NextResponse.json(
        {
          error:
            "An active connection between these workspaces already exists.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: `Failed to create invite: ${msg}` },
      { status: 500 },
    );
  }

  // Send the notification email. The invite row is already
  // committed -- if the email send fails, the invitee can still
  // see the request in-app. sendInviteEmail is best-effort and
  // never throws; we don't await-and-catch because we want to
  // return the 201 immediately. Side-effect is fire-and-forget
  // (no client visibility into email status). See
  // src/lib/email/smtp.ts for the failure-mode contract.
  //
  // We look up the inviter workspace name here (RLS allows it: the
  // caller is, by definition, a member of their own workspace).
  // If the lookup fails (extremely unlikely under RLS), fall back
  // to a generic name in the email body so the email still goes
  // out with something reasonable.
  let inviterWorkspaceName = "A give-to-get workspace";
  try {
    const { data: ws } = await supabase
      .from("workspaces")
      .select("name")
      .eq("id", callerWorkspaceId)
      .single();
    if (ws?.name) inviterWorkspaceName = ws.name;
  } catch {
    // intentional: fall through to the default name
  }

  // Fire-and-forget the email send so the 201 isn't blocked on
  // Resend's network latency. We don't await this Promise.
  void sendInviteEmail({
    to: email,
    inviterWorkspaceName,
    recipientEmailLocalPart: email.split("@")[0] ?? "",
  });

  return NextResponse.json(data, { status: 201 });
}
