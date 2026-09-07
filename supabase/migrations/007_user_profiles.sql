-- =====================================================================
-- 007_user_profiles.sql
--
-- Adds the per-user Settings profile.
--
-- Decisions (this session):
--   * user_profiles is permanently walled off from contacts
--     (PRD 7 privacy rule). Distinct table, distinct RLS surface,
--     no join keys into contacts.
--   * phone_number stays optional by design (PRD 5.8 rationale).
--   * SELECT is profile owner always, plus any member of a workspace
--     with an ACCEPTED workspace_connections row to the owner's
--     workspace (foundation for the "My Network" feature; card 4
--     builds on this). Pending invites do NOT unlock profile access —
--     the recipient hasn't accepted yet.
--   * INSERT / UPDATE: profile owner only (auth.uid() = user_id).
--   * DELETE: denied. Profiles are an append-only user record; the
--     only "delete" path is auth.users ON DELETE CASCADE.
--   * Backfill: do not seed existing users (Aaron's account). They'll
--     fill the row via the Settings page (card 2).
--
-- Apply order: 001, 002, 004, 005, 006, 007, 008.
-- This migration's "network connection" branch references
-- workspace_members + workspace_connections; both tables exist in 001
-- / 008 but the network branch is only meaningful once 008 has been
-- applied (it introduces the workspace_members SELECT policy that the
-- RLS subquery depends on, and the workspace_connections table itself).
-- Until then, only the profile-owner branch is reachable — which is
-- the correct privacy posture.
--
-- Pre-existing helpers reused:
--   * private.auth_workspace_id()        — current user's workspace_id
--   * update_updated_at()        — BEFORE UPDATE trigger fn (001/002)
-- =====================================================================

-- ---------------------------------------------------------------------
-- USER_PROFILES
-- ---------------------------------------------------------------------
CREATE TABLE user_profiles (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  phone_number TEXT,  -- nullable, optional by design (PRD 5.8)

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- AUTO-UPDATE updated_at
--
-- update_updated_at() was defined in 001/002 and is OR REPLACE-safe;
-- we do not redefine it here to keep the migration single-purpose.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: profile owner always; OR any member of a workspace with an
-- ACCEPTED workspace_connections row to the profile owner's
-- workspace. Pending invites do not unlock profile access.
--
-- The network branch is symmetric on (A,B) — both branches of the OR
-- hit the LEAST/GREATEST unique index on workspace_connections (008),
-- so either side of the pair matches.
--
-- service_role bypasses RLS by default; no explicit escape needed.
CREATE POLICY "user_profiles_select" ON user_profiles
  FOR SELECT
  USING (
    -- (1) Profile owner can always see their own row.
    auth.uid() = user_id
    OR
    -- (2) Co-members of an accepted-connection workspace can see the
    --     profile owner's row. Two subqueries:
    --     * find workspaces the profile owner belongs to
    --     * require an accepted connection between any of those
    --       workspaces and the caller's workspace
    EXISTS (
      SELECT 1
      FROM workspace_members wm
      JOIN workspace_connections wc
        ON wc.status = 'accepted'
       AND (
            (wc.requester_workspace_id = private.auth_workspace_id()
             AND wc.recipient_workspace_id = wm.workspace_id)
         OR (wc.recipient_workspace_id = private.auth_workspace_id()
             AND wc.requester_workspace_id = wm.workspace_id)
           )
      WHERE wm.user_id = user_profiles.user_id
    )
  );

-- INSERT: profile owner only.
-- WITH CHECK ensures auth.uid() is pinned to the row's user_id at
-- insert time (a user cannot create a profile for someone else).
CREATE POLICY "user_profiles_insert" ON user_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: profile owner only.
-- USING: can only target rows you own. WITH CHECK: cannot transfer
-- ownership by updating user_id.
CREATE POLICY "user_profiles_update" ON user_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: denied. No policy is created; under RLS, the absence of a
-- DELETE policy means only the service_role can remove rows. User
-- deletion flows through auth.users ON DELETE CASCADE.

-- ---------------------------------------------------------------------
-- Verification helpers (comments only — no live SQL). The user
-- applies this migration in Supabase, then can run:
--
--   SELECT * FROM pg_policies
--   WHERE tablename = 'user_profiles'
--   ORDER BY policyname;
--   -- expect 3 rows: user_profiles_select, _insert, _update
--
--   -- Anon-keyed client (no auth.uid()):
--   SELECT * FROM user_profiles;
--   -- expect 0 rows.
--
--   -- Authenticated, looking up someone else's profile with no
--   -- accepted connection to either workspace:
--   SELECT * FROM user_profiles
--   WHERE user_id <> auth.uid();
--   -- expect 0 rows.
--
-- End-to-end test (after 008 has been applied + two workspaces seeded
-- with an accepted connection):
--
--   -- as workspace A's user, look up a profile belonging to
--   -- workspace B (a connected workspace):
--   SELECT first_name, last_name FROM user_profiles
--   WHERE user_id IN (
--     SELECT user_id FROM workspace_members
--     WHERE workspace_id IN (
--       SELECT CASE
--                WHEN requester_workspace_id = private.auth_workspace_id()
--                  THEN recipient_workspace_id
--                ELSE requester_workspace_id
--              END
--       FROM workspace_connections
--       WHERE status = 'accepted'
--         AND (requester_workspace_id = private.auth_workspace_id()
--              OR recipient_workspace_id = private.auth_workspace_id())
--     )
--   );
--   -- should return B's members' profiles.
-- =====================================================================
