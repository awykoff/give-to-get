-- =====================================================================
-- 016_search_count_rpc.sql
--
-- Adds companion COUNT RPCs to 015's search functions:
--   public.search_contacts_count(p_query text)  -> bigint
--   public.search_companies_count(p_query text) -> bigint
--
-- WHY (the Default-2 bug, proven live 2026-09-13):
--   015 returns SETOF ... via SELECT c.* with LIMIT p_limit INSIDE the
--   function body. PostgREST's count:'exact' therefore counts the
--   already-limited page, not the underlying set: p_limit=10 -> total 10,
--   p_limit=50 -> total 50, while the real contacts table has 10,622 rows.
--   So .rpc(name, args, { count: "exact" }) gives the PAGE count, which
--   is wrong for the pagination footer and the "N results" text.
--
--   These count RPCs mirror 015's WHERE EXACTLY (extracted programmatically
--   from 015, not hand-retold) minus LIMIT/OFFSET/ORDER BY, returning the
--   true grand total for the given search string.
--
--   The count depends ONLY on p_query — not sort column, not direction, not
--   page. The client fetches it ONCE per distinct search string and reuses
--   it across page-turn and sort-header changes. See search.ts.
--
-- SECURITY DEFINER + search_path TO '' hardens like 008/009/010/012/015.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.search_contacts_count(p_query text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT count(*)::bigint
  FROM public.contacts c
  WHERE
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
$$;

COMMENT ON FUNCTION public.search_contacts_count IS 'Grand-total count of contacts matching p_query (same WHERE as search_contacts, minus LIMIT/OFFSET/ORDER BY). Companion to the Default-2 count fix.';

REVOKE ALL ON FUNCTION public.search_contacts_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_contacts_count(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_companies_count(p_query text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT count(*)::bigint
  FROM public.companies c
  WHERE
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
$$;

COMMENT ON FUNCTION public.search_companies_count IS 'Grand-total count of companies matching p_query (same WHERE as search_companies, minus LIMIT/OFFSET/ORDER BY). Companion to the Default-2 count fix.';

REVOKE ALL ON FUNCTION public.search_companies_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_companies_count(text) TO anon, authenticated;
