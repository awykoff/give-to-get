-- 005_storage_buckets.sql
--
-- Creates the `exports` Storage bucket used by the export-generator
-- Edge Function to upload signed-URL'd export files at
-- workspaces/{workspace_id}/exports/{export_id}.{format}.
--
-- NOTE: The Edge Function uses the service-role key, which bypasses
-- storage RLS entirely. The policies below are defensive infrastructure
-- so that if a non-service-role path ever tries to read/write these
-- objects (e.g. a future "list my exports" UI endpoint that wants to
-- render thumbnails), it gets a sane default rather than full lockout.
--
-- Signed URLs are the only public-ish read path. Anything beyond the
-- signed URL expiry window (1 hour) is inaccessible to authenticated
-- users.

-- ─────────────────────────────────────────
-- BUCKET
-- ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('exports', 'exports', false)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────
-- STORAGE RLS POLICIES
-- ─────────────────────────────────────────
-- service_role bypasses RLS, so the Edge Function doesn't need a policy.
-- These policies control what anon / authenticated users can do when
-- they hit storage.objects directly (NOT through signed URLs, which
-- carry the bucket's signing key and are validated by Supabase before
-- the policy check runs).

-- Authenticated users can SELECT (i.e. resolve) their own workspace's
-- exports objects — this is the basis for any "list my past exports"
-- UI that wants to render download links without going through the
-- Edge Function. They can never SELECT a workspace they don't belong to.
CREATE POLICY "exports_workspace_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'exports'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (storage.foldername(name))[2] = (
      SELECT workspace_id::text
      FROM public.workspace_members
      WHERE user_id = auth.uid()
      LIMIT 1
    )
  );

-- Authenticated users can INSERT into their own workspace folder only,
-- e.g. for an in-browser resumable upload path that needs the user to
-- upload a small attachment. (The Edge Function path uses service_role
-- and so does NOT need this policy.)
CREATE POLICY "exports_workspace_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'exports'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (storage.foldername(name))[2] = (
      SELECT workspace_id::text
      FROM public.workspace_members
      WHERE user_id = auth.uid()
      LIMIT 1
    )
  );

-- No UPDATE policy for authenticated — export files are immutable once
-- written. The Edge Function uses service_role for any metadata updates.
-- No DELETE policy for authenticated — exports are kept for 7 days and
-- cleaned up by a cron / lifecycle rule, not by end users.
