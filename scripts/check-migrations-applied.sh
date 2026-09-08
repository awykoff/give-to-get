#!/bin/bash
# scripts/check-migrations-applied.sh
#
# Bidirectional check between this repo's supabase/migrations/*.sql files
# and the target Supabase project's supabase_migrations.schema_migrations
# table.
#
# Forward check (the original): fail if a migration file is present in
# the repo but NOT recorded as applied on the target. Catches the case
# where the code ships ahead of the database.
#
# Reverse check (added 2026-09-07 after PR #3): warn if a migration is
# recorded as applied on the target but has NO source file in this repo.
# Catches the inverse failure mode — a migration that was applied to
# prod (e.g. via Dashboard SQL Editor) but whose source SQL was never
# committed. Default mode is WARN; promote with STRICT_DB_MIGRATIONS=true.
#
# Why this exists
# ----------------
# PR #1 (2026-09-07) shipped migrations 007 → 008 → 009 to main and
# merged cleanly. They were never applied to the target Supabase project,
# and the production app crashed on a function the migrations were
# supposed to create. CI verified the code; nothing verified the
# database the code depended on. The forward check closes that gap.
#
# PR #3 (also 2026-09-07) was the cross-workspace RLS fix. Its migration
# (010_workspace_lookup_helper.sql) was applied to prod and recorded in
# schema_migrations, but the source SQL was never committed to the repo
# — exactly the reverse failure mode. The reverse check closes that gap
# at PR time so the next migration-applied-out-of-band incident shows
# up as a CI warning instead of as a future-rebuild surprise.
#
# Required environment
# --------------------
#   SUPABASE_MIGRATIONS_DB_URL  Postgres connection string with read
#                                access to supabase_migrations.schema_migrations
#                                on the TARGET Supabase project. Typically
#                                a Supabase "Direct connection" string from
#                                Settings → Database → Connection string.
#                                MUST be a secret — do not echo in CI logs.
#
#   ALLOW_UNAPPLIED_MIGRATIONS  (optional) Set to "true" to skip BOTH checks.
#                                Use only for migrations intentionally
#                                applied via Dashboard SQL Editor (the
#                                `supabase_migrations.schema_migrations`
#                                history will not reflect them, and this
#                                script has no way to know that without
#                                a backfill). The current prod DB has
#                                007/008/009 applied via the editor and
#                                NOT in schema_migrations; set this on
#                                those PRs until a repair backfill lands.
#
#   STRICT_DB_MIGRATIONS        (optional) Set to "true" to promote the
#                                reverse (DB-only) check from warn to
#                                error. Default warn-only because the
#                                repo being behind prod is an audit-hygiene
#                                issue, not necessarily a deploy blocker.
#
# Behavior
# --------
#   exit 0  forward check passes (all repo files applied); reverse check
#           reports no DB-only migrations, OR reports DB-only migrations
#           in warn-only mode.
#   exit 1  forward check fails (one or more repo files unapplied), OR
#           STRICT_DB_MIGRATIONS=true and the reverse check finds anything.
#
# Reads filenames matching:  <digits>_<name>.sql
# (Supabase CLI naming convention; tolerates the intentional gap at 003.)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIG_DIR="$REPO_ROOT/supabase/migrations"

if [ -z "${SUPABASE_MIGRATIONS_DB_URL:-}" ]; then
  echo "::error::SUPABASE_MIGRATIONS_DB_URL is not set. Refusing to run." >&2
  echo "Set it as a GitHub Actions secret (or env var locally) to a read-only" >&2
  echo "connection string for the target Supabase project." >&2
  echo "If this migration is intentionally applied via Dashboard SQL Editor" >&2
  echo "and not yet backfilled to schema_migrations, set ALLOW_UNAPPLIED_MIGRATIONS=true." >&2
  exit 1
fi

if [ "${ALLOW_UNAPPLIED_MIGRATIONS:-false}" = "true" ]; then
  echo "ALLOW_UNAPPLIED_MIGRATIONS=true — skipping check."
  exit 0
fi

if [ ! -d "$MIG_DIR" ]; then
  echo "::error::No migrations directory at $MIG_DIR" >&2
  exit 1
fi

# Find migration files in the current branch's working tree (not just
# origin/main). Use `git ls-files` so untracked files in the diff are
# also considered. Falls back to plain ls if not in a git repo.
shopt -s nullglob
MIG_FILES=()
if git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  while IFS= read -r f; do
    MIG_FILES+=("$f")
  done < <(git -C "$REPO_ROOT" ls-files "$MIG_DIR" | grep -E '/[0-9]+_[^/]+\.sql$' || true)
