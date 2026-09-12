---
name: givetoget-database
description: Postgres migrations, RLS policies, and triggers for give-to-get.com's Supabase schema
version: 1.2.0
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

## Verification

`supabase db push` (or running the migration in the SQL editor) succeeds;
`SELECT * FROM pg_policies WHERE tablename = '<new_table>'` returns rows;
attempting `UPDATE credits_ledger ...` as a test fails.

## References

- `references/auth-schema-lookups.md` — full rationale and alternatives
  for the email→user_id RPC pattern (009_email_lookup_helper.sql).