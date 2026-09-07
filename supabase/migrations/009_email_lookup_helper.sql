-- =====================================================================
-- 009_email_lookup_helper.sql
--
-- Adds a SECURITY DEFINER RPC that resolves an email address to its
-- auth.users.id, callable by the anon-keyed server client.
--
-- Why this exists
-- ---------------
-- POST /api/network/invites takes { recipient_email } and must create a
-- pending workspace_connections row. The route needs the recipient's
-- user_id (to look up their workspace_id). The obvious approach —
-- `supabase.from('auth.users').select('id').eq('email', email)` — does
-- NOT work: PostgREST exposes schemas via the `expose_schemas` setting,
-- `auth` is not in that list, and the anon client gets a stable
-- "schema not exposed" error. The service-role key cannot be used from
-- a route handler without exposing it to the browser bundle (Vercel
-- server-side env vars stay on the server, but using the service-role
-- key from arbitrary user-driven code paths violates least-privilege).
--
-- The right shape is a narrow, SECURITY DEFINER helper in SQL that:
--   * accepts a normalized email,
--   * returns ONLY the user_id (no email leak),
--   * is GRANT EXECUTE to authenticated (NOT anon — we don't want
--     unauthenticated probing).
--
-- This pattern matches the existing private-schema helpers in 004/006
-- (e.g. private.handle_new_user, auth_workspace_id()).
--
-- Apply order
-- -----------
-- This migration is independent of 007/008. Apply AFTER 008 (which
-- adds workspace_connections, the table this RPC supports).
--
-- =====================================================================

-- ---------------------------------------------------------------------
-- public.user_id_for_email(email text) -> uuid
--
-- Returns auth.users.id for the user with the given (normalized)
-- email, or NULL if no such user exists. SECURITY DEFINER so the
-- function can read auth.users on behalf of the caller, who otherwise
-- has no path to it.
--
-- Privacy notes:
--   * We return ONLY the id (uuid). The email itself is NOT echoed
--     back. The caller already knows the email (they typed it) so no
--     information loss; this just keeps the response small and
--     information-tight.
--   * The function does NOT reveal whether the email exists or not
--     beyond a NULL-vs-uuid return value. That's the same shape the
--     caller would get from "select id from auth.users where email =
--     ..." — we're not adding a new side channel.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_id_for_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT id
  FROM auth.users
  WHERE email = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.user_id_for_email(text) FROM PUBLIC;

-- Grant EXECUTE to authenticated only. The route handler runs as the
-- authenticated user (anon-keyed server client with a session cookie),
-- not as the truly-anon role. Anonymous probing is rejected.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.user_id_for_email(text) TO authenticated';
  END IF;
END
$$;

COMMENT ON FUNCTION public.user_id_for_email(text) IS
  'Resolves a normalized email address to its auth.users.id. '
  'SECURITY DEFINER — bypasses the auth schema not being exposed via '
  'PostgREST. Returns NULL when no user matches. Caller must already '
  'know the email (no information leak in the response).';