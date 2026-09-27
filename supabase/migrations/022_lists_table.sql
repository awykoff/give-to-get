-- 022_lists_table.sql
--
-- First-class, workspace-owned lists for people and companies.
--
-- Previous state: a "list" is only a string inside contacts.lists /
-- companies.lists TEXT[] arrays. A zero-member list cannot exist and the
-- "+ New list" button is a UI no-op. This migration makes a list an
-- independent, persistent, per-workspace object.
--
--   1. people_lists / company_lists tables (workspace-scoped, UNIQUE
--      (workspace_id, name)), RLS enabled, GRANT SELECT to authenticated
--      (writes go through SECURITY DEFINER RPCs only).
--   2. Backfill every distinct existing tag into the contributing
--      workspace's list row (scoped by contributed_by_workspace_id), so
--      existing real lists and their owner workspaces survive.
--   3. create_people_list / create_company_list — idempotent: returns the
--      existing list id if the name already exists for this workspace
--      (matches the forgiving idempotent-append UX).
--   4. delete_people_list / delete_company_list — removes BOTH the list
--      row AND strips the tag from every member row the caller owns.
--      (Today the Delete button is an unbound no-op; this is new behavior.)
--   5. list_member_counts_contacts/companies — rewritten to LEFT JOIN from
--      the list tables so zero-member lists appear with count 0, scoped to
--      the caller's workspace (ownership is now first-class). This is a
--      deliberate change from migration 019's "global/shared tag model" to
--      caller-scoped membership.
--   6. contact_list_append / company_list_append — rewritten to (a) ensure
--      the target list row exists idempotently (so a name tagged via the
--      Add-to-list toolbar can never vanish from the Lists pages once the
--      Lists pages are driven by the list tables), and (b) PRESERVE the
--      NULL-array COALESCE guard already applied to production by the
--      never-committed migration 020. That fix is live; we keep it.
--   7. search_contacts / search_companies / *_count — Option-B ownership
--      scope: when a specific list is chosen, the roster is restricted to
--      the caller's contributed rows (contributed_by_workspace_id =
--      private.auth_workspace_id()), matching the workspace-scoped counts
--      so a list's displayed count equals its click-through roster. No-list
--      behavior is unchanged. Bodies otherwise byte-faithful to 019 (live).
--
-- Ownership model: a list belongs to the workspace that created it,
-- resolved from the caller's JWT via private.auth_workspace_id().
--
-- APPLY NOTE (Supabase SQL Editor): paste one statement at a time in file
-- order — the editor rejects multi-statement paste. Count statements
-- up front. Before applying steps 6/7, run pg_get_functiondef on the live
-- contact_list_append / search_contacts to confirm the pre-images here
-- match prod (migration 020 was applied to prod but its source was never
-- committed, so its exact body is reconstructed here from the known shape).

-- ─────────────────────────────────────────────
-- 1. TABLES
-- ─────────────────────────────────────────────

CREATE TABLE public.people_lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_lists_workspace_name_uniq UNIQUE (workspace_id, name)
);

CREATE TABLE public.company_lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_lists_workspace_name_uniq UNIQUE (workspace_id, name)
);

ALTER TABLE public.people_lists  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_lists ENABLE ROW LEVEL SECURITY;

-- A workspace can see/read only the lists it owns. Writes (INSERT/DELETE)
-- flow through the SECURITY DEFINER RPCs below; direct SELECT is allowed so
-- future query paths can read the caller's own list names/ids.
CREATE POLICY "people_lists_owned" ON public.people_lists
  FOR SELECT TO authenticated
  USING (workspace_id = private.auth_workspace_id());

CREATE POLICY "company_lists_owned" ON public.company_lists
  FOR SELECT TO authenticated
  USING (workspace_id = private.auth_workspace_id());

GRANT SELECT ON public.people_lists  TO authenticated;
GRANT SELECT ON public.company_lists TO authenticated;


-- ─────────────────────────────────────────────
-- 2. BACKFILL — every existing tag -> the contributing workspace's row
-- ─────────────────────────────────────────────
-- A tag can only ever be placed on a contributed-by-caller row (the append
-- RPCs enforce it), so contributed_by_workspace_id names the owning
-- workspace. general-pool/partner-affected tags with no contributor are
-- skipped (IS NOT NULL); contacts is NOT NULL since 013, companies is
-- nullable. ON CONFLICT DO NOTHING is safe against any already-inserted row.

