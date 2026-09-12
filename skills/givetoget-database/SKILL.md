---
name: givetoget-database
description: Postgres migrations, RLS policies, and triggers for give-to-get.com's Supabase schema
version: 1.3.0
metadata:
  hermes:
    tags: [supabase, postgres, rls, givetoget]
    category: database
---

# give-to-get.com — Database

## When to Use

Writing or editing a migration, an RLS policy, a trigger, or generated
TypeScript types.

## Procedure

1. Read `supabase/migrations/002_apollo_aligned_schema.sql` — this is the
   canonical schema (Apollo-aligned, 60+ contact fields, superseded 001).
   `004_private_schema_security.sql` layers on additional RLS hardening.
   For anything touching auth schema, check `009_email_lookup_helper.sql`
   for the canonical email→user_id RPC before reaching for service-role.
2. New migrations are numbered, sequential SQL files under
   `supabase/migrations/`. Never edit a migration that's already been applied
   to a live environment — write a new one.
3. Every new table gets RLS enabled in the same migration that creates it —
   not a follow-up migration.
4. Regenerate `lib/types/database.types.ts` after any schema change.
5. When a feature needs to resolve an email to a user_id from a route
   handler, use `public.user_id_for_email(p_email)` (added in 009) — never
   query `auth.users` directly, never expose the service-role key to the
   browser bundle. See `references/auth-schema-lookups.md`.

## Tables

```
workspaces, workspace_members, companies, contacts, imports, exports,
export_contacts, credits_ledger, workspace_contact_access,
workspace_connections (008), user_profiles (007)
```

## Hard Rules

- `credits_ledger` is **append-only** — no `UPDATE`/`DELETE` policy should
  ever exist for it; write a Postgres rule or trigger that rejects those
  statements outright.
- `email_normalized` = `LOWER(TRIM(email))` is the global dedup key across
  the whole `contacts` table, not per-workspace.
- Credit mutations happen only via triggers fired by `imports`/`exports`
  status changes — never via a direct client-side insert into
  `credits_ledger`.
- RLS: workspace A must never be able to read workspace B's `imports`,
  `exports`, or unlocked contact rows.
- **user_profiles is permanently walled off from contacts** (PRD §7). No
  query, view, join, export, or search path may surface `user_profiles`
  data (name, phone) as if it were a contact record in the shared pool, or
  vice versa. This is a standing privacy requirement — any future feature
  touching either table must preserve this separation, not just the
  initial build. Treat any occurrence as a critical privacy bug, not a
  normal defect.
- **My Network contacts must not leak into the general Contacts search
  page.** Application-query-scoping responsibility, not enforced by RLS
  alone — the Contacts page's own query must explicitly exclude
  connection-gated contacts. See Pitfalls.

## Patterns

### Symmetric-pair unique constraint (one active per unordered pair)

For features where two entities can form a relationship with at most one
"active" instance per pair regardless of which side initiated it
(`workspace_connections` is the canonical example), use a partial unique
index on `(LEAST, GREATEST)`:

```sql
CREATE UNIQUE INDEX uniq_<table>_active_pair ON <table> (
  LEAST(side_a_id, side_b_id),
  GREATEST(side_a_id, side_b_id)
)
WHERE status IN ('pending', 'accepted');  -- only "active" states count
```

Why this shape: `(side_a, side_b)` and `(side_b, side_a)` collide on the
same index entry, so creating from either direction produces the same
constraint violation. The `WHERE status IN (...)` predicate keeps the
constraint live only for active rows — a revoked or declined row drops
out of the index, allowing reconnection later as a fresh insert. This is
strictly cleaner than asking application code to "check both directions
before insert," which the PRD allows but recommends against.

The full canonical example lives in `supabase/migrations/008_workspace_connections.sql`.

### RLS-friendly view for subquery reuse

When the same `WHERE EXISTS (SELECT ... FROM workspace_connections ...)`
subquery is needed in multiple RLS policies, factor it into a `VIEW`
rather than inlining the CASE/LEAST/GREATEST expression. Example from
008:

```sql
CREATE OR REPLACE VIEW v_my_network_workspace_ids AS
  SELECT
    CASE
      WHEN requester_workspace_id = auth_workspace_id()
        THEN recipient_workspace_id
      ELSE requester_workspace_id
    END AS workspace_id
  FROM workspace_connections
  WHERE status = 'accepted'
    AND (requester_workspace_id = auth_workspace_id()
         OR recipient_workspace_id = auth_workspace_id());

GRANT SELECT ON v_my_network_workspace_ids TO authenticated;
```

Then policies / queries reference `(SELECT workspace_id FROM
v_my_network_workspace_ids)` instead of re-deriving the logic. The view
itself runs with the caller's RLS context, so it inherits the workspace
filtering for free.

### Email → user_id from a route handler

