-- =====================================================================
-- 015_contacts_companies_search_rpc.sql
--
-- Adds two SECURITY DEFINER RPCs powering the Contacts/Companies
-- pages' search bar:
--   public.search_contacts(p_query text, p_limit int, p_offset int,
--                           p_sort_column text, p_sort_ascending boolean)
--   public.search_companies(...) -- same signature, returns SETOF companies
--
-- Why SECURITY DEFINER + search_path = ''
-- ---------------------------------------
-- Same shape as 008/009/010/012: the function body needs to fully-qualify
-- references (`public.contacts`, `public.companies`,
-- `public.v_my_network_workspace_ids`, etc.). With `SET search_path TO ''`
-- the empty search_path means unqualified references fail; qualified
-- references resolve. SECURITY DEFINER runs the function with the
-- privileges of its definer, which is what allows the function to query
-- tables that the calling user might not otherwise have direct access to
-- (or that would otherwise be subject to RLS in ways that would block
-- legitimate reads). contacts_select USING (true) makes every contact
-- globally visible anyway, so SECURITY DEFINER doesn't expose data the
-- caller couldn't see directly; same for companies under companies_select.
--
-- Two search channels in ONE RPC each
-- -----------------------------------
-- 1. Substring search across TEXT (33 contacts / 14 companies) and ARRAY
--    (5 contacts / 4 companies) columns — 35 contact search keys,
--    18 company search keys. Excludes the 4 gated email columns
--    (email, email_normalized, secondary_email, tertiary_email) so
--    partial email fragments never narrow results (the user-typing-
--    a-reconstruction-attack defense).
-- 2. Email exact-match channel — PLAIN EQUALITY, gated on a syntactically
--    valid full address per the regex ^[^\s@]+@[^\s@]+\.[^\s@]+$.
--    Uses `=` not `ilike`. ILIKE would treat `_` and `%` in the query
--    as SQL wildcards, and email addresses routinely contain
--    underscores — so `secondary_email ILIKE query` would let an
--    attacker place `_` at different positions and watch which produces a
--    hit, reconstructing an unknown address one character at a time.
--    That's the exact attack this whole design exists to prevent,
--    reintroduced through ILIKE instead of substring matching. The fix
--    is plain equality: `c.email_normalized = lower(trim(p_query))`,
--    `lower(trim(c.secondary_email)) = lower(trim(p_query))`,
--    `lower(trim(c.tertiary_email)) = lower(trim(p_query))`.
--
-- Why this exists (open engineering question, resolved)
-- -----------------------------------------------------
-- The Contacts/Companies redesign mockup specifies a search bar that
-- spans ~38 fields of mixed types including ARRAY columns
-- (departments, sub_departments, keywords, technologies, lists,
-- sic_codes, naics_codes). Plain PostgREST `.ilike()` over an ARRAY
-- column casts the whole ARRAY to text and substring-matches against
-- the cast representation, which is wrong for per-element matching.
-- A naive client-built `.or()` across 38 columns won't work correctly
-- for the ARRAY ones. Server-side RPC with real SQL handles both cases
-- uniformly.
--
-- Sort + pagination
-- -----------------
-- Server-side across the FULL result set, per the locked decision that
-- sort cannot be client-side over 1,485+ rows. p_limit defaults to 50
-- (matching the existing ContactsTable page size); p_offset defaults
-- to 0. p_sort_column is whitelisted via CASE expressions to prevent
-- SQL injection through dynamic column-name arguments.
--
-- Deterministic tiebreaker: the ORDER BY chain ends with `c.id ASC`
-- (see inline 7-line comment above each tiebreaker line). This looks
-- removable to anyone unfamiliar with this thread; do NOT remove it
-- without confirming the privacy/postgres-stability consequences in
-- the inline comment.
--
-- Apply order
-- -----------
-- Apply AFTER 008 (which creates v_my_network_workspace_ids -- not
-- referenced directly by this RPC, but the dependent context) and
-- AFTER 002 (which creates the contacts and companies tables in their
-- canonical 66/38-column shape).
--
-- Schema-migrations note
-- ---------------------
-- Not affected by the 013-bookkeeping gap; 015 is its own migration.
-- Does not depend on migration 014 (which was the abandoned
-- v_contacts_pool view -- intentionally NOT applied).
--
-- =====================================================================

-- ============================================================================
-- search_contacts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_contacts(
  p_query         text,
  p_limit         int    DEFAULT 50,
  p_offset        int    DEFAULT 0,
  p_sort_column   text   DEFAULT 'created_at',
  p_sort_ascending boolean DEFAULT false
)
RETURNS SETOF public.contacts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT c.*
  FROM public.contacts c
  WHERE
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
$$;

COMMENT ON FUNCTION public.search_contacts IS
  'Paginated, server-side-searched contacts. Substring across 35 non-gated TEXT/ARRAY columns + '
  'plain-equality email exact-match gated on ^[^\s@]+@[^\s@]+\.[^\s@]+$. SECURITY DEFINER because '
  'the contact row visibility under contacts_select USING (true) is equivalent to SECURITY INVOKER '
  'for this query, but SECURITY DEFINER matches the codebase pattern (008/009/010/012) and lets '
  'the function body fully-qualify references under SET search_path TO ''. See migration 015 '
  'header for the email-exact-match security rationale (why NOT ilike on email columns).';

REVOKE ALL ON FUNCTION public.search_contacts(text, int, int, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_contacts(text, int, int, text, boolean) TO anon, authenticated;

-- ============================================================================
-- search_companies
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_companies(
  p_query         text,
  p_limit         int    DEFAULT 50,
  p_offset        int    DEFAULT 0,
  p_sort_column   text   DEFAULT 'created_at',
  p_sort_ascending boolean DEFAULT false
)
RETURNS SETOF public.companies
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT c.*
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
$$;

COMMENT ON FUNCTION public.search_companies IS
  'Paginated, server-side-searched companies. Substring across 18 non-gated TEXT/ARRAY columns. '
  'No email-exact-match branch (companies have no email columns). SECURITY DEFINER for the same '
  'reasons as search_contacts; see migration 015 header.';

REVOKE ALL ON FUNCTION public.search_companies(text, int, int, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_companies(text, int, int, text, boolean) TO anon, authenticated;