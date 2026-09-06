-- give-to-get.com — Signup bootstrap (canonical shape)
-- Copy this file to supabase/migrations/00X_signup_bootstrap.sql and
-- apply via Supabase SQL Editor or `supabase db push`. Idempotent.
--
-- Ships in give-to-get.com as 006_signup_bootstrap.sql. Update the
-- filename when you copy.
--
-- What it does, in plain terms:
--   On every INSERT into auth.users (which fires for both email
--   confirmation signups and Google OAuth signups), it creates a
--   workspaces row, an admin workspace_members row, and a 100-credit
--   signup bonus in credits_ledger. The backfill block at the bottom
--   self-heals any auth.users row that exists at apply-time but has
--   no workspace_members entry.
--
-- Why this shape:
--   - private schema (matching 004_private_schema_security.sql pattern)
--     keeps trigger internals off-limits to anon/authenticated roles.
--   - SECURITY DEFINER + SET search_path = '' lets the trigger insert
--     into RLS-enabled tables without per-policy grants.
--   - The helper is split out from handle_new_user so the backfill
--     block can call the SAME function. One source of truth; can't drift.
--   - Idempotency guard (EXISTS check on workspace_members) makes
--     re-running the migration safe.
--   - Slug uniqueness is guaranteed by appending an 8-char suffix from
--     the user's UUID, so concurrent signups with the same email
--     local-part can't collide on the UNIQUE(slug) constraint.

-- ─────────────────────────────────────────
-- Provisioning helper — single source of truth
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.provision_workspace_for_user(
  p_user_id UUID,
  p_email   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id   UUID;
  v_workspace_name TEXT;
  v_slug_base      TEXT;
  v_slug           TEXT;
  v_email_local    TEXT;
BEGIN
  -- Idempotency: skip if this user already has a workspace.
  IF EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = p_user_id) THEN
    SELECT workspace_id INTO v_workspace_id
    FROM public.workspace_members WHERE user_id = p_user_id LIMIT 1;
    RETURN v_workspace_id;
  END IF;

  -- Derive workspace name + unique slug from the email local-part.
  v_email_local := split_part(COALESCE(p_email, 'user'), '@', 1);
  v_workspace_name := v_email_local || '''s workspace';
  v_slug_base := lower(regexp_replace(v_email_local, '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug_base := trim(BOTH '-' FROM v_slug_base);
  IF v_slug_base = '' THEN
    v_slug_base := 'workspace';
  END IF;
  v_slug := v_slug_base || '-' || substring(replace(p_user_id::text, '-', '') FROM 1 FOR 8);

  INSERT INTO public.workspaces (name, slug, owner_user_id, plan)
  VALUES (v_workspace_name, v_slug, p_user_id, 'free')
  RETURNING id INTO v_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by)
  VALUES (v_workspace_id, p_user_id, 'admin', p_user_id);

  -- 100-credit signup bonus. credits_ledger is append-only; this is
  -- the only legitimate INSERT path for the 'bonus' type at signup.
  INSERT INTO public.credits_ledger (
    workspace_id, type, amount, description,
    reference_type, balance_after, created_by
  ) VALUES (
    v_workspace_id, 'bonus', 100, 'Welcome bonus — 100 free credits',
    'signup', 100, p_user_id
  );

  RETURN v_workspace_id;
END;
$$;

-- ─────────────────────────────────────────
-- auth.users trigger
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM private.provision_workspace_for_user(NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Drop and recreate so re-running this migration is safe.
DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW
  EXECUTE FUNCTION private.handle_new_user();

-- ─────────────────────────────────────────
-- Backfill
-- ─────────────────────────────────────────
-- Provision workspaces for any auth.users row that already exists but
-- has no workspace_members entry. Self-heals accounts created between
-- the bug appearing and this migration being applied. Re-running the
-- migration is safe: the helper's idempotency guard skips users who
-- already have a workspace.

DO $$
DECLARE
  orphan RECORD;
BEGIN
  FOR orphan IN
    SELECT u.id, u.email
    FROM auth.users u
    LEFT JOIN public.workspace_members wm ON wm.user_id = u.id
    WHERE wm.user_id IS NULL
  LOOP
    PERFORM private.provision_workspace_for_user(orphan.id, orphan.email);
  END LOOP;
END $$;

-- ─────────────────────────────────────────
-- Apply-time verification (run these in SQL Editor after applying)
-- ─────────────────────────────────────────
--
-- 1. Confirm the trigger exists:
--    SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass;
--    -- expect: trg_on_auth_user_created
--
-- 2. Confirm an existing user got a workspace (replace <user_uuid>):
--    SELECT w.id, w.name, w.slug, wm.role
--    FROM public.workspaces w
--    JOIN public.workspace_members wm ON wm.workspace_id = w.id
--    WHERE wm.user_id = '<user_uuid>';
--
-- 3. Confirm the bonus row exists:
--    SELECT type, amount, description, balance_after
--    FROM public.credits_ledger
--    WHERE workspace_id IN (
--      SELECT workspace_id FROM public.workspace_members
--      WHERE user_id = '<user_uuid>'
--    );
--    -- expect: bonus, 100, 'Welcome bonus — 100 free credits', 100