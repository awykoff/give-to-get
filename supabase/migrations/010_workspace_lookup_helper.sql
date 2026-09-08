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
-- WARNING: THIS FILE IS INFERRED, NOT VERIFIED AGAINST PROD.
-- ---------------------------------------------------------------------
-- The function `public.workspace_id_for_user(uuid)` was applied to the
-- production Supabase project on or around 2026-09-07 (closed via
-- issue #5), and was confirmed present in
-- `supabase_migrations.schema_migrations` (Claude cloud, 2026-09-07/08
-- SQL Editor query). However, the source SQL was never committed to
-- the repo. This file reconstructs the most likely implementation
-- shape from the route's call site:
--
--   supabase.rpc("workspace_id_for_user", { p_user_id: recipientUserId })
--
-- and the SECURITY DEFINER pattern established in 009.
--
-- BEFORE MERGING: someone with production SQL access should diff this
-- file against the actual output of:
--
--   SELECT pg_get_functiondef('public.workspace_id_for_user(uuid)'::regprocedure);
--   SELECT pg_get_userbyid((
--     SELECT relowner FROM pg_proc WHERE proname = 'workspace_id_for_user'
--   ));
--   SELECT grantee, privilege_type
--     FROM information_schema.routine_privileges
--     WHERE routine_name = 'workspace_id_for_user';
--
-- and amend any field-level differences (column types, additional
-- null handling, extra GRANTs, etc.). The structure below is
-- deliberately conservative -- it does what the route appears to need
-- and nothing more.
--
-- Apply via: psql with the connection string from Supabase Dashboard,
-- or via supabase db push (after the file matches prod). After apply,
-- run `select * from supabase_migrations.schema_migrations where
-- version = '010_workspace_lookup_helper.sql'` and confirm the row
-- matches the existing entry.
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