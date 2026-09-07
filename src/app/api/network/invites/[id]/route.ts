// src/app/api/network/invites/[id]/route.ts
//
// PATCH /api/network/invites/[id]
//   Body: { action: "accept" | "decline" }
//   Recipient-side only. Sets status='accepted' or 'declined',
//   stamps responded_by = auth.uid(), responded_at = NOW().
//   Caller's workspace must match recipient_workspace_id on the row.
//
// DELETE /api/network/invites/[id]
//   Either side. Sets status='revoked', stamps responded_by +
//   responded_at. The row STAYS in the table (PRD §5.7 — audit
//   trail; partial unique index excludes 'revoked' so a reconnection
//   after revoke is a fresh insert).
//
// Privacy: never touches contacts. Reads/updates only
// workspace_connections. RLS gates the UPDATE to members of either
// side; the app layer narrows which verb each side can issue.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/workspace-credits";
import { getConnectionById } from "@/lib/network";

interface PatchBody {
  action?: unknown;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const { supabase, workspaceId: callerWorkspaceId } = await getWorkspaceContext();
  if (!callerWorkspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action !== "accept" && body.action !== "decline") {
    return NextResponse.json(
      { error: "action must be 'accept' or 'decline'" },
      { status: 400 },
    );
  }

  const conn = await getConnectionById(id);
  if (!conn) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Recipient-only authorization for accept/decline.
  if (callerWorkspaceId !== conn.recipient_workspace_id) {
    return NextResponse.json(
      { error: "Only the recipient can accept or decline." },
      { status: 403 },
    );
  }

  if (conn.status !== "pending") {
    return NextResponse.json(
      { error: `Cannot ${body.action} a ${conn.status} connection.` },
      { status: 409 },
    );
  }

  const newStatus = body.action === "accept" ? "accepted" : "declined";

  // We need auth.uid() for responded_by; getWorkspaceContext returns
  // the user object too via cookies(). Re-read it.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("workspace_connections")
    .update({
      status: newStatus,
      responded_by: user.id,
      responded_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: `Failed to update: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ id, status: newStatus });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const { supabase, workspaceId: callerWorkspaceId } = await getWorkspaceContext();
  if (!callerWorkspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  }

  const conn = await getConnectionById(id);
  if (!conn) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Either side can revoke.
  if (
    callerWorkspaceId !== conn.requester_workspace_id &&
    callerWorkspaceId !== conn.recipient_workspace_id
  ) {
    return NextResponse.json(
      { error: "You can only revoke your own connections." },
      { status: 403 },
    );
  }

  if (conn.status === "revoked") {
    return NextResponse.json(
      { error: "Connection already revoked." },
      { status: 409 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("workspace_connections")
    .update({
      status: "revoked",
      responded_by: user.id,
      responded_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: `Failed to revoke: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ id, status: "revoked" });
}