else
  while IFS= read -r f; do
    MIG_FILES+=("$f")
  done < <(ls "$MIG_DIR"/*.sql 2>/dev/null || true)
fi

if [ ${#MIG_FILES[@]} -eq 0 ]; then
  echo "No migration files found under $MIG_DIR — nothing to check."
  exit 0
fi

# Query the target DB for the set of applied versions. The version
# stored in schema_migrations is the migration's filename (Supabase CLI
# convention). We use DISTINCT in case the same version was applied
# more than once (unusual but possible after a partial failure).
echo "Querying supabase_migrations.schema_migrations on the target project..."
APPLIED_CSV="$(psql "$SUPABASE_MIGRATIONS_DB_URL" -tA -F, -v ON_ERROR_STOP=1 \
  -c "SELECT DISTINCT version FROM supabase_migrations.schema_migrations ORDER BY version;" \
  2>&1)" || {
  echo "::error::Failed to query supabase_migrations.schema_migrations." >&2
  echo "$APPLIED_CSV" >&2
  exit 1
}

# Header row (empty on success) — strip with awk. Tolerate psql emitting
# nothing (no rows) by short-circuiting.
APPLIED_SET="$(echo "$APPLIED_CSV" | awk 'NF' | sort -u)"

UNAPPLIED=()
for f in "${MIG_FILES[@]}"; do
  base="$(basename "$f")"
  if ! echo "$APPLIED_SET" | grep -qx "$base"; then
    UNAPPLIED+=("$base")
  fi
done

if [ ${#UNAPPLIED[@]} -eq 0 ]; then
  echo "OK: ${#MIG_FILES[@]} migration files, all recorded as applied on target."

  # ---------------------------------------------------------------------
  # Reverse-direction check: are there applied migrations in the target
  # DB that have NO matching source file in this repo? This catches the
  # inverse failure mode of the check above — a migration that was
  # applied to prod (e.g. via Dashboard SQL Editor) but whose source
  # file was never committed. PR #1 on 2026-09-07 surfaced exactly this
  # shape (010_workspace_lookup_helper.sql was applied + recorded in
  # schema_migrations, but the .sql file was never in the repo).
  #
  # Default mode: WARN (stderr, exit 0). The repo being behind prod
  # is an audit-hygiene issue, not necessarily a deploy blocker.
  # Set STRICT_DB_MIGRATIONS=true to promote to error.
  # ---------------------------------------------------------------------
  REPO_BASES="$(printf '%s\n' "${MIG_FILES[@]}" | xargs -n1 basename 2>/dev/null | sort -u)"

  DB_ONLY=()
  while IFS= read -r v; do
    [ -z "$v" ] && continue
    if ! echo "$REPO_BASES" | grep -qx "$v"; then
      DB_ONLY+=("$v")
    fi
  done <<< "$APPLIED_SET"

  if [ ${#DB_ONLY[@]} -gt 0 ]; then
    echo "::warning::${#DB_ONLY[@]} migration(s) recorded as applied on target but MISSING from this repo:" >&2
    for d in "${DB_ONLY[@]}"; do
      echo "  - $d" >&2
    done
    echo >&2
    echo "This is the inverse of the unapplied check above: applied to prod" >&2
    echo "but no source file in version control. A clean checkout cannot" >&2
    echo "reproduce, audit, or re-test these migrations. Common cause:" >&2
    echo "applying via Dashboard SQL Editor without committing the .sql." >&2
    echo >&2
    echo "Fix: write the source .sql file (mirroring what's in prod) and" >&2
    echo "commit it under supabase/migrations/. Mirrors PR #2's 007/008" >&2
    echo "qualification backfill pattern." >&2

    if [ "${STRICT_DB_MIGRATIONS:-false}" = "true" ]; then
      echo "STRICT_DB_MIGRATIONS=true — treating warning as error." >&2
      exit 1
    fi
  fi

  exit 0
fi

echo "::error::${#UNAPPLIED[@]} migration file(s) present in repo but NOT applied to target:" >&2
for u in "${UNAPPLIED[@]}"; do
  echo "  - $u" >&2
done
echo >&2
echo "Fix paths:" >&2
echo "  1. Apply the migration(s) to the target Supabase project before merging:" >&2
echo "     - supabase db push (preferred; updates schema_migrations automatically)" >&2
echo "     - Dashboard SQL Editor paste (does NOT update schema_migrations — see option 3)" >&2
echo "  2. If the migration was applied via Dashboard SQL Editor, backfill schema_migrations:" >&2
echo "     INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('007_user_profiles.sql');" >&2
echo "  3. If intentionally skipping (e.g. preview-only migration), set ALLOW_UNAPPLIED_MIGRATIONS=true" >&2
echo "     on this PR — but add a follow-up issue so it does not get forgotten." >&2
exit 1