PostgREST does not expose the `auth` schema to the anon-keyed client,
so `supabase.from('auth.users').select(...)` returns a stable
"schema not found" error. The service-role key cannot be used from a
user-driven route handler without violating least-privilege. The
canonical pattern is a narrow SECURITY DEFINER RPC in the `public`
schema that returns ONLY the user_id (no email leak):

```sql
CREATE OR REPLACE FUNCTION public.user_id_for_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT id FROM auth.users
  WHERE email = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.user_id_for_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_id_for_email(text) TO authenticated;
```

Then call `supabase.rpc('user_id_for_email', { p_email: email })` from
the route handler. The function is GRANTed to `authenticated` only —
anonymous probing is rejected at the function-call level by Postgres.
The implementation lives in `supabase/migrations/009_email_lookup_helper.sql`.
See `references/auth-schema-lookups.md` for the full rationale.

## Pitfalls

- **RLS alone cannot enforce "visible in this UI, not that one".**
  RLS gates row visibility based on the calling user, but not on which
  query path issued the read. When two surfaces (e.g. the general
  Contacts page and the My Network "See Contacts" modal) both read the
  same `contacts` table but should show disjoint slices, RLS can
  permit one row and the application must filter the other out
  explicitly. Concrete shape (seen Sept 2026): the new
  `contacts_network_select` policy made connection-gated contacts
  visible to the viewer's anon-keyed query. The Contacts page's own
  query must explicitly exclude connection-gated contacts.
  When writing a new RLS policy that broadens visibility, always
  audit every existing query path that reads the same table and
  decide whether each needs a defensive filter. This is application-
  query-scoping responsibility, not a database concern that can be
  resolved by RLS alone.
- **`.not(in, "(SELECT ...)")` is silently broken on PostgREST.**
  The natural defensive filter against the broadened RLS policy is
  `.not("col", "in", "(SELECT ...)")`. This LOOKS like a subquery
  to a developer reading the code. It is not. PostgREST URL-encodes
  the embedded SELECT as a literal string and sends it to Postgres,
  which then tries to compare a UUID column against the literal text
  `"SELECT workspace_id FROM ..."` and raises
  `invalid input syntax for type uuid: "SELECT workspace_id FROM ..."`
  (observed on give-to-get.com production 2026-09-11). The query
  returns 0 rows silently; the `?? []` empty-state fallback hides
  the error as "0 contacts".

  **The fix is a SECURITY DEFINER RPC**, not a different embedded
  SELECT shape. PostgREST inlines RPCs in filter expressions
  server-side, so `.not("col", "in", "public.network_workspace_ids()")`
  evaluates against real UUID values, the client never sees the
  workspace IDs, and the privacy boundary the embedded-SELECT was
  designed to provide is preserved. The canonical example is
  `public.network_workspace_ids()` in migration
  `012_network_workspace_ids_rpc.sql` — same pattern as
  `public.user_id_for_email` (009) and `public.workspace_id_for_user`
  (010). The original `v_my_network_workspace_ids` view stays in
  place because RLS policy subqueries are evaluated directly by
  Postgres (not URL-encoded through PostgREST), so the view works
  fine for that path; the function exists specifically for the
  client-side filter use case.
- Forgetting RLS on a junction table (`export_contacts`,
  `workspace_contact_access`) because "it's just a join table" — these leak
  contact access just as easily as the primary tables.
- Writing dedup logic as a per-row loop instead of a single batch query —
  this is a `givetoget-backend` concern too, but the constraint (`UNIQUE` on
  `email_normalized`) belongs here.
- **001/002 field-name drift.** `001_initial_schema.sql` and
  `002_apollo_aligned_schema.sql` are inconsistent on purpose — `002`
  superseded `001` for the Apollo-aligned shape, but `001` still lives in the
  migrations directory. `001` uses `total_rows`/`file_name`/`company_size`
  and a different `seniority` enum. `002` (the canonical live schema) uses
  `original_row_count`/`filename`/`num_employees` and the Apollo-aligned
  enum. Before writing any insert/update against `contacts` or `imports`,
  cross-check the column names against `002` — a copy-paste off `001` will
  fail PostgREST with `column \"...\" does not exist` and waste a deploy cycle.
- **`contacts.email_normalized` is `GENERATED ALWAYS AS (LOWER(TRIM(email)))
  STORED`.** Any insert payload including this column fails with
  `cannot insert into or update computed column \"email_normalized\"`. Same
  pattern applies to any future generated column (`companies.quality_score`,
  whatever ends up in 006+). When writing an insert-shaped TypeScript type
  for `contacts`, omit the generated column rather than marking it optional
  — it physically cannot be supplied, so the type should forbid it.
- **Auth-schema lookups from a route handler.** Don't reach for the
  service-role key just because the anon client can't see `auth.users`.
  Use the `public.user_id_for_email` RPC (009) — see Patterns above.

