-- 017_imports_storage_bucket.sql
--
-- Creates the `imports` Storage bucket for the storage-staging import flow.
--
-- WHY: today the browser parses the full CSV into memory and
-- JSON.stringify's every row into api/import's request body. That exceeds
-- the Vercel serverless request-body limit at 50K+ rows AND holds 20-60MB of
-- JS objects in the browser heap on a 100K-row file (tab crashes on
-- low-memory devices). Storage-staging fixes both: the browser streams raw
-- bytes to this bucket; the Edge Function parses the file server-side.
--
-- Path convention: workspaces/{workspace_id}/imports/{uuid}.csv
--   - caller-generated UUID, never the raw filename — path-traversal /
--     injection safe and collision-free. The real filename travels as object
--     metadata, not in the path.
--
-- file_size_limit is EXPLICIT (50MB = 52428800 bytes), not inherited.
-- Deliberate: matches the storage-global default on the free tier (files over
-- 50MB fail cleanly there anyway) and is a sound product bound on pro. Raising
-- to the 5GB pro ceiling later is a one-line bucket update. Deterministic on
-- both tiers.
--
-- allowed_mime_types widened because browsers label .csv inconsistently:
-- Windows Chrome sends application/vnd.ms-excel, some send
-- application/octet-stream. A strict text/csv-only rule breaks real users.

-- -----------------------------------------------------------------
-- BUCKET
-- -----------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imports',
  'imports',
  false,
  52428800,  -- 50MB, explicit + deterministic on both tiers
  ARRAY['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------
-- STORAGE RLS POLICIES
-- -----------------------------------------------------------------
-- service_role bypasses RLS, so the Edge Function (which downloads the staged
-- file and deletes it after processing) needs no policy. These policies govern
-- anon / authenticated direct hits on storage.objects.

-- Authenticated users can INSERT (stage) a file into their own workspace's
-- imports folder — the browser streaming-upload path. Never another
-- workspace's folder.
CREATE POLICY "imports_workspace_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'imports'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (storage.foldername(name))[2] = (
      SELECT workspace_id::text
      FROM public.workspace_members
      WHERE user_id = auth.uid()
      LIMIT 1
    )
  );

-- Authenticated users can SELECT (resolve) their own workspace's staged
-- imports objects — e.g. to confirm the staged path back after upload.
-- Never another workspace's folder.
CREATE POLICY "imports_workspace_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'imports'
    AND (storage.foldername(name))[1] = 'workspaces'
    AND (storage.foldername(name))[2] = (
      SELECT workspace_id::text
      FROM public.workspace_members
      WHERE user_id = auth.uid()
      LIMIT 1
    )
  );

-- No UPDATE policy for authenticated — staged imports are immutable once
-- written (a resumable upload re-uploads under a new UUID, not overwrite).
-- No DELETE policy for authenticated — the Edge Function (service_role,
-- RLS-bypassing) owns the lifecycle and deletes the staged file on both
-- success and failure. Mirrors exports: client never deletes.