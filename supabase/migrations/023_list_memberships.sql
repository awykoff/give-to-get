-- 023_list_memberships.sql
--
-- Phase 1 of privatizing list membership OFF the shared rows.
--
-- Today a "list" is a tag stored ON the shared contact/company row
-- (contacts.lists / companies.lists). Consequences: only the contributing
-- workspace can tag a row, and the tag names are visible to every workspace
-- that can see the row. This migration moves membership to per-workspace
-- tables so any pool-visible contact can be put in the CALLER's OWN lists
-- without writing list names onto shared rows or leaking one workspace's
-- lists to another.
--
--   1. people_list_members / company_list_members (workspace-owned list +
--      member id, CASCADE both ways), RLS SELECT-only for the list owner's
--      workspace; writes ONLY through SECURITY DEFINER RPCs.
--   2. Re-run 022's idempotent list backfill (tags -> rows) so a tag with no
--      list row cannot be dropped, then backfill memberships: every existing
--      tag becomes a membership in the contributing workspace's list. Only
--      the contributor could ever place a tag, so ownership is unambiguous.
--   3. contact_list_append / company_list_append (SIGNATURES UNCHANGED):
--      ensure the caller's list, insert the membership idempotently, and
--      existence-check the contact ONLY (no ownership). NEVER write
--      contacts.lists / companies.lists.
--   4. delete_*_list: DELETE the list row; memberships CASCADE. NEVER modify
--      contact/company rows (the legacy tag-strip from 022 stops).
--   5. list_member_counts_*: count MEMBERSHIPS (zero-member lists show 0).
--   6. DROP the stale pre-019 search overloads (015/016 arity, no p_list).
--      The 5-arg search_contacts / 1-arg search_contacts_count unnested
--      c.lists in free-text, matching other workspaces' tag names - a
--      cross-workspace leak; all four stale overloads are unreachable from
--      the app but callable via PostgREST, so they are DROPPED, not just
--      left in place.
--   7. search_* / *_count: p_list filters via a memberships EXISTS on the
--      caller's OWN list (replaces 022's Option-B contributed-only
--      predicate); the free-text unnest(c.lists) clause is removed. Roster
--      count == list count (both derive from the member tables).
--   8. contact_list_bulk_append(p_list, uuid[]) RETURNS (matched, added) for
--      Phase 2 (import into a list); cap 500 ids/call; chunking stays at the
--      import layer. Phase 2 is people-only (no company import path exists).
--
-- APPLY: 31 statements total, one per SQL-editor paste. (Count includes the
-- 2 CREATE INDEX on the member tables — an earlier note mistakenly totaled
-- 29 without them. Summary: 2 table + 2 index + 2 ALTER RLS + 2 policy +
-- 2 GRANT SELECT + 4 INSERT + 11 CREATE OR REPLACE FUNCTION + 4 DROP
-- FUNCTION + 1 REVOKE + 1 GRANT EXECUTE.)
--
-- ## VERIFICATION (Aaron - run AFTER applying, do not trust the banner) ##
-- (a) Overloads: exactly ONE overload per name.
--     SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public'
--       AND p.proname IN ('search_contacts','search_companies',
--           'search_contacts_count','search_companies_count')
--     ORDER BY p.proname;
-- (b) Backfill count match: BEFORE vs AFTER must be equal.
--     BEFORE (distinct (contact_id,tag) with a real contributor):
--     SELECT count(*) FROM (
--       SELECT DISTINCT c.id, c.contributed_by_workspace_id, l
--       FROM public.contacts c CROSS JOIN LATERAL unnest(c.lists) AS l
--       WHERE c.contributed_by_workspace_id IS NOT NULL) t;  -- people
--     (analogous for companies with co.*)
--     AFTER:
--     SELECT count(*) FROM public.people_list_members;  -- people
--     SELECT count(*) FROM public.company_list_members; -- companies
--     Any difference must be explained (ON CONFLICT DO NOTHING dedups a
--     genuinely duplicated tag; that is the only expected reduction).
-- (c) Search no longer references the legacy column:
--     SELECT pg_get_functiondef('public.search_contacts(text,int,int,text,boolean,text)'::regprocedure);
--     -> body should reference people_list_members and NOT unnest(c.lists).

