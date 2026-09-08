-- =====================================================================
-- 011_user_profiles_avatar.sql
--
-- Adds avatar_url to user_profiles to support a profile element in the
-- header (TopBar) that can render either a circular photo or initials.
--
-- Why this exists
-- ---------------
-- The My Network and Settings features (closed via issues #4 and #5 on
-- 2026-09-07) shipped user_profiles with first_name, last_name,
-- phone_number, and the audit columns. The header at the time rendered
-- only a credits pill. As the product moves toward identity-first
-- framing (workspace connections, contact exchange), the header needs
-- a profile element to anchor the signed-in user.
--
-- Phase 1 of the work (this PR): add the column, render either an
-- avatar image or initials, link to /settings. Phase 2 (deferred):
-- Storage bucket + upload control in Settings. The schema is designed
-- to make phase 2 additive: avatar_url is nullable, and the only
-- branch the TopBar cares about is "is it set" — wire-in is the same
-- whether the value comes from a hardcoded placeholder, a Storage URL,
-- or anything else.
--
-- Schema choice
-- -------------
-- avatar_url is TEXT (not UUID-with-FK) because the eventual Storage
-- URL form is opaque from the DB's perspective (Supabase Storage
-- returns signed URLs that change per request). Storing the URL text
-- directly also lets phase 2 swap in a non-Supabase image host later
-- without a schema migration.
--
-- RLS
-- ---
-- No policy changes. The existing user_profiles_update policy
-- (auth.uid() = user_id, created by 007) already gates writes to the
-- profile owner. A new column inherits that policy without
-- modification.
--
-- Apply order
-- -----------
-- Apply AFTER 007 (which creates user_profiles). Independent of 008,
-- 009, 010, and any future migrations. Apply via psql, supabase db
-- push, or the Dashboard SQL editor -- any path will work because
-- the column has no FK dependency.
-- =====================================================================

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN public.user_profiles.avatar_url IS
  'Optional URL to a profile photo. Null until phase 2 of the profile '
  'identity work lands (Storage bucket + upload control in Settings). '
  'TEXT rather than UUID-with-FK because the eventual Storage signed '
  'URL is opaque from the DB and may change format if the image host '
  'ever moves off Supabase Storage.';