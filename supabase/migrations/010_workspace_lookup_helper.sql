-- =====================================================================
-- 010_workspace_lookup_helper.sql
--
-- Adds a SECURITY DEFINER RPC that resolves a user_id to its
-- workspace_id, callable by the authenticated server client.
--
-- Why this exists
-- ---------------
-- POST /api/network/invites takes { recipient_email } and must create a
-- pending workspace_connections row. The route needs the recipient's
-- workspace_id (so the new row has a recipient_workspace_id). The
-- obvious approach -- `supabase.from('workspace_members').select(
-- 'workspace_id').eq('user_id', recipientUserId)` -- does NOT work:
-- the query runs under the CALLER's authenticated session and is
-- therefore subject to RLS, and the `workspace_members_select` policy
-- added by 008 only allows a caller to see rows in their OWN workspace.
-- Since a real "My Network" invite is by definition between two
-- DIFFERENT workspaces, this query could never return a row for the
-- recipient -- every genuine invite fell into the "Recipient has no
-- workspace" branch regardless of whether the recipient had one.
--
-- The right shape is a narrow, SECURITY DEFINER helper in SQL that:
--   * accepts a user_id,
--   * returns ONLY the workspace_id (no member list, no profile fields,
--     no email),
--   * is GRANT EXECUTE to authenticated (NOT anon -- we don't want
--     unauthenticated probing).
--
-- This pattern matches the existing private-schema helpers in 004/006
-- (e.g. private.handle_new_user, auth_workspace_id()) and the
-- public-schema helper in 009 (public.user_id_for_email).
--
-- Apply order
-- -----------
-- Independent of 007/008/009. Apply AFTER 008 (which adds
-- workspace_members, the table this RPC reads).
--
-- =====================================================================
-- Verification against prod (2026-09-08, Claude cloud)
-- ---------------------------------------------------------------------
-- Verified live in the production Supabase SQL Editor that this file
-- matches what's running in prod:
--
--   SELECT pg_get_functiondef('public.workspace_id_for_user(uuid)'::regprocedure);
--
-- returned:
--
--   CREATE OR REPLACE FUNCTION public.workspace_id_for_user(p_user_id uuid)
--     RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
--     SET search_path TO ''
--     AS $function$
--       SELECT workspace_id
--       FROM public.workspace_members
--       WHERE user_id = p_user_id
--       LIMIT 1;
--     $function$
--
-- Matches the body below character-for-character including SECURITY
-- DEFINER, STABLE, the empty search_path, and the FROM public.workspace_members
-- prefix. No amendments needed. The reconstruction originally written
-- here was a good inference.
--
-- Applied on or around 2026-09-07 (closed via issue #5 / PR #3). The
-- row is recorded in `supabase_migrations.schema_migrations` (verified
-- alongside the functiondef above).
-- =====================================================================

-- ---------------------------------------------------------------------
-- public.workspace_id_for_user(p_user_id uuid) -> uuid
--
-- Returns the workspace_id of the workspace_members row for the given
-- user_id, or NULL if the user has no workspace. SECURITY DEFINER so
-- the function can read workspace_members on behalf of the caller, who
-- otherwise has no path to cross-workspace membership rows.
--
-- Privacy notes:
--   * We return ONLY the workspace_id (uuid). No user_id, no email,
--     no profile fields, no member list. The caller already knows the
--     user_id (they resolved it from the email via user_id_for_email
--     in 009) so no information loss; this just keeps the response
--     small and information-tight.
--   * The function does NOT reveal whether the user is a member of any
--     workspace beyond a NULL-vs-uuid return value. Same shape as
--     009's email lookup -- not adding a new side channel.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspace_id_for_user(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT workspace_id
  FROM workspace_members
  WHERE user_id = p_user_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.workspace_id_for_user(uuid) FROM PUBLIC;

-- Grant EXECUTE to authenticated only. The route handler runs as the
-- authenticated user (anon-keyed server client with a session cookie),
-- not as the truly-anon role. Anonymous probing is rejected.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.workspace_id_for_user(uuid) TO authenticated';
  END IF;
END
$$;

COMMENT ON FUNCTION public.workspace_id_for_user(uuid) IS
  'Resolves a user_id to its workspace_id via workspace_members. '
  'SECURITY DEFINER -- bypasses workspace_members_select RLS so cross-'
  'workspace membership lookups are possible (necessary for the My '
  'Network invite flow). Returns NULL when the user has no workspace. '
  'Caller must already know the user_id (no information leak in the '
  'response). Mirrors the pattern of public.user_id_for_email in 009.';