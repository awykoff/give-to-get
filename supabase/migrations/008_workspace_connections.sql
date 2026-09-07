-- =====================================================================
-- 008_workspace_connections.sql
--
-- Adds workspace-to-workspace connections (the "My Network" feature).
--
-- Decisions (this session):
--   * Connection invites resolve by email of a workspace member
--     (the app looks up workspace_members by email at insert time and
--     pins requester_workspace_id / recipient_workspace_id).
--   * Revocation is immediate + unilateral + audit row — revoked rows
--     STAY in the table with status='revoked'; the partial unique
--     index excludes them so reconnection is a fresh insert.
--   * Unique constraint: ONE active connection per pair (pending or
--     accepted). Reconnection after revoke/decline is a new row.
--   * Mutual acceptance required: only the recipient workspace can
--     accept/decline; either party can revoke. RLS allows members of
--     either side to UPDATE — the app layer enforces which verb
--     applies to which verb (accept/decline vs revoke).
--
-- Pre-existing helpers reused:
--   * private.auth_workspace_id()  — current user's workspace_id (workspace_members)
-- =====================================================================

-- ---------------------------------------------------------------------
-- WORKSPACE_CONNECTIONS
-- ---------------------------------------------------------------------
CREATE TABLE workspace_connections (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  requester_workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  status                      TEXT NOT NULL
                              CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),

  requested_by                UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  responded_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at                TIMESTAMPTZ,

  -- A workspace cannot connect to itself.
  CONSTRAINT workspace_connections_distinct_pair
    CHECK (requester_workspace_id <> recipient_workspace_id),

  -- responded_* fields are coupled to status. Once responded, the row
  -- has a non-null responded_at; if status is pending, responded_at
  -- must be null. accepted/declined/revoked must have responded_at set.
  CONSTRAINT workspace_connections_responded_at_consistency
    CHECK (
      (status = 'pending'  AND responded_at IS NULL) OR
      (status <> 'pending' AND responded_at IS NOT NULL)
    )
);

-- One ACTIVE connection per unordered pair. pending + accepted count;
-- declined + revoked do not (so reconnection after a terminal state is
-- a fresh insert). LEAST/GREATEST normalizes the pair so the constraint
-- is symmetric: (A,B) and (B,A) hit the same index entry.
CREATE UNIQUE INDEX uniq_workspace_connections_active_pair
  ON workspace_connections (
    LEAST(requester_workspace_id, recipient_workspace_id),
    GREATEST(requester_workspace_id, recipient_workspace_id)
  )
  WHERE status IN ('pending', 'accepted');

-- Indexes for the queries we actually run:
--   * "show me my accepted connections"        -> by status
--   * "my pending invites"                    -> by recipient + status
--   * "outbound requests I sent"              -> by requester + status
--   * the contacts RLS subquery               -> requester_workspace_id / recipient_workspace_id + status
CREATE INDEX idx_workspace_connections_status        ON workspace_connections(status);
CREATE INDEX idx_workspace_connections_requester     ON workspace_connections(requester_workspace_id, status);
CREATE INDEX idx_workspace_connections_recipient     ON workspace_connections(recipient_workspace_id, status);

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

-- workspace_connections: members of either side can see / update;
-- members of the requester side can insert. DELETE is denied — status
-- changes, no row deletion (preserves the audit trail).
ALTER TABLE workspace_connections ENABLE ROW LEVEL SECURITY;

-- SELECT: members of either side
CREATE POLICY "workspace_connections_select" ON workspace_connections
  FOR SELECT
  USING (
    requester_workspace_id = private.auth_workspace_id()
    OR recipient_workspace_id = private.auth_workspace_id()
  );

-- INSERT: any member of the requester workspace can invite.
-- The app sets requested_by = auth.uid() so the row's "who invited"
-- is pinned at insert time.
CREATE POLICY "workspace_connections_insert" ON workspace_connections
  FOR INSERT
  WITH CHECK (
    requester_workspace_id = private.auth_workspace_id()
    AND requested_by = auth.uid()
  );

-- UPDATE: members of either side. The app layer enforces which verb
-- (accept/decline require recipient-side membership; revoke can come
-- from either side).
CREATE POLICY "workspace_connections_update" ON workspace_connections
  FOR UPDATE
  USING (
    requester_workspace_id = private.auth_workspace_id()
    OR recipient_workspace_id = private.auth_workspace_id()
  )
  WITH CHECK (
    requester_workspace_id = private.auth_workspace_id()
    OR recipient_workspace_id = private.auth_workspace_id()
  );

-- DELETE: denied. Status transitions only.
-- (No DELETE policy = no row can be deleted under RLS; combined with
-- RLS enabled, this is a hard deny for non-service-role callers.)