-- ─────────────────────────────────────────────
-- 1. MEMBERSHIP TABLES + RLS
-- ─────────────────────────────────────────────

CREATE TABLE public.people_list_members (
  list_id     uuid NOT NULL REFERENCES public.people_lists(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_list_members_pk PRIMARY KEY (list_id, contact_id)
);
CREATE INDEX idx_people_list_members_contact ON public.people_list_members (contact_id);

CREATE TABLE public.company_list_members (
  list_id     uuid NOT NULL REFERENCES public.company_lists(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_list_members_pk PRIMARY KEY (list_id, company_id)
);
CREATE INDEX idx_company_list_members_company ON public.company_list_members (company_id);

ALTER TABLE public.people_list_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_list_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "people_list_members_owned" ON public.people_list_members
  FOR SELECT TO authenticated
  USING (list_id IN (
    SELECT id FROM public.people_lists WHERE workspace_id = private.auth_workspace_id()));

CREATE POLICY "company_list_members_owned" ON public.company_list_members
  FOR SELECT TO authenticated
  USING (list_id IN (
    SELECT id FROM public.company_lists WHERE workspace_id = private.auth_workspace_id()));

GRANT SELECT ON public.people_list_members  TO authenticated;
GRANT SELECT ON public.company_list_members TO authenticated;


-- ─────────────────────────────────────────────
-- 2. BACKFILL (list rows re-run idempotently, then memberships)
-- ─────────────────────────────────────────────
-- Re-run 022's list backfill FIRST so a tag cannot be silently dropped by
-- the membership join (a tag with no people_lists row would not match).

INSERT INTO public.people_lists (workspace_id, name)
SELECT DISTINCT c.contributed_by_workspace_id, l
FROM public.contacts c CROSS JOIN LATERAL unnest(c.lists) AS l
WHERE c.contributed_by_workspace_id IS NOT NULL
ON CONFLICT (workspace_id, name) DO NOTHING;

INSERT INTO public.company_lists (workspace_id, name)
SELECT DISTINCT co.contributed_by_workspace_id, l
FROM public.companies co CROSS JOIN LATERAL unnest(co.lists) AS l
WHERE co.contributed_by_workspace_id IS NOT NULL
ON CONFLICT (workspace_id, name) DO NOTHING;

-- Membership backfill (only the contributor could have placed a tag, so
-- ownership is unambiguous).
INSERT INTO public.people_list_members (list_id, contact_id)
SELECT pl.id, c.id
FROM public.contacts c
CROSS JOIN LATERAL unnest(c.lists) AS l
JOIN public.people_lists pl
  ON pl.workspace_id = c.contributed_by_workspace_id AND pl.name = l
WHERE c.contributed_by_workspace_id IS NOT NULL
ON CONFLICT (list_id, contact_id) DO NOTHING;

INSERT INTO public.company_list_members (list_id, company_id)
SELECT pl.id, co.id
FROM public.companies co
CROSS JOIN LATERAL unnest(co.lists) AS l
JOIN public.company_lists pl
  ON pl.workspace_id = co.contributed_by_workspace_id AND pl.name = l
WHERE co.contributed_by_workspace_id IS NOT NULL
ON CONFLICT (list_id, company_id) DO NOTHING;


-- ─────────────────────────────────────────────
-- 3. APPEND RPCs (signatures UNCHANGED; membership, not shared-row write)
-- ─────────────────────────────────────────────
-- Ensure the caller's list, insert the membership idempotently, existence-
-- check the contact only (no ownership). Return TRUE only when the
-- membership was newly inserted (feeds the toolbar's "X of Y added").

CREATE OR REPLACE FUNCTION public.contact_list_append(p_contact_id uuid, p_list_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  wid   uuid := private.auth_workspace_id();
  clean text := trim(p_list_name);
  lid   uuid;
BEGIN
  IF clean IS NULL OR clean = '' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact_id) THEN
    RETURN false;
  END IF;
  INSERT INTO public.people_lists (workspace_id, name)
  VALUES (wid, clean)
  ON CONFLICT (workspace_id, name) DO NOTHING
  RETURNING id INTO lid;
  IF lid IS NULL THEN
    SELECT id INTO lid FROM public.people_lists WHERE workspace_id = wid AND name = clean;
  END IF;
  INSERT INTO public.people_list_members (list_id, contact_id)
  VALUES (lid, p_contact_id)
  ON CONFLICT (list_id, contact_id) DO NOTHING;
  RETURN FOUND;  -- true ONLY when the membership was newly inserted
END;
$$;

CREATE OR REPLACE FUNCTION public.company_list_append(p_company_id uuid, p_list_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  wid   uuid := private.auth_workspace_id();
  clean text := trim(p_list_name);
  lid   uuid;
BEGIN
  IF clean IS NULL OR clean = '' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RETURN false;
  END IF;
  INSERT INTO public.company_lists (workspace_id, name)
  VALUES (wid, clean)
  ON CONFLICT (workspace_id, name) DO NOTHING
  RETURNING id INTO lid;
  IF lid IS NULL THEN
    SELECT id INTO lid FROM public.company_lists WHERE workspace_id = wid AND name = clean;
  END IF;
  INSERT INTO public.company_list_members (list_id, company_id)
  VALUES (lid, p_company_id)
  ON CONFLICT (list_id, company_id) DO NOTHING;
  RETURN FOUND;
END;
$$;


-- ─────────────────────────────────────────────
-- 4. DELETE (list row + CASCADE memberships; NEVER touches shared rows)
-- ─────────────────────────────────────────────
-- 022's tag-strip on contact/company rows is removed; memberships go by
-- cascade.

CREATE OR REPLACE FUNCTION public.delete_people_list(p_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE wid uuid := private.auth_workspace_id(); clean text := trim(p_name);
BEGIN
  DELETE FROM public.people_lists WHERE workspace_id = wid AND name = clean;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_company_list(p_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE wid uuid := private.auth_workspace_id(); clean text := trim(p_name);
BEGIN
  DELETE FROM public.company_lists WHERE workspace_id = wid AND name = clean;
  RETURN FOUND;
END;
$$;


-- ─────────────────────────────────────────────
-- 5. MEMBER COUNTS (count memberships; zero-member lists show 0)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.list_member_counts_contacts()
RETURNS TABLE (list_name text, record_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT pl.name, count(m.contact_id)::bigint
  FROM public.people_lists pl
  LEFT JOIN public.people_list_members m ON m.list_id = pl.id
  WHERE pl.workspace_id = private.auth_workspace_id()
  GROUP BY pl.id, pl.name
  ORDER BY pl.name
$$;

CREATE OR REPLACE FUNCTION public.list_member_counts_companies()
RETURNS TABLE (list_name text, record_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT pl.name, count(m.company_id)::bigint
  FROM public.company_lists pl
  LEFT JOIN public.company_list_members m ON m.list_id = pl.id
  WHERE pl.workspace_id = private.auth_workspace_id()
  GROUP BY pl.id, pl.name
  ORDER BY pl.name
$$;


-- ─────────────────────────────────────────────
-- 6. DROP STALE PRE-019 SEARCH OVERLOADS (no p_list)
-- ─────────────────────────────────────────────
-- The 5-arg search_contacts / 1-arg search_contacts_count unnested c.lists
-- in free-text, matching other workspaces' tag names (cross-workspace leak);
-- all four stale overloads are unreachable from the app (it always passes
-- p_list) but callable via PostgREST with the old arity, so DROP not leave.

DROP FUNCTION public.search_contacts(text, integer, integer, text, boolean);
DROP FUNCTION public.search_companies(text, integer, integer, text, boolean);
DROP FUNCTION public.search_contacts_count(text);
DROP FUNCTION public.search_companies_count(text);



-- ─────────────────────────────────────────────
-- 7. SEARCH FUNCTIONS (Option-B -> membership EXISTS; drop unnest(c.lists))
-- ─────────────────────────────────────────────
-- Bodies from 022 (== live current overloads per verify-023-baseline.py) with
-- exactly the two intended edits; Postgres strips comments on store, so live
-- defs will render without them.

CREATE OR REPLACE FUNCTION public.search_contacts(p_query text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort_column text DEFAULT 'created_at'::text, p_sort_ascending boolean DEFAULT false, p_list text DEFAULT NULL)
 RETURNS SETOF contacts
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.*
  FROM public.contacts c
    WHERE
    (p_list IS NULL OR p_list = '' OR EXISTS (SELECT 1 FROM public.people_list_members lm JOIN public.people_lists ll ON ll.id = lm.list_id WHERE ll.workspace_id = private.auth_workspace_id() AND ll.name = p_list AND lm.contact_id = c.id))
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
    (p_list IS NULL OR p_list = '' OR EXISTS (SELECT 1 FROM public.company_list_members lm JOIN public.company_lists ll ON ll.id = lm.list_id WHERE ll.workspace_id = private.auth_workspace_id() AND ll.name = p_list AND lm.company_id = c.id))
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
    (p_list IS NULL OR p_list = '' OR EXISTS (SELECT 1 FROM public.people_list_members lm JOIN public.people_lists ll ON ll.id = lm.list_id WHERE ll.workspace_id = private.auth_workspace_id() AND ll.name = p_list AND lm.contact_id = c.id))
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
    (p_list IS NULL OR p_list = '' OR EXISTS (SELECT 1 FROM public.company_list_members lm JOIN public.company_lists ll ON ll.id = lm.list_id WHERE ll.workspace_id = private.auth_workspace_id() AND ll.name = p_list AND lm.company_id = c.id))
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


-- ─────────────────────────────────────────────
-- 8. BULK APPEND (Phase 2 import into a list; people-only)
-- ─────────────────────────────────────────────
-- matched = ids that exist in contacts; added = memberships newly inserted
-- (ON CONFLICT DO NOTHING => ROW_COUNT counts only inserted). Cap 500/call.

CREATE OR REPLACE FUNCTION public.contact_list_bulk_append(p_list_name text, p_contact_ids uuid[])
RETURNS TABLE (matched bigint, added bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  wid        uuid := private.auth_workspace_id();
  clean      text := trim(p_list_name);
  lid        uuid;
  matched_n  bigint := 0;
  added_n    bigint := 0;
BEGIN
  IF clean IS NULL OR clean = '' OR p_contact_ids IS NULL OR cardinality(p_contact_ids) = 0 THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint;
    RETURN;
  END IF;
  IF cardinality(p_contact_ids) > 500 THEN
    RAISE EXCEPTION 'contact_list_bulk_append: >500 ids (got %), cap is 500', cardinality(p_contact_ids);
  END IF;
  INSERT INTO public.people_lists (workspace_id, name)
  VALUES (wid, clean)
  ON CONFLICT (workspace_id, name) DO NOTHING
  RETURNING id INTO lid;
  IF lid IS NULL THEN
    SELECT id INTO lid FROM public.people_lists WHERE workspace_id = wid AND name = clean;
  END IF;
  SELECT count(*) INTO matched_n
  FROM (SELECT DISTINCT u FROM unnest(p_contact_ids) AS u) ids
  JOIN public.contacts cc ON cc.id = ids.u;
  INSERT INTO public.people_list_members (list_id, contact_id)
  SELECT lid, u
  FROM unnest(p_contact_ids) AS u
  WHERE EXISTS (SELECT 1 FROM public.contacts cc WHERE cc.id = u)
  ON CONFLICT (list_id, contact_id) DO NOTHING;
  GET DIAGNOSTICS added_n = ROW_COUNT;
  RETURN QUERY SELECT matched_n, added_n;
END;
$$;

REVOKE ALL ON FUNCTION public.contact_list_bulk_append(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_list_bulk_append(text, uuid[]) TO authenticated;
