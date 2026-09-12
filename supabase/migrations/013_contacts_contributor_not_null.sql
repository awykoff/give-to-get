-- =====================================================================
-- 013_contacts_contributor_not_null.sql
--
-- Adds a NOT NULL constraint on contacts.contributed_by_workspace_id
-- (with an explicit CHECK constraint as belt-and-suspenders) so that
-- every contact row has a real contributing workspace. Combined with
-- import-path validation (added separately to import-processor and
-- any future import path), this makes the NULL-attributed state
-- permanently impossible rather than something we have to define
-- behavior for.
--
-- Why this exists
-- ---------------
-- Aaron caught 2026-09-11 that the Contacts page filter in
-- ContactsTable.tsx line 87-91 silently excludes every contact with
-- contributed_by_workspace_id = NULL from every user's view, via the
-- SQL three-valued-logic rule: NULL NOT IN (any-list) evaluates to
-- UNKNOWN, and WHERE excludes UNKNOWN. The behavior was by accident
-- of the SQL semantics, not by design. Production currently has 0
-- NULL-attributed rows (verified 2026-09-11 by direct count), so
-- adding the constraint is zero-risk.
--
-- Decision recorded in
-- ~/.hermes/messages/2026-09-11-on-demand-tester-pool-phase-1-proposal.md
-- § "NULL attribution -- DECIDED: Option 3" and in the vault Issue
-- draft 01-Projects/give-to-get/Issues/2026-09-11-contacts-null-attribution-filter-trap.md.
--
-- Schema choice
-- -------------
-- Two redundant enforcement layers:
--
--   1. NOT NULL on the column. Postgres rejects NULL inserts and
--      updates with the standard error "null value in column
--      "contributed_by_workspace_id" of relation "contacts" violates
--      not-null constraint". This is the canonical, minimal way to
--      express the constraint.
--
--   2. CHECK (contributed_by_workspace_id IS NOT NULL) as an
--      explicit named constraint. Postgres already enforces NOT NULL
--      via the implicit NOT NULL check, so this is technically
--      redundant. It's included for two reasons:
--        - The constraint name documents intent in
--          information_schema.table_constraints (and shows up in
--          psql's \d contacts output), making the design decision
--          discoverable.
--        - Belt-and-suspenders: if a future migration ever drops
--          the NOT NULL (e.g., for a "soft delete" feature), the
--          CHECK constraint remains as a louder failure mode.
--
-- Import-path validation lives elsewhere (in the import Edge
-- Functions). It's the first-line defense -- produce a clean error
-- with useful context (which row, what column, why). The DB
-- constraint is the last-line defense -- catch anything the
-- application check missed. Defense in depth.
--
-- RLS
-- ---
-- No policy changes. The existing contacts policies (contacts_select,
-- contacts_insert, contacts_network_select from 002 and 008) operate
-- on the rows regardless of NOT NULL state. The NOT NULL constraint
-- is a column-level constraint, not a row-level policy; it applies
-- to INSERT and UPDATE regardless of which role is writing.
--
-- One subtle interaction worth noting: the contacts_insert policy
-- permits inserts only when auth.role() = 'service_role'. The
-- import Edge Function runs as service_role, so its INSERTs are
-- subject to the constraint. Direct INSERTs from the anon-keyed
-- client would already be blocked by the policy before reaching
-- the constraint check.
--
-- Apply order
-- -----------
-- Independent of all prior migrations. Apply AFTER 002 (which
-- defines the canonical schema) and AFTER any migration that
-- backfilled NULLs to a sentinel workspace (there is no such
-- migration today because production has zero NULL rows). Apply
-- BEFORE the schema-drift fix on ananda/contacts-schema-drift-fix
-- merges -- that fix surfaces the Contacts page bug (column-name
-- error masking the NULL trap), and the NOT NULL constraint makes
-- the NULL trap permanently impossible.
--
-- Apply via psql, supabase db push, or the Dashboard SQL editor.
-- =====================================================================

-- Sanity check before adding the constraint: confirm zero NULL rows.
-- This is a guard against accidentally applying this migration to
-- a database that DOES have NULL rows (which would fail with
-- "column 'contributed_by_workspace_id' contains null values" and
-- require manual backfill). If this returns anything other than 0,
-- STOP and backfill first.

DO $$
DECLARE
  null_row_count INTEGER;
BEGIN
  SELECT count(*) INTO null_row_count
  FROM public.contacts
  WHERE contributed_by_workspace_id IS NULL;

  IF null_row_count > 0 THEN
    RAISE EXCEPTION 'Cannot apply NOT NULL: % contacts rows have NULL contributed_by_workspace_id. Backfill first, then retry.', null_row_count;
  END IF;
END
$$;

-- Layer 1: column-level NOT NULL.
ALTER TABLE public.contacts
  ALTER COLUMN contributed_by_workspace_id SET NOT NULL;

-- Layer 2: named CHECK constraint (redundant with the NOT NULL but
-- documents intent and survives any future column-NOT-NULL drop).
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_contributor_not_null
  CHECK (contributed_by_workspace_id IS NOT NULL);

COMMENT ON CONSTRAINT contacts_contributor_not_null ON public.contacts IS
  'Documents the design decision (Option 3, decided 2026-09-11) that '
  'every contact row must have a real contributing workspace. The NOT NULL '
  'on contributed_by_workspace_id is the primary enforcement; this CHECK '
  'is belt-and-suspenders and exists to surface intent in '
  'information_schema.table_constraints and to survive any future '
  'NOT NULL drop.';

-- ---------------------------------------------------------------------
-- Verification helpers (comments only -- no live SQL). Aaron applies
-- this migration in Supabase, then can run:
--
--   SELECT count(*) FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'contacts'
--     AND column_name = 'contributed_by_workspace_id'
--     AND is_nullable = 'NO';
--   -- Expected: 1
--
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.contacts'::regclass
--     AND contype = 'c'
--     AND conname LIKE '%contributor%';
--   -- Expected: contacts_contributor_not_null
--
--   -- Negative test: this should fail with a not-null violation
--   -- on the new constraint (NOT the email NOT NULL). All NOT NULL
--   -- columns must be supplied so the failure surfaces at our
--   -- constraint, not at some other column. Supplied columns:
--   --   first_name (NOT NULL)
--   --   email (NOT NULL, plus email_normalized is GENERATED ALWAYS)
--   --   first_name_normalized, last_name_normalized are GENERATED too.
--   -- The contributed_by_workspace_id is intentionally NULL so we hit
--   -- the constraint we're testing.
--   INSERT INTO public.contacts (first_name, email, contributed_by_workspace_id)
--   VALUES ('Should', 'should.fail@fixtures.invalid', NULL);
--   -- Expected: ERROR: null value in column "contributed_by_workspace_id"
--   --   of relation "contacts" violates not-null constraint
--
-- ---------------------------------------------------------------------