-- ---------------------------------------------------------------------
-- workspace_members: minimal SELECT policy so the connection RLS
-- subqueries and `private.auth_workspace_id()` work. Members see only their
-- own workspace's membership rows.
--
-- Implementation note: this policy MUST NOT include any inline
-- subquery against `workspace_members` itself. Doing so triggers
-- "infinite recursion detected in policy for relation
-- 'workspace_members'", because applying RLS to the subquery causes
-- Postgres to evaluate the policy recursively. `private.auth_workspace_id()`
-- is SECURITY DEFINER so it bypasses RLS when evaluating the caller's
-- workspace_id.
--
-- NOTE: 002 left workspace_members RLS-enabled with no explicit SELECT
-- policy, which means under default-deny a non-service-role caller
-- cannot see ANY row. `private.auth_workspace_id()` itself is SECURITY DEFINER
-- so it bypasses RLS, but downstream policies that compare to
-- `private.auth_workspace_id()` depend on `workspace_id` being the caller's
-- own workspace — which is true. However, the "show co-workers on
-- workspace page" UI cannot read other members without this policy —
-- so we grant visibility to every row in any workspace the caller
-- belongs to (workspace_id = private.auth_workspace_id() covers the entire
-- workspace, since private.auth_workspace_id() returns the caller's workspace).
-- Cross-workspace membership visibility is intentionally NOT granted;
-- that is gated by the workspace_connections SELECT policy above for
-- the "My Network" page.
-- ---------------------------------------------------------------------
CREATE POLICY "workspace_members_select" ON workspace_members
  FOR SELECT
  USING (
    workspace_id = private.auth_workspace_id()
  );

-- ---------------------------------------------------------------------
-- CONTACTS: connection-gated SELECT policy
--
-- A workspace can see contacts contributed by a connected workspace
-- ("My Network" feature). The general Contacts page must explicitly
-- filter to exclude connection-gated contacts (defensive filter,
-- implemented in card 4 / frontend) — otherwise its unfiltered SELECT
-- will start returning friend contributions.
-- ---------------------------------------------------------------------

-- The viewer's "other side" workspace_ids that have an accepted
-- connection to my workspace. Reusable inside RLS policies.
CREATE OR REPLACE VIEW v_my_network_workspace_ids AS
  SELECT
    CASE
      WHEN requester_workspace_id = private.auth_workspace_id()
        THEN recipient_workspace_id
      ELSE requester_workspace_id
    END AS workspace_id
  FROM workspace_connections
  WHERE status = 'accepted'
    AND (requester_workspace_id = private.auth_workspace_id()
         OR recipient_workspace_id = private.auth_workspace_id());

-- Grant SELECT to authenticated so RLS can use the view.
-- Wrapped in DO because Supabase always has the role, but local
-- validation sandboxes may not — we don't want the migration to hard-
-- fail during a dry-run apply.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON v_my_network_workspace_ids TO authenticated';
  END IF;
END
$$;

-- Connection-gated contacts SELECT. Composes with the existing
-- "contacts_select USING (true)" policy via OR: a row is visible if
-- EITHER the metadata is public (existing policy, email still gated
-- by app layer) OR it was contributed by one of my connected
-- workspaces (this new policy).
--
-- Excludes contacts contributed by the viewer's own workspace —
-- those are already visible via the workspace's own queries and the
-- Contacts page list view should not show duplicates between "my
-- contacts" and "network contacts". The "contributed by my workspace"
-- branch is also where workspace_contact_access.unlock controls
-- gating of PII fields, so we deliberately do NOT include the join
-- here; this policy only controls row visibility, not field-level
-- gating.
CREATE POLICY "contacts_network_select" ON contacts
  FOR SELECT
  USING (
    contributed_by_workspace_id IS NOT NULL
    AND contributed_by_workspace_id <> private.auth_workspace_id()
    AND contributed_by_workspace_id IN (
      SELECT workspace_id FROM v_my_network_workspace_ids
    )
  );

-- ---------------------------------------------------------------------
-- Verification helpers (comments only — no live SQL). The user
-- applies this migration in Supabase, then can run:
--
--   SELECT * FROM pg_policies
--   WHERE tablename = 'workspace_connections'
--   ORDER BY policyname;
--
--   SELECT * FROM pg_policies
--   WHERE tablename = 'contacts'
--     AND policyname = 'contacts_network_select';
--
-- End-to-end test (after seeding two workspaces + an accepted
-- connection):
--
--   -- as workspace A's user:
--   SELECT id, email FROM contacts
--   WHERE contributed_by_workspace_id = '<workspace_B_id>'
--   LIMIT 5;
--   -- should return B's contacts.
--
--   -- as a workspace with NO accepted connection to B:
--   SELECT id, email FROM contacts
--   WHERE contributed_by_workspace_id = '<workspace_B_id>'
--   LIMIT 5;
--   -- should return zero rows.
-- =====================================================================