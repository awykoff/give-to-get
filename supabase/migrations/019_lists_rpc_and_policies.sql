-- 019_lists_rpc_and_policies.sql
--
-- Lists feature (v1) DB groundwork:
--   1. search_contacts / search_companies / search_*_count gain a p_list
--      param so clients can filter by list tag (?list=<name>).
--   2. list_member_counts_contacts() / list_member_counts_companies() back
--      the Lists pages' "# Records" column (global/shared tag model).
--   3. contacts_list_update / companies_list_update UPDATE-only RLS policies
--      gate tag/untag to contributed-by-caller rows (no Edge Function).
--   4. contact_list_append / contact_list_remove (+ companies mirror) do the
--      array_append/remove atomically in one UPDATE (no read-then-write race),
--      scoped to contributed_by_workspace_id = private.auth_workspace_id().
--
-- The four search-function bodies below are the byte-faithful live defs
-- (pg_get_functiondef) plus EXACTLY TWO edits: a trailing `p_list text
-- DEFAULT NULL` argument, and the WHERE clause restructured to
--   WHERE (p_list ...) AND ( <original WHERE body> )
-- diff-verified programmatically; NULL/'' p_list leaves behavior unchanged.

-- ─────────────────────────────────────────────────────────────
-- LIST MEMBER-COUNT RPCs
-- ─────────────────────────────────────────────────────────────
-- Global/shared tag model (approved): member counts reflect actual list
-- membership across the whole table (own + partner + general pool), NOT
-- just contributed-by-caller. No ownership filter. SECURITY DEFINER with
-- empty search_path; REVOKE/GRANT at bottom.