## Pitfalls (continued)

- **For NOT NULL constraints where the design intent matters, ship
  two layers: `ALTER COLUMN ... SET NOT NULL` plus a named CHECK
  constraint.** The CHECK is technically redundant (Postgres enforces
  NOT NULL via the implicit column attribute) but documents intent
  in `information_schema.table_constraints` and `psql`'s `\d` output,
  and survives any future migration that drops the NOT NULL (for a
  soft-delete feature, a tombstone row, etc.). The named constraint
  surfaces a more grep-able error on violation. Concrete example
  (2026-09-11, `contacts.contributed_by_workspace_id`):

  ```sql
  ALTER TABLE public.contacts
    ALTER COLUMN contributed_by_workspace_id SET NOT NULL;

  ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_contributor_not_null
    CHECK (contributed_by_workspace_id IS NOT NULL);

  COMMENT ON CONSTRAINT contacts_contributor_not_null ON public.contacts IS
    'Documents the design decision that every contact row must have
     a real contributing workspace. The NOT NULL on the column is
     primary enforcement; this CHECK is belt-and-suspenders and
     surfaces intent in information_schema.table_constraints.';
  ```

  Use this shape whenever the constraint encodes a design decision
  that future contributors need to discover from the schema alone
  (no surrounding PRD, no comment in the migration body to explain
  why). The cost is one redundant error path for actual violations —
  acceptable.

- **Schema-shape baselines must capture content, not just names.**
  A test/verify tool that snapshots "tables exist with these names"
  / "functions exist with these names" / "policies exist with these
  names" misses every bug that's a behavior change inside the same
  name. Three real examples from 2026-09-11: (a) the historic
  007/008 bug — `auth_workspace_id()` vs `private.auth_workspace_id()`
  differs only in function body, not function name; a name-only
  snapshot considered both states valid. (b) the NULL-attribution
  filter trap — `WHERE col NOT IN (subquery)` vs `WHERE NOT EXISTS
  (... WHERE col = ...)` is identical at the function-name level
  and different at the SQL-semantics level. (c) the schema-drift
  bug (`contacts.company_size` vs `num_employees`) — names ARE
  different, so name-only catches it, but the column TYPES were
  not in the baseline; a regression that silently changes INTEGER
  → TEXT would pass.

  The fix: baseline format must include (1) `pg_get_functiondef`
  output for each SECURITY DEFINER function (captures body), (2)
  USING/WITH CHECK clauses for each RLS policy (captures policy
  expression), (3) trigger definitions including timing and table
  binding (captures binding — note that `pg_get_functiondef`
  does NOT see trigger bindings, so triggers are a separate
  array from function_bodies), (4) `information_schema.columns`
  type info alongside the table list (catches silent type
  changes). Same applies to views, materialized views, generated
  columns, and any other object whose behavior depends on its
  definition rather than its name. Drift is detected by
  string-exact comparison; a benign reformat (whitespace, comment
  rephrasing) trips the diff. If that becomes painful, normalize
  whitespace before comparison in the verify script. The full
  baseline shape is in
  `~/.hermes/messages/2026-09-11-on-demand-tester-pool-phase-1-proposal.md`
  § "What 'migrations apply cleanly' means" (durable shape will
  live in `docs/testing/` once Phase 1 implementation lands).

- **Snapshot/regenerate commands must refuse a dirty working tree
  unless explicitly overridden.** When a tool's purpose is to
  capture "the current state" of something (a baseline JSON, a
  fixture dump, a generated types file, a schema snapshot), running
  it in a dirty tree produces an output that mixes the just-captured
  committed state with the user's uncommitted edits — silently.
  The user doesn't know the snapshot includes their scratch work;
  the next reader of the snapshot trusts it as the canonical
  baseline. The right pattern is the same as the canonical git
  workflow: the tool runs `git status --porcelain` first, exits
  non-zero if anything is uncommitted, prints "refusing to update:
  working tree contains N uncommitted change(s); commit, stash,
  or pass --allow-dirty to override." The override flag is allowed
  but logs a prominent warning before writing. The escape hatch is
  for the legitimate case (initial baseline capture, CI environment)
  — not for the everyday workflow, where uncommitted edits should
  land in a commit first. Same logic applies to any capture /
  regenerate command (generated types, OpenAPI specs, schema
  snapshots, fixture regenerators, type generators driven from
  the database) — capture-from-dirty-tree is a specific failure
  mode worth a check, not "the user will be careful."

## Verification

`supabase db push` (or running the migration in the SQL editor) succeeds;
`SELECT * FROM pg_policies WHERE tablename = '<new_table>'` returns rows;
attempting `UPDATE credits_ledger ...` as a test fails.

## References

- `references/auth-schema-lookups.md` — full rationale and alternatives
  for the email→user_id RPC pattern (009_email_lookup_helper.sql).