INSERT INTO public.people_lists (workspace_id, name)
SELECT DISTINCT c.contributed_by_workspace_id, l
FROM public.contacts c
CROSS JOIN LATERAL unnest(c.lists) AS l
WHERE c.contributed_by_workspace_id IS NOT NULL
ON CONFLICT (workspace_id, name) DO NOTHING;

INSERT INTO public.company_lists (workspace_id, name)
SELECT DISTINCT co.contributed_by_workspace_id, l
FROM public.companies co
CROSS JOIN LATERAL unnest(co.lists) AS l
WHERE co.contributed_by_workspace_id IS NOT NULL
ON CONFLICT (workspace_id, name) DO NOTHING;


-- ─────────────────────────────────────────────
-- 3. CREATE (idempotent) — returns the list id (new or existing)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_people_list(p_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  wid  uuid := private.auth_workspace_id();
  clean text := trim(p_name);
  lid  uuid;
BEGIN
  IF clean IS NULL OR clean = '' THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.people_lists (workspace_id, name)
  VALUES (wid, clean)
  ON CONFLICT (workspace_id, name) DO NOTHING
  RETURNING id INTO lid;
  IF lid IS NULL THEN
    SELECT id INTO lid FROM public.people_lists
    WHERE workspace_id = wid AND name = clean;
  END IF;
  RETURN lid;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_company_list(p_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  wid  uuid := private.auth_workspace_id();
  clean text := trim(p_name);
  lid  uuid;
BEGIN
  IF clean IS NULL OR clean = '' THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.company_lists (workspace_id, name)
  VALUES (wid, clean)
  ON CONFLICT (workspace_id, name) DO NOTHING
  RETURNING id INTO lid;
  IF lid IS NULL THEN
    SELECT id INTO lid FROM public.company_lists
    WHERE workspace_id = wid AND name = clean;
  END IF;
  RETURN lid;
END;
$$;


-- ─────────────────────────────────────────────
-- 4. DELETE — remove the list row AND strip the tag from members
-- ─────────────────────────────────────────────
-- Delete-the-row-only would leave an orphan tag that still filters
-- ?list= but vanishes from the Lists page. Delete-the-tags-only would
-- leave a "0 records" list that won't go away. Both is the only
-- self-consistent "this list ceases to exist." Both steps are scoped to the
-- caller's contributed rows / the caller's list row.

CREATE OR REPLACE FUNCTION public.delete_people_list(p_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  wid  uuid := private.auth_workspace_id();
  clean text := trim(p_name);
BEGIN
  IF clean IS NULL OR clean = '' THEN
    RETURN false;
  END IF;
  UPDATE public.contacts
  SET lists = array_remove(lists, clean)
  WHERE contributed_by_workspace_id = wid
    AND clean = ANY(lists);
  DELETE FROM public.people_lists
  WHERE workspace_id = wid AND name = clean;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_company_list(p_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  wid  uuid := private.auth_workspace_id();
  clean text := trim(p_name);
BEGIN
  IF clean IS NULL OR clean = '' THEN
    RETURN false;
  END IF;
  UPDATE public.companies
  SET lists = array_remove(lists, clean)
  WHERE contributed_by_workspace_id = wid
    AND clean = ANY(lists);
  DELETE FROM public.company_lists
  WHERE workspace_id = wid AND name = clean;
  RETURN FOUND;
END;
$$;


-- ─────────────────────────────────────────────
-- 5. MEMBER COUNTS — LEFT JOIN from list tables, caller-scoped, count 0
-- ─────────────────────────────────────────────
-- The lists table now drives the rows, so zero-member lists appear (count
-- 0). Only the caller's workspace's lists are shown; the count is how many
-- of the caller's contributed rows carry that tag — matches the roster the
-- search functions return under Option B.

CREATE OR REPLACE FUNCTION public.list_member_counts_contacts()
RETURNS TABLE (list_name text, record_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT pl.name, count(c.id)::bigint
  FROM public.people_lists pl
  LEFT JOIN public.contacts c
    ON c.contributed_by_workspace_id = pl.workspace_id
   AND pl.name = ANY(c.lists)
  WHERE pl.workspace_id = private.auth_workspace_id()
  GROUP BY pl.id, pl.name
  ORDER BY pl.name
$$;

CREATE OR REPLACE FUNCTION public.list_member_counts_companies()
RETURNS TABLE (list_name text, record_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT pl.name, count(c.id)::bigint
  FROM public.company_lists pl
  LEFT JOIN public.companies c
    ON c.contributed_by_workspace_id = pl.workspace_id
   AND pl.name = ANY(c.lists)
  WHERE pl.workspace_id = private.auth_workspace_id()
  GROUP BY pl.id, pl.name
  ORDER BY pl.name
$$;


-- ─────────────────────────────────────────────
-- 6. APPEND REWRITE — ensure-list-row + preserve 020 NULL guard
-- ─────────────────────────────────────────────
-- New work here is ONLY the idempotent ensure-row INSERT (so a name tagged
-- via the toolbar can't vanish from the Lists pages). The COALESCE(lists,
-- '{}') NULL-array guard is the fix migration 020 already shipped to prod
-- — preserved here (for people AND company) for symmetry, not re-added as
-- new. On company the COALESCE is a no-op today (companies.lists is NOT
-- NULL since 018) but dropping already-shipped defensive code is not
-- acceptable without a comment, so we keep it. Ownership predicate unchanged.

CREATE OR REPLACE FUNCTION public.contact_list_append(p_contact_id uuid, p_list_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  wid   uuid := private.auth_workspace_id();
  clean text := trim(p_list_name);
BEGIN
  IF clean IS NULL OR clean = '' THEN
    RETURN false;
  END IF;
  -- Ensure the list row exists (idempotent), scoped to the caller's workspace.
  INSERT INTO public.people_lists (workspace_id, name)
  VALUES (wid, clean)
  ON CONFLICT (workspace_id, name) DO NOTHING;
  UPDATE public.contacts
  SET lists = array_append(COALESCE(lists, '{}'::text[]), clean)
  WHERE id = p_contact_id
    AND contributed_by_workspace_id = wid
    AND NOT (clean = ANY(COALESCE(lists, '{}'::text[])));
  RETURN (FOUND);
END;
$$;

CREATE OR REPLACE FUNCTION public.company_list_append(p_company_id uuid, p_list_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  wid   uuid := private.auth_workspace_id();
  clean text := trim(p_list_name);
BEGIN
  IF clean IS NULL OR clean = '' THEN
    RETURN false;
  END IF;
  INSERT INTO public.company_lists (workspace_id, name)
  VALUES (wid, clean)
  ON CONFLICT (workspace_id, name) DO NOTHING;
  UPDATE public.companies
  SET lists = array_append(COALESCE(lists, '{}'::text[]), clean)
  WHERE id = p_company_id
    AND contributed_by_workspace_id = wid
    AND NOT (clean = ANY(COALESCE(lists, '{}'::text[])));
  RETURN (FOUND);
END;
$$;


-- ─────────────────────────────────────────────
-- 7. SEARCH FUNCTIONS — Option-B roster ownership scope
-- ─────────────────────────────────────────────
-- Bodies copied byte-faithfully from 019 (certified live) with exactly one
-- edit each: the p_list predicate scopes to the caller's contributed rows.
-- No-list / empty-list behavior unchanged.

CREATE OR REPLACE FUNCTION public.search_contacts(p_query text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort_column text DEFAULT 'created_at'::text, p_sort_ascending boolean DEFAULT false, p_list text DEFAULT NULL)
 RETURNS SETOF contacts
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT c.*
  FROM public.contacts c
    WHERE
    (p_list IS NULL OR p_list = '' OR (c.contributed_by_workspace_id = private.auth_workspace_id() AND p_list = ANY(c.lists)))
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
    (p_list IS NULL OR p_list = '' OR (c.contributed_by_workspace_id = private.auth_workspace_id() AND p_list = ANY(c.lists)))
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
    (p_list IS NULL OR p_list = '' OR (c.contributed_by_workspace_id = private.auth_workspace_id() AND p_list = ANY(c.lists)))
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
    (p_list IS NULL OR p_list = '' OR (c.contributed_by_workspace_id = private.auth_workspace_id() AND p_list = ANY(c.lists)))
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
-- 8. GRANTS for new functions
-- ─────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.create_people_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_company_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_people_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_company_list(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_people_list(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_list(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_people_list(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_company_list(text) TO authenticated;
