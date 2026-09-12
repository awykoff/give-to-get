-- =====================================================================
-- 012_network_workspace_ids_rpc.sql
--
-- Adds a SECURITY DEFINER RPC that returns the caller's "other side"
-- workspace IDs for use in PostgREST filter expressions.
--
-- Why this exists
-- ---------------
-- src/components/contacts/ContactsTable.tsx used
--   .not("contributed_by_workspace_id", "in",
--        "(SELECT workspace_id FROM v_my_network_workspace_ids)")
-- to keep network-gated contacts out of the general Contacts page
-- (per PRD §7 + the database skill's RLS-only-can't-enforce pitfall).
--
-- That pattern fails on PostgREST: the embedded SELECT is URL-encoded
-- as a literal string, so the WHERE clause becomes
--   contributed_by_workspace_id <> '(SELECT workspace_id FROM
--                                    v_my_network_workspace_ids)'
-- and Postgres raises
--   invalid input syntax for type uuid: "SELECT workspace_id FROM ..."
-- (observed on give-to-get.com production 2026-09-11).
--
-- The fix is to evaluate the inner SELECT server-side via an RPC.
-- PostgREST inlines RPCs in filter expressions server-side, which
-- means the client never sees the workspace IDs (preserving the
-- privacy boundary the embedded SELECT was designed to maintain) and
-- the comparison happens against real UUID values, not a literal
-- string.
--
-- The new RPC returns the same set of workspace IDs as the
-- v_my_network_workspace_ids view (008 line 166). The view stays
-- in place because it's used by the contacts_network_select RLS
-- policy (008 line 204-212), which evaluates the subquery directly
-- in Postgres and isn't subject to the PostgREST URL-encoding
-- failure mode. The function and the view share the same logic by
-- delegation: this function SELECTs FROM v_my_network_workspace_ids.
--
-- This pattern matches the existing public-schema helpers in 009
-- (public.user_id_for_email) and 010 (public.workspace_id_for_user).
-- All three are SECURITY DEFINER, STABLE, SET search_path TO '',
-- GRANT EXECUTE to authenticated only.
--
-- Apply order
-- -----------
-- Independent of 007/008/009/010/011. Apply AFTER 008 (which adds
-- workspace_connections and v_my_network_workspace_ids, the table
-- and view this function reads).
--
-- =====================================================================

-- ---------------------------------------------------------------------
-- public.network_workspace_ids() -> TABLE (workspace_id uuid)
--
-- Returns the workspace IDs the caller has an accepted connection
-- with (the "other side" of each accepted workspace_connections row
-- the caller is a party to). SECURITY DEFINER so the function can
-- be called from anon-keyed client queries with the right RLS bypass.
--
-- Privacy notes:
--   * The client never sees the result directly when this is used
--     inside a .not("col", "in", "public.network_workspace_ids()")
--     filter expression -- PostgREST inlines the function server-side
--     and the IDs only flow within the WHERE-clause evaluation. The
--     privacy boundary that the original embedded SELECT provided
--     is preserved.
--   * If the function is called directly via .rpc() (rather than as
--     a filter), the response is the full set of accepted-network
--     workspace IDs. That's the same data the v_my_network_workspace_ids
--     view already exposes (per 008 line 184-188 GRANT to authenticated),
--     so this RPC doesn't add a new information channel.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.network_workspace_ids()
RETURNS TABLE (workspace_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT workspace_id FROM v_my_network_workspace_ids;
$$;

REVOKE ALL ON FUNCTION public.network_workspace_ids() FROM PUBLIC;

-- Grant EXECUTE to authenticated only. The Contacts page's anon-keyed
-- client runs as the authenticated role once the user is signed in.
-- Anonymous probing is rejected at the function-call level.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.network_workspace_ids() TO authenticated';
  END IF;
END
$$;

COMMENT ON FUNCTION public.network_workspace_ids() IS
  'Returns the workspace IDs the caller has an accepted connection '
  'with (the "other side" of each accepted workspace_connections row '
  'the caller is a party to). SECURITY DEFINER, STABLE. Returns a set '
  'of UUIDs. Designed for use inside PostgREST filter expressions '
  'like .not("col", "in", "public.network_workspace_ids()") where the '
  'embedded-SELECT URL-encoding failure mode would otherwise pass the '
  'query as a literal string. Mirrors the pattern of '
  'public.user_id_for_email in 009 and public.workspace_id_for_user in 010.';

-- ---------------------------------------------------------------------
-- Verification helpers (comments only — no live SQL). Aaron applies
-- this migration in Supabase, then can run:
--
--   SELECT pg_get_functiondef('public.network_workspace_ids()'::regprocedure);
--
--   SELECT proname, prosecdef, prorettype::regtype
--   FROM pg_proc
--   WHERE proname = 'network_workspace_ids';
--
--   -- End-to-end smoke (as Mark's authenticated session):
--   SELECT workspace_id FROM public.network_workspace_ids();
--   -- should return the same set as the view:
--   SELECT workspace_id FROM v_my_network_workspace_ids;
--
-- ---------------------------------------------------------------------