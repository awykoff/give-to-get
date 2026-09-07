#!/bin/bash
# scripts/check-migrations-applied.sh
#
# Fail if any migration file in supabase/migrations/ is present in the
# repo but NOT recorded as applied in the target Supabase project's
# supabase_migrations.schema_migrations table.
#
# Why this exists
# ----------------
# PR #1 (2026-09-07) shipped migrations 007 → 008 → 009 to main and
# merged cleanly. They were never applied to the target Supabase project,
# and the production app crashed on a function the migrations were
# supposed to create. CI verified the code; nothing verified the
# database the code depended on. This check closes that gap at PR time.
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
#   ALLOW_UNAPPLIED_MIGRATIONS  (optional) Set to "true" to skip the check.
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
# Behavior
# --------
#   exit 0  all migration files have matching rows in schema_migrations
#   exit 1  one or more migrations are unapplied (or DB unreachable)
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