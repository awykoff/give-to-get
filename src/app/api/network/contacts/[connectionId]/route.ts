// src/app/api/network/contacts/[connectionId]/route.ts
//
// GET /api/network/contacts/[connectionId]?cursor_created_at=...&cursor_id=...&q=...&pageSize=25
//
// Cursor-paginated contacts read for the See Contacts modal. Two
// gates, in order:
//   1. Caller is a member of EITHER side of the workspace_connections
//      row whose id = [connectionId] (RLS makes this true by the time
//      getConnectionById returns a row, but we re-check the caller's
//      workspace_id explicitly here).
//   2. The row's status is 'accepted'.
// Then we delegate to searchConnectionContacts (src/lib/network.ts)
// which queries contacts WHERE contributed_by_workspace_id =
// friend's workspace_id, scoped by an optional cursor + search term.
//
// Privacy (PRD §5.7 + §7):
//   - This is the ONLY path that returns connection-gated contacts.
//     The general Contacts page has its own query (with the
//     defensive exclusion) that does NOT use this helper.
//   - We never join contacts with user_profiles here. Friend display
//     data is fetched by the page separately via getMyAcceptedConnections.
//   - We never include email in the response UNLESS the caller is
//     authorized. RLS on contacts (the metadata-USING-true policy +
//     the new contacts_network_select policy) makes email readable
//     by an authenticated anon-keyed client once the connection row
//     is accepted — that's the desired behavior, matching the global
//     contacts metadata access pattern.
//   - The page caller (SeeContactsModal) must NEVER pass the result
//     of this endpoint back into the global Contacts search/export
//     path. This is a runtime invariant the comment block on
//     SeeContactsModal enforces via UI (no checkboxes, no export
//     button, no link to /api/export/*).

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/workspace-credits";
import {
  getConnectionById,
  searchConnectionContacts,
} from "@/lib/network";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await ctx.params;
  const { workspaceId: callerWorkspaceId } = await getWorkspaceContext();
  if (!callerWorkspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  }

  const conn = await getConnectionById(connectionId);
  if (!conn) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Authorize: caller must be on either side of the connection.
  if (
    callerWorkspaceId !== conn.requester_workspace_id &&
    callerWorkspaceId !== conn.recipient_workspace_id
  ) {
    return NextResponse.json(
      { error: "You are not part of this connection." },
      { status: 403 },
    );
  }

  if (conn.status !== "accepted") {
    return NextResponse.json(
      { error: `Connection is ${conn.status}; contacts are only visible to accepted connections.` },
      { status: 403 },
    );
  }

  // The friend's workspace is the side that is NOT the caller.
  const friendWorkspaceId =
    conn.requester_workspace_id === callerWorkspaceId
      ? conn.recipient_workspace_id
      : conn.requester_workspace_id;

  // Parse query params.
  const url = new URL(req.url);
  const cursorCreatedAt = url.searchParams.get("cursor_created_at");
  const cursorId = url.searchParams.get("cursor_id");
  const q = url.searchParams.get("q") ?? "";
  const pageSizeRaw = url.searchParams.get("pageSize");
  const pageSize = pageSizeRaw ? Number(pageSizeRaw) : 25;

  let cursor: { created_at: string; id: string } | null = null;
  if (cursorCreatedAt && cursorId) {
    cursor = { created_at: cursorCreatedAt, id: cursorId };
  }

  const page = await searchConnectionContacts({
    connectionId,
    friendWorkspaceId,
    cursor,
    searchTerm: q,
    pageSize: Number.isFinite(pageSize) ? pageSize : 25,
  });

  return NextResponse.json(page);
}