CREATE OR REPLACE FUNCTION public.list_member_counts_contacts()
RETURNS TABLE (list_name text, record_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT l, count(*)::bigint
  FROM public.contacts c
  CROSS JOIN LATERAL unnest(c.lists) AS l
  GROUP BY l
  ORDER BY l
$$;

CREATE OR REPLACE FUNCTION public.list_member_counts_companies()
RETURNS TABLE (list_name text, record_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT l, count(*)::bigint
  FROM public.companies co
  CROSS JOIN LATERAL unnest(co.lists) AS l
  GROUP BY l
  ORDER BY l
$$;

REVOKE ALL ON FUNCTION public.list_member_counts_contacts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_member_counts_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_member_counts_contacts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_member_counts_companies() TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- UPDATE-ONLY RLS policies for tag/untag
-- ─────────────────────────────────────────────────────────────
-- array_append on lists is a user-managed tag UPDATE, not a contribution —
-- the service-role-only boundary protects INSERT triggers (dedup + credits),
-- not UPDATE. So authenticated UPDATE is allowed ONLY on contributed-by-caller
-- rows (contributed_by_workspace_id = private.auth_workspace_id()).

CREATE POLICY "contacts_list_update"
  ON public.contacts FOR UPDATE TO authenticated
  USING (contributed_by_workspace_id = private.auth_workspace_id())
  WITH CHECK (contributed_by_workspace_id = private.auth_workspace_id());

CREATE POLICY "companies_list_update"
  ON public.companies FOR UPDATE TO authenticated
  USING (contributed_by_workspace_id = private.auth_workspace_id())
  WITH CHECK (contributed_by_workspace_id = private.auth_workspace_id());


-- ─────────────────────────────────────────────────────────────
-- ATOMIC ADD/REMOVE LIST RPCs (FIX 2)
-- ─────────────────────────────────────────────────────────────
-- SECURITY DEFINER: do array_append / array_remove in ONE statement — no
-- client read-then-write race when two sessions tag the same contact.
-- The ownership predicate is INSIDE the function, so SECURITY DEFINER cannot
-- tag someone else's contact; it's the single audit point. Idempotent add
-- (NOT (p_list = ANY(lists))) so re-adding to a list is a no-op.

CREATE OR REPLACE FUNCTION public.contact_list_append(p_contact_id uuid, p_list_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  UPDATE public.contacts
  SET lists = array_append(lists, p_list_name)
  WHERE id = p_contact_id
    AND contributed_by_workspace_id = private.auth_workspace_id()
    AND NOT (p_list_name = ANY(lists));
  RETURN (FOUND AND p_list_name IS NOT NULL AND p_list_name <> '');
END;
$$;

CREATE OR REPLACE FUNCTION public.contact_list_remove(p_contact_id uuid, p_list_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  UPDATE public.contacts
  SET lists = array_remove(lists, p_list_name)
  WHERE id = p_contact_id
    AND contributed_by_workspace_id = private.auth_workspace_id();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.company_list_append(p_company_id uuid, p_list_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  UPDATE public.companies
  SET lists = array_append(lists, p_list_name)
  WHERE id = p_company_id
    AND contributed_by_workspace_id = private.auth_workspace_id()
    AND NOT (p_list_name = ANY(lists));
  RETURN (FOUND AND p_list_name IS NOT NULL AND p_list_name <> '');
END;
$$;

CREATE OR REPLACE FUNCTION public.company_list_remove(p_company_id uuid, p_list_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  UPDATE public.companies
  SET lists = array_remove(lists, p_list_name)
  WHERE id = p_company_id
    AND contributed_by_workspace_id = private.auth_workspace_id();
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.contact_list_append(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_list_remove(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_list_append(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.company_list_remove(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_list_append(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contact_list_remove(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_list_append(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_list_remove(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- SEARCH RPCs + p_list param (FIX 1: WHERE restructured, no WHERE-AND)
-- Byte-faithful rewrites: live body + p_list arg + WHERE wrap
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_contacts(p_query text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort_column text DEFAULT 'created_at'::text, p_sort_ascending boolean DEFAULT false, p_list text DEFAULT NULL)
 RETURNS SETOF contacts
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.*
  FROM public.contacts c
    WHERE
    (p_list IS NULL OR p_list = '' OR p_list = ANY(c.lists))
    AND (
    -- Empty query: return everything (subject to LIMIT/OFFSET)
    p_query IS NULL OR p_query = ''
    OR
    (
      -- Substring search across the 35 non-gated TEXT+ARRAY columns.
      -- Array columns: per-element substring match via unnest+EXISTS.
      -- Text columns: ILIKE substring (safe; wildcards aren't a leak
      -- here because text columns aren't the privacy-sensitive ones).
      c.first_name ILIKE '%' || p_query || '%'
      OR c.last_name ILIKE '%' || p_query || '%'
      OR c.email_status ILIKE '%' || p_query || '%'
      OR c.email_source ILIKE '%' || p_query || '%'
      OR c.email_verification_source ILIKE '%' || p_query || '%'
      OR c.email_catch_all_status ILIKE '%' || p_query || '%'
      OR c.secondary_email_source ILIKE '%' || p_query || '%'
      OR c.secondary_email_status ILIKE '%' || p_query || '%'
      OR c.tertiary_email_source ILIKE '%' || p_query || '%'
      OR c.tertiary_email_status ILIKE '%' || p_query || '%'
      OR c.title ILIKE '%' || p_query || '%'
      OR c.seniority ILIKE '%' || p_query || '%'
      OR c.company_name ILIKE '%' || p_query || '%'
      OR c.work_direct_phone ILIKE '%' || p_query || '%'
      OR c.mobile_phone ILIKE '%' || p_query || '%'
      OR c.corporate_phone ILIKE '%' || p_query || '%'
      OR c.home_phone ILIKE '%' || p_query || '%'
      OR c.other_phone ILIKE '%' || p_query || '%'
      OR c.city ILIKE '%' || p_query || '%'
      OR c.state ILIKE '%' || p_query || '%'
      OR c.country ILIKE '%' || p_query || '%'
      OR c.industry ILIKE '%' || p_query || '%'
      OR c.vertical ILIKE '%' || p_query || '%'
      OR c.company_city ILIKE '%' || p_query || '%'
      OR c.company_state ILIKE '%' || p_query || '%'
      OR c.company_country ILIKE '%' || p_query || '%'
      OR c.company_address ILIKE '%' || p_query || '%'
      OR c.company_phone ILIKE '%' || p_query || '%'
      OR c.latest_funding ILIKE '%' || p_query || '%'
      OR c.stage ILIKE '%' || p_query || '%'
      OR EXISTS (SELECT 1 FROM unnest(c.departments)     elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.sub_departments) elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.keywords)        elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.technologies)    elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.lists)           elem WHERE elem ILIKE '%' || p_query || '%')
      -- Email exact-match channel: PLAIN EQUALITY, gated on a syntactically
      -- valid full email. NOT ILIKE -- underscore in email addresses would
      -- otherwise be treated as a wildcard. Only fires when the query
      -- matches a complete address; partial fragments never narrow results.
      OR (
        p_query ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
        AND (
          c.email_normalized = lower(trim(p_query))
          OR lower(trim(c.secondary_email)) = lower(trim(p_query))
          OR lower(trim(c.tertiary_email)) = lower(trim(p_query))
        )
      )
    )
    )

  ORDER BY
    -- Whitelist: every sort column mapped through CASE expressions so the
    -- SQL planner builds a safe static query (no dynamic column-name
    -- string interpolation, no injection vector).
    CASE WHEN p_sort_column = 'first_name' AND p_sort_ascending THEN c.first_name END ASC,
    CASE WHEN p_sort_column = 'last_name' AND p_sort_ascending THEN c.last_name END ASC,
    CASE WHEN p_sort_column = 'email' AND p_sort_ascending THEN c.email END ASC,
    CASE WHEN p_sort_column = 'email_normalized' AND p_sort_ascending THEN c.email_normalized END ASC,
    CASE WHEN p_sort_column = 'email_status' AND p_sort_ascending THEN c.email_status END ASC,
    CASE WHEN p_sort_column = 'email_source' AND p_sort_ascending THEN c.email_source END ASC,
    CASE WHEN p_sort_column = 'email_verification_source' AND p_sort_ascending THEN c.email_verification_source END ASC,
    CASE WHEN p_sort_column = 'email_confidence' AND p_sort_ascending THEN c.email_confidence END ASC,
    CASE WHEN p_sort_column = 'email_catch_all_status' AND p_sort_ascending THEN c.email_catch_all_status END ASC,
    CASE WHEN p_sort_column = 'email_last_verified_at' AND p_sort_ascending THEN c.email_last_verified_at END ASC,
    CASE WHEN p_sort_column = 'secondary_email' AND p_sort_ascending THEN c.secondary_email END ASC,
    CASE WHEN p_sort_column = 'secondary_email_source' AND p_sort_ascending THEN c.secondary_email_source END ASC,
    CASE WHEN p_sort_column = 'secondary_email_status' AND p_sort_ascending THEN c.secondary_email_status END ASC,
    CASE WHEN p_sort_column = 'tertiary_email' AND p_sort_ascending THEN c.tertiary_email END ASC,
    CASE WHEN p_sort_column = 'tertiary_email_source' AND p_sort_ascending THEN c.tertiary_email_source END ASC,
    CASE WHEN p_sort_column = 'tertiary_email_status' AND p_sort_ascending THEN c.tertiary_email_status END ASC,
    CASE WHEN p_sort_column = 'title' AND p_sort_ascending THEN c.title END ASC,
    CASE WHEN p_sort_column = 'seniority' AND p_sort_ascending THEN c.seniority END ASC,
    CASE WHEN p_sort_column = 'company_name' AND p_sort_ascending THEN c.company_name END ASC,
    CASE WHEN p_sort_column = 'work_direct_phone' AND p_sort_ascending THEN c.work_direct_phone END ASC,
    CASE WHEN p_sort_column = 'mobile_phone' AND p_sort_ascending THEN c.mobile_phone END ASC,
    CASE WHEN p_sort_column = 'corporate_phone' AND p_sort_ascending THEN c.corporate_phone END ASC,
    CASE WHEN p_sort_column = 'home_phone' AND p_sort_ascending THEN c.home_phone END ASC,
    CASE WHEN p_sort_column = 'other_phone' AND p_sort_ascending THEN c.other_phone END ASC,
    CASE WHEN p_sort_column = 'do_not_call' AND p_sort_ascending THEN c.do_not_call END ASC,
    CASE WHEN p_sort_column = 'linkedin_url' AND p_sort_ascending THEN c.linkedin_url END ASC,
    CASE WHEN p_sort_column = 'twitter_url' AND p_sort_ascending THEN c.twitter_url END ASC,
    CASE WHEN p_sort_column = 'facebook_url' AND p_sort_ascending THEN c.facebook_url END ASC,
    CASE WHEN p_sort_column = 'city' AND p_sort_ascending THEN c.city END ASC,
    CASE WHEN p_sort_column = 'state' AND p_sort_ascending THEN c.state END ASC,
    CASE WHEN p_sort_column = 'country' AND p_sort_ascending THEN c.country END ASC,
    CASE WHEN p_sort_column = 'industry' AND p_sort_ascending THEN c.industry END ASC,
    CASE WHEN p_sort_column = 'vertical' AND p_sort_ascending THEN c.vertical END ASC,
    CASE WHEN p_sort_column = 'company_city' AND p_sort_ascending THEN c.company_city END ASC,
    CASE WHEN p_sort_column = 'company_state' AND p_sort_ascending THEN c.company_state END ASC,
    CASE WHEN p_sort_column = 'company_country' AND p_sort_ascending THEN c.company_country END ASC,
    CASE WHEN p_sort_column = 'company_address' AND p_sort_ascending THEN c.company_address END ASC,
    CASE WHEN p_sort_column = 'company_phone' AND p_sort_ascending THEN c.company_phone END ASC,
    CASE WHEN p_sort_column = 'latest_funding' AND p_sort_ascending THEN c.latest_funding END ASC,
    CASE WHEN p_sort_column = 'stage' AND p_sort_ascending THEN c.stage END ASC,
    CASE WHEN p_sort_column = 'first_name' AND NOT p_sort_ascending THEN c.first_name END DESC,
    CASE WHEN p_sort_column = 'last_name' AND NOT p_sort_ascending THEN c.last_name END DESC,
    CASE WHEN p_sort_column = 'email' AND NOT p_sort_ascending THEN c.email END DESC,
    CASE WHEN p_sort_column = 'email_normalized' AND NOT p_sort_ascending THEN c.email_normalized END DESC,
    CASE WHEN p_sort_column = 'email_status' AND NOT p_sort_ascending THEN c.email_status END DESC,
    CASE WHEN p_sort_column = 'email_source' AND NOT p_sort_ascending THEN c.email_source END DESC,
    CASE WHEN p_sort_column = 'email_verification_source' AND NOT p_sort_ascending THEN c.email_verification_source END DESC,
    CASE WHEN p_sort_column = 'email_confidence' AND NOT p_sort_ascending THEN c.email_confidence END DESC,
    CASE WHEN p_sort_column = 'email_catch_all_status' AND NOT p_sort_ascending THEN c.email_catch_all_status END DESC,
    CASE WHEN p_sort_column = 'email_last_verified_at' AND NOT p_sort_ascending THEN c.email_last_verified_at END DESC,
    CASE WHEN p_sort_column = 'secondary_email' AND NOT p_sort_ascending THEN c.secondary_email END DESC,
    CASE WHEN p_sort_column = 'secondary_email_source' AND NOT p_sort_ascending THEN c.secondary_email_source END DESC,
    CASE WHEN p_sort_column = 'secondary_email_status' AND NOT p_sort_ascending THEN c.secondary_email_status END DESC,
    CASE WHEN p_sort_column = 'tertiary_email' AND NOT p_sort_ascending THEN c.tertiary_email END DESC,
    CASE WHEN p_sort_column = 'tertiary_email_source' AND NOT p_sort_ascending THEN c.tertiary_email_source END DESC,
    CASE WHEN p_sort_column = 'tertiary_email_status' AND NOT p_sort_ascending THEN c.tertiary_email_status END DESC,
    CASE WHEN p_sort_column = 'title' AND NOT p_sort_ascending THEN c.title END DESC,
    CASE WHEN p_sort_column = 'seniority' AND NOT p_sort_ascending THEN c.seniority END DESC,
    CASE WHEN p_sort_column = 'company_name' AND NOT p_sort_ascending THEN c.company_name END DESC,
    CASE WHEN p_sort_column = 'work_direct_phone' AND NOT p_sort_ascending THEN c.work_direct_phone END DESC,
    CASE WHEN p_sort_column = 'mobile_phone' AND NOT p_sort_ascending THEN c.mobile_phone END DESC,
    CASE WHEN p_sort_column = 'corporate_phone' AND NOT p_sort_ascending THEN c.corporate_phone END DESC,
    CASE WHEN p_sort_column = 'home_phone' AND NOT p_sort_ascending THEN c.home_phone END DESC,
    CASE WHEN p_sort_column = 'other_phone' AND NOT p_sort_ascending THEN c.other_phone END DESC,
    CASE WHEN p_sort_column = 'do_not_call' AND NOT p_sort_ascending THEN c.do_not_call END DESC,
    CASE WHEN p_sort_column = 'linkedin_url' AND NOT p_sort_ascending THEN c.linkedin_url END DESC,
    CASE WHEN p_sort_column = 'twitter_url' AND NOT p_sort_ascending THEN c.twitter_url END DESC,
    CASE WHEN p_sort_column = 'facebook_url' AND NOT p_sort_ascending THEN c.facebook_url END DESC,
    CASE WHEN p_sort_column = 'city' AND NOT p_sort_ascending THEN c.city END DESC,
    CASE WHEN p_sort_column = 'state' AND NOT p_sort_ascending THEN c.state END DESC,
    CASE WHEN p_sort_column = 'country' AND NOT p_sort_ascending THEN c.country END DESC,
    CASE WHEN p_sort_column = 'industry' AND NOT p_sort_ascending THEN c.industry END DESC,
    CASE WHEN p_sort_column = 'vertical' AND NOT p_sort_ascending THEN c.vertical END DESC,
    CASE WHEN p_sort_column = 'company_city' AND NOT p_sort_ascending THEN c.company_city END DESC,
    CASE WHEN p_sort_column = 'company_state' AND NOT p_sort_ascending THEN c.company_state END DESC,
    CASE WHEN p_sort_column = 'company_country' AND NOT p_sort_ascending THEN c.company_country END DESC,
    CASE WHEN p_sort_column = 'company_address' AND NOT p_sort_ascending THEN c.company_address END DESC,
    CASE WHEN p_sort_column = 'company_phone' AND NOT p_sort_ascending THEN c.company_phone END DESC,
    CASE WHEN p_sort_column = 'latest_funding' AND NOT p_sort_ascending THEN c.latest_funding END DESC,
    CASE WHEN p_sort_column = 'stage' AND NOT p_sort_ascending THEN c.stage END DESC,
    CASE WHEN p_sort_column = 'num_employees' AND p_sort_ascending THEN c.num_employees END ASC,
    CASE WHEN p_sort_column = 'num_employees' AND NOT p_sort_ascending THEN c.num_employees END DESC,
    CASE WHEN p_sort_column = 'annual_revenue' AND p_sort_ascending THEN c.annual_revenue END ASC,
    CASE WHEN p_sort_column = 'annual_revenue' AND NOT p_sort_ascending THEN c.annual_revenue END DESC,
    CASE WHEN p_sort_column = 'total_funding' AND p_sort_ascending THEN c.total_funding END ASC,
    CASE WHEN p_sort_column = 'total_funding' AND NOT p_sort_ascending THEN c.total_funding END DESC,
    CASE WHEN p_sort_column = 'latest_funding_amount' AND p_sort_ascending THEN c.latest_funding_amount END ASC,
    CASE WHEN p_sort_column = 'latest_funding_amount' AND NOT p_sort_ascending THEN c.latest_funding_amount END DESC,
    CASE WHEN p_sort_column = 'last_raised_at' AND p_sort_ascending THEN c.last_raised_at END ASC,
    CASE WHEN p_sort_column = 'last_raised_at' AND NOT p_sort_ascending THEN c.last_raised_at END DESC,
    CASE WHEN p_sort_column = 'last_contacted' AND p_sort_ascending THEN c.last_contacted END ASC,
    CASE WHEN p_sort_column = 'last_contacted' AND NOT p_sort_ascending THEN c.last_contacted END DESC,
    CASE WHEN p_sort_column = 'quality_score' AND p_sort_ascending THEN c.quality_score END ASC,
    CASE WHEN p_sort_column = 'quality_score' AND NOT p_sort_ascending THEN c.quality_score END DESC,
    CASE WHEN p_sort_column = 'is_verified' AND p_sort_ascending THEN c.is_verified END ASC,
    CASE WHEN p_sort_column = 'is_verified' AND NOT p_sort_ascending THEN c.is_verified END DESC,
    CASE WHEN p_sort_column = 'departments' AND p_sort_ascending THEN c.departments END ASC,
    CASE WHEN p_sort_column = 'departments' AND NOT p_sort_ascending THEN c.departments END DESC,
    CASE WHEN p_sort_column = 'sub_departments' AND p_sort_ascending THEN c.sub_departments END ASC,
    CASE WHEN p_sort_column = 'sub_departments' AND NOT p_sort_ascending THEN c.sub_departments END DESC,
    CASE WHEN p_sort_column = 'keywords' AND p_sort_ascending THEN c.keywords END ASC,
    CASE WHEN p_sort_column = 'keywords' AND NOT p_sort_ascending THEN c.keywords END DESC,
    CASE WHEN p_sort_column = 'technologies' AND p_sort_ascending THEN c.technologies END ASC,
    CASE WHEN p_sort_column = 'technologies' AND NOT p_sort_ascending THEN c.technologies END DESC,
    CASE WHEN p_sort_column = 'lists' AND p_sort_ascending THEN c.lists END ASC,
    CASE WHEN p_sort_column = 'lists' AND NOT p_sort_ascending THEN c.lists END DESC,
    CASE WHEN p_sort_column = 'email_sent' AND p_sort_ascending THEN c.email_sent END ASC,
    CASE WHEN p_sort_column = 'email_sent' AND NOT p_sort_ascending THEN c.email_sent END DESC,
    CASE WHEN p_sort_column = 'email_open' AND p_sort_ascending THEN c.email_open END ASC,
    CASE WHEN p_sort_column = 'email_open' AND NOT p_sort_ascending THEN c.email_open END DESC,
    CASE WHEN p_sort_column = 'email_bounced' AND p_sort_ascending THEN c.email_bounced END ASC,
    CASE WHEN p_sort_column = 'email_bounced' AND NOT p_sort_ascending THEN c.email_bounced END DESC,
    CASE WHEN p_sort_column = 'replied' AND p_sort_ascending THEN c.replied END ASC,
    CASE WHEN p_sort_column = 'replied' AND NOT p_sort_ascending THEN c.replied END DESC,
    CASE WHEN p_sort_column = 'demoed' AND p_sort_ascending THEN c.demoed END ASC,
    CASE WHEN p_sort_column = 'demoed' AND NOT p_sort_ascending THEN c.demoed END DESC,
    CASE WHEN p_sort_column = 'created_at' AND p_sort_ascending THEN c.created_at END ASC,
    CASE WHEN p_sort_column = 'created_at' AND NOT p_sort_ascending THEN c.created_at END DESC,
    CASE WHEN p_sort_column = 'updated_at' AND p_sort_ascending THEN c.updated_at END ASC,
    CASE WHEN p_sort_column = 'updated_at' AND NOT p_sort_ascending THEN c.updated_at END DESC,
    -- Default sort when caller passes an unrecognized column name:
    -- fall through to created_at DESC (most-recent-first).
    CASE WHEN p_sort_column NOT IN (
      'first_name', 'last_name', 'email', 'email_normalized', 'email_status', 'email_source', 'email_verification_source', 'email_confidence', 'email_catch_all_status', 'email_last_verified_at', 'secondary_email', 'secondary_email_source', 'secondary_email_status', 'tertiary_email', 'tertiary_email_source', 'tertiary_email_status', 'title', 'seniority', 'company_name', 'work_direct_phone', 'mobile_phone', 'corporate_phone', 'home_phone', 'other_phone', 'do_not_call', 'linkedin_url', 'twitter_url', 'facebook_url', 'city', 'state', 'country', 'industry', 'vertical', 'company_city', 'company_state', 'company_country', 'company_address', 'company_phone', 'latest_funding', 'stage', 'num_employees', 'annual_revenue', 'total_funding', 'latest_funding_amount', 'last_raised_at', 'last_contacted', 'quality_score', 'is_verified', 'departments', 'sub_departments', 'keywords', 'technologies', 'lists', 'email_sent', 'email_open', 'email_bounced', 'replied', 'demoed', 'created_at', 'updated_at'
    ) AND p_sort_ascending THEN c.created_at END ASC,
    CASE WHEN p_sort_column NOT IN (
      'first_name', 'last_name', 'email', 'email_normalized', 'email_status', 'email_source', 'email_verification_source', 'email_confidence', 'email_catch_all_status', 'email_last_verified_at', 'secondary_email', 'secondary_email_source', 'secondary_email_status', 'tertiary_email', 'tertiary_email_source', 'tertiary_email_status', 'title', 'seniority', 'company_name', 'work_direct_phone', 'mobile_phone', 'corporate_phone', 'home_phone', 'other_phone', 'do_not_call', 'linkedin_url', 'twitter_url', 'facebook_url', 'city', 'state', 'country', 'industry', 'vertical', 'company_city', 'company_state', 'company_country', 'company_address', 'company_phone', 'latest_funding', 'stage', 'num_employees', 'annual_revenue', 'total_funding', 'latest_funding_amount', 'last_raised_at', 'last_contacted', 'quality_score', 'is_verified', 'departments', 'sub_departments', 'keywords', 'technologies', 'lists', 'email_sent', 'email_open', 'email_bounced', 'replied', 'demoed', 'created_at', 'updated_at'
    ) AND NOT p_sort_ascending THEN c.created_at END DESC,
    -- Deterministic tiebreaker: Postgres doesn't guarantee stable ordering
    -- across separate query executions when there are ties on the primary
    -- sort column (very common on low-cardinality columns like do_not_call,
    -- is_verified, replied, demoed, industry, stage, seniority). Combined
    -- with LIMIT/OFFSET pagination, that means a row could appear on two
    -- pages or on neither if tie order shifts between requests. Adding
    -- c.id ASC as the final ORDER BY term breaks ties consistently. Standard
    -- pagination correctness pattern; doesn't change primary sort behavior.
    c.id ASC
  LIMIT p_limit
  OFFSET p_offset;
$function$


CREATE OR REPLACE FUNCTION public.search_companies(p_query text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort_column text DEFAULT 'created_at'::text, p_sort_ascending boolean DEFAULT false, p_list text DEFAULT NULL)
 RETURNS SETOF companies
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.*
  FROM public.companies c
    WHERE
    (p_list IS NULL OR p_list = '' OR p_list = ANY(c.lists))
    AND (
    p_query IS NULL OR p_query = ''
    OR
    (
      -- Substring search across the 18 non-gated TEXT+ARRAY columns.
      c.name ILIKE '%' || p_query || '%'
      OR c.name_for_emails ILIKE '%' || p_query || '%'
      OR c.domain ILIKE '%' || p_query || '%'
      OR c.industry ILIKE '%' || p_query || '%'
      OR c.short_description ILIKE '%' || p_query || '%'
      OR c.latest_funding ILIKE '%' || p_query || '%'
      OR c.street ILIKE '%' || p_query || '%'
      OR c.city ILIKE '%' || p_query || '%'
      OR c.state ILIKE '%' || p_query || '%'
      OR c.country ILIKE '%' || p_query || '%'
      OR c.postal_code ILIKE '%' || p_query || '%'
      OR c.address ILIKE '%' || p_query || '%'
      OR c.phone ILIKE '%' || p_query || '%'
      OR c.subsidiary_of ILIKE '%' || p_query || '%'
      OR EXISTS (SELECT 1 FROM unnest(c.keywords)     elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.sic_codes)   elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.naics_codes)  elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.technologies) elem WHERE elem ILIKE '%' || p_query || '%')
    )
    )

  ORDER BY
    CASE WHEN p_sort_column = 'name' AND p_sort_ascending THEN c.name END ASC,
    CASE WHEN p_sort_column = 'name' AND NOT p_sort_ascending THEN c.name END DESC,
    CASE WHEN p_sort_column = 'name_for_emails' AND p_sort_ascending THEN c.name_for_emails END ASC,
    CASE WHEN p_sort_column = 'name_for_emails' AND NOT p_sort_ascending THEN c.name_for_emails END DESC,
    CASE WHEN p_sort_column = 'website' AND p_sort_ascending THEN c.website END ASC,
    CASE WHEN p_sort_column = 'website' AND NOT p_sort_ascending THEN c.website END DESC,
    CASE WHEN p_sort_column = 'domain' AND p_sort_ascending THEN c.domain END ASC,
    CASE WHEN p_sort_column = 'domain' AND NOT p_sort_ascending THEN c.domain END DESC,
    CASE WHEN p_sort_column = 'num_employees' AND p_sort_ascending THEN c.num_employees END ASC,
    CASE WHEN p_sort_column = 'num_employees' AND NOT p_sort_ascending THEN c.num_employees END DESC,
    CASE WHEN p_sort_column = 'industry' AND p_sort_ascending THEN c.industry END ASC,
    CASE WHEN p_sort_column = 'industry' AND NOT p_sort_ascending THEN c.industry END DESC,
    CASE WHEN p_sort_column = 'short_description' AND p_sort_ascending THEN c.short_description END ASC,
    CASE WHEN p_sort_column = 'short_description' AND NOT p_sort_ascending THEN c.short_description END DESC,
    CASE WHEN p_sort_column = 'founded_year' AND p_sort_ascending THEN c.founded_year END ASC,
    CASE WHEN p_sort_column = 'founded_year' AND NOT p_sort_ascending THEN c.founded_year END DESC,
    CASE WHEN p_sort_column = 'number_of_retail_locs' AND p_sort_ascending THEN c.number_of_retail_locs END ASC,
    CASE WHEN p_sort_column = 'number_of_retail_locs' AND NOT p_sort_ascending THEN c.number_of_retail_locs END DESC,
    CASE WHEN p_sort_column = 'annual_revenue' AND p_sort_ascending THEN c.annual_revenue END ASC,
    CASE WHEN p_sort_column = 'annual_revenue' AND NOT p_sort_ascending THEN c.annual_revenue END DESC,
    CASE WHEN p_sort_column = 'total_funding' AND p_sort_ascending THEN c.total_funding END ASC,
    CASE WHEN p_sort_column = 'total_funding' AND NOT p_sort_ascending THEN c.total_funding END DESC,
    CASE WHEN p_sort_column = 'latest_funding' AND p_sort_ascending THEN c.latest_funding END ASC,
    CASE WHEN p_sort_column = 'latest_funding' AND NOT p_sort_ascending THEN c.latest_funding END DESC,
    CASE WHEN p_sort_column = 'latest_funding_amount' AND p_sort_ascending THEN c.latest_funding_amount END ASC,
    CASE WHEN p_sort_column = 'latest_funding_amount' AND NOT p_sort_ascending THEN c.latest_funding_amount END DESC,
    CASE WHEN p_sort_column = 'last_raised_at' AND p_sort_ascending THEN c.last_raised_at END ASC,
    CASE WHEN p_sort_column = 'last_raised_at' AND NOT p_sort_ascending THEN c.last_raised_at END DESC,
    CASE WHEN p_sort_column = 'street' AND p_sort_ascending THEN c.street END ASC,
    CASE WHEN p_sort_column = 'street' AND NOT p_sort_ascending THEN c.street END DESC,
    CASE WHEN p_sort_column = 'city' AND p_sort_ascending THEN c.city END ASC,
    CASE WHEN p_sort_column = 'city' AND NOT p_sort_ascending THEN c.city END DESC,
    CASE WHEN p_sort_column = 'state' AND p_sort_ascending THEN c.state END ASC,
    CASE WHEN p_sort_column = 'state' AND NOT p_sort_ascending THEN c.state END DESC,
    CASE WHEN p_sort_column = 'country' AND p_sort_ascending THEN c.country END ASC,
    CASE WHEN p_sort_column = 'country' AND NOT p_sort_ascending THEN c.country END DESC,
    CASE WHEN p_sort_column = 'postal_code' AND p_sort_ascending THEN c.postal_code END ASC,
    CASE WHEN p_sort_column = 'postal_code' AND NOT p_sort_ascending THEN c.postal_code END DESC,
    CASE WHEN p_sort_column = 'address' AND p_sort_ascending THEN c.address END ASC,
    CASE WHEN p_sort_column = 'address' AND NOT p_sort_ascending THEN c.address END DESC,
    CASE WHEN p_sort_column = 'phone' AND p_sort_ascending THEN c.phone END ASC,
    CASE WHEN p_sort_column = 'phone' AND NOT p_sort_ascending THEN c.phone END DESC,
    CASE WHEN p_sort_column = 'linkedin_url' AND p_sort_ascending THEN c.linkedin_url END ASC,
    CASE WHEN p_sort_column = 'linkedin_url' AND NOT p_sort_ascending THEN c.linkedin_url END DESC,
    CASE WHEN p_sort_column = 'facebook_url' AND p_sort_ascending THEN c.facebook_url END ASC,
    CASE WHEN p_sort_column = 'facebook_url' AND NOT p_sort_ascending THEN c.facebook_url END DESC,
    CASE WHEN p_sort_column = 'twitter_url' AND p_sort_ascending THEN c.twitter_url END ASC,
    CASE WHEN p_sort_column = 'twitter_url' AND NOT p_sort_ascending THEN c.twitter_url END DESC,
    CASE WHEN p_sort_column = 'logo_url' AND p_sort_ascending THEN c.logo_url END ASC,
    CASE WHEN p_sort_column = 'logo_url' AND NOT p_sort_ascending THEN c.logo_url END DESC,
    CASE WHEN p_sort_column = 'subsidiary_of' AND p_sort_ascending THEN c.subsidiary_of END ASC,
    CASE WHEN p_sort_column = 'subsidiary_of' AND NOT p_sort_ascending THEN c.subsidiary_of END DESC,
    CASE WHEN p_sort_column = 'keywords' AND p_sort_ascending THEN c.keywords END ASC,
    CASE WHEN p_sort_column = 'keywords' AND NOT p_sort_ascending THEN c.keywords END DESC,
    CASE WHEN p_sort_column = 'sic_codes' AND p_sort_ascending THEN c.sic_codes END ASC,
    CASE WHEN p_sort_column = 'sic_codes' AND NOT p_sort_ascending THEN c.sic_codes END DESC,
    CASE WHEN p_sort_column = 'naics_codes' AND p_sort_ascending THEN c.naics_codes END ASC,
    CASE WHEN p_sort_column = 'naics_codes' AND NOT p_sort_ascending THEN c.naics_codes END DESC,
    CASE WHEN p_sort_column = 'technologies' AND p_sort_ascending THEN c.technologies END ASC,
    CASE WHEN p_sort_column = 'technologies' AND NOT p_sort_ascending THEN c.technologies END DESC,
    CASE WHEN p_sort_column = 'quality_score' AND p_sort_ascending THEN c.quality_score END ASC,
    CASE WHEN p_sort_column = 'quality_score' AND NOT p_sort_ascending THEN c.quality_score END DESC,
    CASE WHEN p_sort_column = 'created_at' AND p_sort_ascending THEN c.created_at END ASC,
    CASE WHEN p_sort_column = 'created_at' AND NOT p_sort_ascending THEN c.created_at END DESC,
    CASE WHEN p_sort_column = 'updated_at' AND p_sort_ascending THEN c.updated_at END ASC,
    CASE WHEN p_sort_column = 'updated_at' AND NOT p_sort_ascending THEN c.updated_at END DESC,
    -- Default sort when caller passes an unrecognized column name:
    CASE WHEN p_sort_column NOT IN (
      'name', 'name_for_emails', 'website', 'domain', 'num_employees', 'industry', 'short_description', 'founded_year', 'number_of_retail_locs', 'annual_revenue', 'total_funding', 'latest_funding', 'latest_funding_amount', 'last_raised_at', 'street', 'city', 'state', 'country', 'postal_code', 'address', 'phone', 'linkedin_url', 'facebook_url', 'twitter_url', 'logo_url', 'subsidiary_of', 'keywords', 'sic_codes', 'naics_codes', 'technologies', 'quality_score', 'created_at', 'updated_at'
    ) AND p_sort_ascending THEN c.created_at END ASC,
    CASE WHEN p_sort_column NOT IN (
      'name', 'name_for_emails', 'website', 'domain', 'num_employees', 'industry', 'short_description', 'founded_year', 'number_of_retail_locs', 'annual_revenue', 'total_funding', 'latest_funding', 'latest_funding_amount', 'last_raised_at', 'street', 'city', 'state', 'country', 'postal_code', 'address', 'phone', 'linkedin_url', 'facebook_url', 'twitter_url', 'logo_url', 'subsidiary_of', 'keywords', 'sic_codes', 'naics_codes', 'technologies', 'quality_score', 'created_at', 'updated_at'
    ) AND NOT p_sort_ascending THEN c.created_at END DESC,
    -- Deterministic tiebreaker: see search_contacts for rationale. Adding
    -- c.id ASC as the final ORDER BY term breaks ties consistently across
    -- paginated requests; doesn't change primary sort behavior.
    c.id ASC
  LIMIT p_limit
  OFFSET p_offset;
$function$


CREATE OR REPLACE FUNCTION public.search_contacts_count(p_query text, p_list text DEFAULT NULL)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT count(*)::bigint
  FROM public.contacts c
    WHERE
    (p_list IS NULL OR p_list = '' OR p_list = ANY(c.lists))
    AND (
    -- Empty query: return everything.
    p_query IS NULL OR p_query = ''
    OR
    (
      -- Substring search across the 35 non-gated TEXT+ARRAY columns.
      -- Array columns: per-element substring match via unnest+EXISTS.
      -- Text columns: ILIKE substring (safe; wildcards aren't a leak
      -- here because text columns aren't the privacy-sensitive ones).
      c.first_name ILIKE '%' || p_query || '%'
      OR c.last_name ILIKE '%' || p_query || '%'
      OR c.email_status ILIKE '%' || p_query || '%'
      OR c.email_source ILIKE '%' || p_query || '%'
      OR c.email_verification_source ILIKE '%' || p_query || '%'
      OR c.email_catch_all_status ILIKE '%' || p_query || '%'
      OR c.secondary_email_source ILIKE '%' || p_query || '%'
      OR c.secondary_email_status ILIKE '%' || p_query || '%'
      OR c.tertiary_email_source ILIKE '%' || p_query || '%'
      OR c.tertiary_email_status ILIKE '%' || p_query || '%'
      OR c.title ILIKE '%' || p_query || '%'
      OR c.seniority ILIKE '%' || p_query || '%'
      OR c.company_name ILIKE '%' || p_query || '%'
      OR c.work_direct_phone ILIKE '%' || p_query || '%'
      OR c.mobile_phone ILIKE '%' || p_query || '%'
      OR c.corporate_phone ILIKE '%' || p_query || '%'
      OR c.home_phone ILIKE '%' || p_query || '%'
      OR c.other_phone ILIKE '%' || p_query || '%'
      OR c.city ILIKE '%' || p_query || '%'
      OR c.state ILIKE '%' || p_query || '%'
      OR c.country ILIKE '%' || p_query || '%'
      OR c.industry ILIKE '%' || p_query || '%'
      OR c.vertical ILIKE '%' || p_query || '%'
      OR c.company_city ILIKE '%' || p_query || '%'
      OR c.company_state ILIKE '%' || p_query || '%'
      OR c.company_country ILIKE '%' || p_query || '%'
      OR c.company_address ILIKE '%' || p_query || '%'
      OR c.company_phone ILIKE '%' || p_query || '%'
      OR c.latest_funding ILIKE '%' || p_query || '%'
      OR c.stage ILIKE '%' || p_query || '%'
      OR EXISTS (SELECT 1 FROM unnest(c.departments)     elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.sub_departments) elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.keywords)        elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.technologies)    elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.lists)           elem WHERE elem ILIKE '%' || p_query || '%')
      -- Email exact-match channel: PLAIN EQUALITY, gated on a syntactically
      -- valid full email. NOT ILIKE -- underscore in email addresses would
      -- otherwise be treated as a wildcard. Only fires when the query
      -- matches a complete address; partial fragments never narrow results.
      OR (
        p_query ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
        AND (
          c.email_normalized = lower(trim(p_query))
          OR lower(trim(c.secondary_email)) = lower(trim(p_query))
          OR lower(trim(c.tertiary_email)) = lower(trim(p_query))
        )
      )
    )
    )
$function$


CREATE OR REPLACE FUNCTION public.search_companies_count(p_query text, p_list text DEFAULT NULL)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT count(*)::bigint
  FROM public.companies c
    WHERE
    (p_list IS NULL OR p_list = '' OR p_list = ANY(c.lists))
    AND (
    p_query IS NULL OR p_query = ''
    OR
    (
      -- Substring search across the 18 non-gated TEXT+ARRAY columns.
      c.name ILIKE '%' || p_query || '%'
      OR c.name_for_emails ILIKE '%' || p_query || '%'
      OR c.domain ILIKE '%' || p_query || '%'
      OR c.industry ILIKE '%' || p_query || '%'
      OR c.short_description ILIKE '%' || p_query || '%'
      OR c.latest_funding ILIKE '%' || p_query || '%'
      OR c.street ILIKE '%' || p_query || '%'
      OR c.city ILIKE '%' || p_query || '%'
      OR c.state ILIKE '%' || p_query || '%'
      OR c.country ILIKE '%' || p_query || '%'
      OR c.postal_code ILIKE '%' || p_query || '%'
      OR c.address ILIKE '%' || p_query || '%'
      OR c.phone ILIKE '%' || p_query || '%'
      OR c.subsidiary_of ILIKE '%' || p_query || '%'
      OR EXISTS (SELECT 1 FROM unnest(c.keywords)     elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.sic_codes)   elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.naics_codes)  elem WHERE elem ILIKE '%' || p_query || '%')
      OR EXISTS (SELECT 1 FROM unnest(c.technologies) elem WHERE elem ILIKE '%' || p_query || '%')
    )
    )
$function$

