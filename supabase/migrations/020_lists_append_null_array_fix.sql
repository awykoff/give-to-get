-- 020_lists_append_null_array_fix.sql
--
-- Fix the NULL-array trap in the migration-019 list-append RPCs
-- (contact_list_append / company_list_append).
--
-- Symptom: "0 of N" when adding a contact to a list.
-- Root cause:  NOT (p_list_name = ANY(lists))  with lists = NULL evaluates
-- to NULL, so the outer AND-chain is not true and the row is silently
-- excluded from the UPDATE. A tag is placed but the count never increments.
-- contacts.lists is nullable (since 002); companies.lists is NOT NULL
-- DEFAULT '{}' (since 018), so only the contacts path actually breaks.
--
-- Two layers of fix:
--   1. COALESCE the array in both append RPCs — on the SET side and on the
--      idempotency predicate — so NULL lists behave as '{}'. This is the
--      operative fix for the contacts path.
--   2. Make contacts.lists non-nullable with DEFAULT '{}', closing the whole
--      NULL-list class of bugs for contacts (mirrors companies at 018).
--
-- Applied to production via Dashboard SQL Editor, statement-by-statement,
-- on the day the bug was reproduced; verified live ("0 of 1" -> "1 of 1").
-- This file commits the source to close the reverse-drift gap (the applied
-- migration had no committed .sql file, same shape as 010 before it and 021
-- after it).

-- 1. contact_list_append — COALESCE the array on both the write and the
--    idempotency predicate. Ownership predicate unchanged from 019.
CREATE OR REPLACE FUNCTION public.contact_list_append(p_contact_id uuid, p_list_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  UPDATE public.contacts
  SET lists = array_append(COALESCE(lists, '{}'), p_list_name)
  WHERE id = p_contact_id
    AND contributed_by_workspace_id = private.auth_workspace_id()
    AND NOT (p_list_name = ANY(COALESCE(lists, '{}')));
  RETURN (FOUND AND p_list_name IS NOT NULL AND p_list_name <> '');
END;
$$;

-- 2. company_list_append — same COALESCE guard for symmetry. A no-op today
--    (companies.lists is NOT NULL DEFAULT '{}' since 018) but keeps the two
--    append RPCs identical in shape.
CREATE OR REPLACE FUNCTION public.company_list_append(p_company_id uuid, p_list_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  UPDATE public.companies
  SET lists = array_append(COALESCE(lists, '{}'), p_list_name)
  WHERE id = p_company_id
    AND contributed_by_workspace_id = private.auth_workspace_id()
    AND NOT (p_list_name = ANY(COALESCE(lists, '{}')));
  RETURN (FOUND AND p_list_name IS NOT NULL AND p_list_name <> '');
END;
$$;

-- 3. contacts.lists — give nullable lists a default so new rows start with
--    an empty array instead of NULL.
ALTER TABLE public.contacts ALTER COLUMN lists SET DEFAULT '{}';

-- 4. Backfill existing NULL lists to the empty array.
UPDATE public.contacts SET lists = '{}' WHERE lists IS NULL;

-- 5. Enforce NOT NULL, closing the NULL-list class for contacts.
ALTER TABLE public.contacts ALTER COLUMN lists SET NOT NULL;