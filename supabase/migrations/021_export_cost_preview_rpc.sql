-- 021_export_cost_preview_rpc.sql
--
-- Server-computed free/paid split for the ExportModal cost preview.
--
-- Mirrors export-generator's freeWorkspaceIds rule exactly: a contact is FREE
-- when contributed by the caller's own workspace OR by an accepted network
-- partner; everything else costs 1 credit (PR #25 economics).
--
-- SECURITY DEFINER, built on the canonical primitives the generator (and the
-- RLS/network code) already use:
--   * public.network_workspace_ids()       (012) — accepted partner workspace ids
--   * private.auth_workspace_id()          (004) — the caller's own workspace
-- so the preview reads real DB state instead of re-duplicating the free/paid
-- rule in the client (which drifted once already).
--
-- NOTE: this RPC is a second implementation of the count vs export-generator's
-- JS. The two are kept in lockstep; if they are ever found to disagree in
-- practice, fall back to a dry_run:true mode on export-generator (single
-- source of truth) rather than patching the RPC in isolation.

CREATE OR REPLACE FUNCTION public.export_cost_preview(p_contact_ids uuid[])
RETURNS TABLE (contact_count bigint, free_count bigint, paid_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  WITH selected AS (
    SELECT id, contributed_by_workspace_id
    FROM public.contacts
    WHERE id = ANY(p_contact_ids)
  ),
  freeset AS (
    SELECT workspace_id FROM public.network_workspace_ids()
    UNION
    SELECT private.auth_workspace_id()
  )
  SELECT
    count(*)::bigint,
    count(*) FILTER (
      WHERE s.contributed_by_workspace_id IN (SELECT workspace_id FROM freeset)
    )::bigint,
    count(*) FILTER (
      WHERE s.contributed_by_workspace_id IS NULL
         OR s.contributed_by_workspace_id NOT IN (SELECT workspace_id FROM freeset)
    )::bigint
  FROM selected s;
$$;

REVOKE ALL ON FUNCTION public.export_cost_preview(uuid[]) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.export_cost_preview(uuid[]) TO authenticated';
  END IF;
END
$$;

COMMENT ON FUNCTION public.export_cost_preview(uuid[]) IS
  'Returns contact_count / free_count / paid_count for the given contact ids, '
  'scoped to the caller (SECURITY DEFINER). free = contributed by the caller''s '
  'own workspace or an accepted network partner; paid = everything else. '
  'Used by the ExportModal cost preview. Mirrors export-generator pricing. '
  'STABLE SET search_path = ''''.';