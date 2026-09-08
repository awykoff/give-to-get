# Migration drift — diagnosis and recovery

Two-direction drift between `supabase/migrations/*.sql` in the repo and
`supabase_migrations.schema_migrations` in the target Supabase project.
Both directions have bitten this project on 2026-09-07; both have
real, distinct recovery paths.

## Forward drift (repo file not applied)

Symptom: a `.sql` file exists on disk but the prod DB doesn't reflect it.
The first version of `scripts/check-migrations-applied.sh` covered only
this case.

Recovery: the canonical paths are documented in the script's own help
output and in `SKILL.md`'s runbook-commands bullet. Three viable shapes:

1. `supabase db push` (preferred — updates `schema_migrations`).
2. `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/NNN_*.sql`.
3. Dashboard SQL Editor paste-and-run.

The PR body should list all three, plus the apply-order comment, plus
a per-migration sanity-check query (`pg_proc`, `information_schema.tables`,
etc.).

## Reverse drift (entry in schema_migrations not in repo)

This is the easy half to forget. Surfaced on 2026-09-07 as
`010_workspace_lookup_helper.sql`:

- The function `public.workspace_id_for_user(uuid)` was applied to prod
  on or around 2026-09-07.
- `supabase_migrations.schema_migrations` had a row for it.
- `supabase/migrations/010_workspace_lookup_helper.sql` did **not**
  exist in the repo.
- `src/app/api/network/invites/route.ts` called the function and the
  route comment referenced the .sql file by name.

A clean checkout could not reproduce, audit, or re-test the migration.
A future `supabase db push` would see the file (after this PR lands) as
unapplied and try to re-create the function — failing on "already
exists."

`scripts/check-migrations-applied.sh` now handles this with the reverse
check (warn by default, error with `STRICT_DB_MIGRATIONS=true`). The
GitHub Actions workflow `.github/workflows/migrations-check.yml` runs
both checks on every PR that touches `supabase/migrations/`.

## Diagnosing reverse drift without prod DB access

The agent often doesn't have a `DATABASE_URL` to the prod Supabase
project. Symptoms to look for in the repo:

- Route handlers / API code that calls `supabase.rpc("some_function", …)`.
- Comments or doc strings that reference `NNN_<name>.sql` files.
- Migration files referenced by number that don't exist in
  `supabase/migrations/`.
- `package.json` or `AGENTS.md` mentions of a feature whose supporting
  migration is absent.

If all of the above line up, the function almost certainly exists in
prod. The agent's recovery path is:

1. Write the missing `.sql` by inference from the route's usage.
2. Mark it **INFERRED, NOT VERIFIED AGAINST PROD** in the file header
   AND the commit message.
3. Include the verification queries in the file's header comment so
   the next person with prod access can amend any differences:

   ```sql
   SELECT pg_get_functiondef('public.function_name(uuid)'::regprocedure);
   SELECT grantee, privilege_type
     FROM information_schema.routine_privileges
     WHERE routine_name = 'function_name';
   ```

4. After apply, sanity-check that
   `schema_migrations` has the row (it should already).
5. The PR is "ready to merge" only in the sense that the source
   artifact now exists. Whether the content matches prod is a
   separate question that someone with prod SQL access must answer.

## Worked examples (2026-09-07)

### `auth_workspace_id()` qualification

Forward drift and content bug combined. The migration files shipped;
the `auth_workspace_id()` calls inside them were unqualified; after
migration 004 moved the function to `private.auth_workspace_id()`,
unqualified calls failed at apply time. Even after the migrations were
applied manually (via Dashboard SQL Editor with the qualified call
patched inline), the on-disk files still had the unqualified form — a
future `supabase db push` would have hit the same error.

Fix landed in PR #2 (`ea789a8`): 25 unqualified calls (6 in 007, 19 in
008) all rewritten to `private.auth_workspace_id()`.

### `010_workspace_lookup_helper.sql` missing

Reverse drift. The function was applied to prod and recorded in
`schema_migrations` but the source `.sql` was never committed. Fix
landed in `ananda/restore-010-migration` (`2e65a07`): the file was
written by inference from the route's call signature and the
SECURITY DEFINER pattern in 009, with an explicit INFERRED header and
the verification queries documented inline. Branch is named
`restore-` (not `apply-`) to make the intent unambiguous to reviewers.

### `007/008/009` not in `schema_migrations`

Forward drift on the bookkeeping side. Applied to prod via Dashboard
SQL Editor; bookkeeping table never got the rows. A future
`supabase db push` from a clean env would see 007/008/009 as unapplied
and fail on duplicate-object errors.

No on-disk fix exists yet. Operationally: until a
`supabase_migrations.schema_migrations` backfill or a `db push`-based
canonical-apply path is set up, the CI gate will keep failing the
forward check for these three. The current workaround is
`ALLOW_UNAPPLIED_MIGRATIONS=true` on PRs that don't touch migrations.
Tracked in persistent memory so future sessions don't lose it.

## Why this skill exists as a separate file

The forward case is easy to remember; the reverse case is easy to
forget. Keeping both in `SKILL.md`'s bullet list catches the most
common failure mode (asymmetric thinking). The deeper patterns —
verifying prod state via `pg_*` introspection functions, the
INFERRED + verification-queries shape — are stable enough across
projects to live as a recipe here rather than in session memory.
