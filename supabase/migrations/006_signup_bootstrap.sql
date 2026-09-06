-- give-to-get.com — Signup bootstrap
-- Phase 1 hotfix (September 2026)
--
-- Problem: after the email confirmation callback was wired up, new users
-- could authenticate but had no workspace — the import API rejected
-- uploads with "No workspace found for this user". Root cause: nothing
-- in the schema or app code creates a workspace, workspace_members row,
-- or 100-credit signup bonus for a freshly inserted auth.users row.
-- The 001 migration's signup-bonus block was left as a commented-out
-- template ("Call this from your onboarding Edge Function or server
-- action") and no such handler ever shipped.
--
-- Fix: trigger on auth.users AFTER INSERT that calls
-- private.provision_workspace_for_user(). SECURITY DEFINER +
-- private-schema pattern matches 004. Idempotent for retries and safe
-- for the backfill block below, which provisions a workspace for any
-- existing auth.users row that never got one (e.g. the account Aaron
-- created between the email-confirmation fix and this migration).
--
-- Works for BOTH signup paths (email confirmation and Google OAuth)
-- because both end in an auth.users INSERT.

-- ─────────────────────────────────────────
-- Provisioning helper — single source of truth
-- ─────────────────────────────────────────
-- Called by both the auth.users trigger and the backfill block. Keeps
-- the workspace-create / member-add / bonus-credit logic in one place
-- so the two paths can't drift.

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
  -- The 8-char uuid suffix keeps the UNIQUE(slug) constraint satisfied
  -- under concurrent signups with the same local-part (e.g. two
  -- "alex"@different-domain accounts).
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
-- has no workspace_members entry. This is the self-heal path for the
-- account Aaron created between the email-confirmation fix and this
-- migration. Re-running the migration is safe: the helper's
-- idempotency guard skips users who already have a workspace.

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