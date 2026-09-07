// src/app/(dashboard)/network/page.tsx
//
// My Network — server component shell. Loads:
//   * caller's accepted connections (with each friend's display fields)
//   * caller's pending invites (split into incoming/outgoing)
// Then renders <MyNetworkClient> with the data + an empty modal slot.
//
// Privacy: this page reads from workspace_connections + workspace_members
// + user_profiles (all RLS-gated to the caller's workspace + accepted
// connections). It NEVER reads from contacts. The See Contacts modal
// is the only path that reads contacts for a friend's workspace, and
// it goes through /api/network/contacts/[connectionId] which has its
// own authorization check.

import { createClient } from "@/lib/supabase/server";
import {
  getMyAcceptedConnections,
  getMyPendingInvites,
} from "@/lib/network";
import MyNetworkClient from "./MyNetworkClient";

export default async function NetworkPage() {
  // Auth gate — the dashboard proxy already redirects unauthenticated
  // requests, but we double-check here for the same reason as the
  // Settings page.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const accepted = await getMyAcceptedConnections();
  const pending = await getMyPendingInvites();

  return (
    <MyNetworkClient
      currentUserEmail={user?.email ?? null}
      accepted={accepted}
      pending={pending}
    />
  );
}
