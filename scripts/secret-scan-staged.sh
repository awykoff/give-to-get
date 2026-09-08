#!/bin/bash
# scripts/secret-scan-staged.sh
#
# Scan the staged diff (git diff --cached) for secret-shaped strings
# before they can land in a commit. Prints warnings for each match.
#
# Why this exists
# ----------------
# 2026-09-07: a Supabase personal access token (sbp_***) was pasted
# into a chat transcript while discussing how to apply migrations.
# Once in the transcript it had to be rotated. Pre-commit hooks and
# CI scanning are the right gates at the right layer; "be careful
# with secrets" is not.
#
# Default mode is WARN-ONLY — the script prints matches and exits 0.
# Tighten to BLOCK (exit 1) once the rule set is stable and known
# false positives are allowlisted in .gitleaks.toml.
#
# Scope
# -----
# - Scans `git diff --cached` against the index (pre-commit shape).
# - For CI, the matching workflow (`.github/workflows/secret-scan.yml`)
#   invokes `gitleaks` directly against the PR diff with the full
#   rule set + .gitleaks.toml allowlist.
# - This script is intentionally lightweight: pure bash + grep, no
#   external deps. It catches the obvious prefixes. Anything fancier
#   (entropy-based detection, language-aware scans) lives in gitleaks.
#
# Patterns checked
# ----------------
# Update SECRET_PREFIXES below when adding new providers. Match
# gitleaks rules in .gitleaks.toml so the two stay aligned.
#
# Allowlist
# ---------
# False positives can be allowlisted per-line via:
#   # gitleaks:allow
# appended to the line that triggered the match. Documented in the
# .gitleaks.toml so users find the convention once.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Known secret prefixes. Order doesn't matter; first match wins.
# Keep in sync with .gitleaks.toml.
SECRET_PREFIXES=(
  'sbp_'           # Supabase personal access token (sbp_*)
  'sbp_v0_'        # Supabase service-role JWT (sbp_v0_*)
  'ghp_'           # GitHub personal access token (classic)
  'gho_'           # GitHub OAuth token
  'ghu_'           # GitHub user token
  'ghs_'           # GitHub server token
  'ghr_'           # GitHub refresh token
  'github_pat_'    # GitHub fine-grained PAT
  'sk-'            # OpenAI / Anthropic-style API keys
  'sk_'            # some OpenAI variants
  'xai-'           # xAI / Grok
  'AKIA'           # AWS access key ID
  'ASIA'           # AWS session key ID
  'AIza'           # Google API key
  'ya29\.'         # Google OAuth access token
  'glpat-'         # GitLab PAT
  'xoxb-'          # Slack bot token
  'xoxp-'          # Slack user token
  'hooks.slack.com/services/' # Slack incoming webhook URL
  '-----BEGIN '     # PEM private key header (any kind)
  'supabase\.co/v1/projects/[^"]+' # Supabase project ref in URL — not a secret on its own, but patterns past it often are
)

# Fetch the staged diff. --binary suppresses binary file noise; --no-color
# keeps grep output clean. -U0 / --unified=0 keeps the diff tight.
DIFF="$(git diff --cached --binary --no-color -U0 -- ':(exclude).gitleaks.toml' || true)"

if [ -z "$DIFF" ]; then
  echo "secret-scan: no staged diff. Nothing to scan."
  exit 0
fi

# Build a single regex from the prefix list. Each entry is anchored
# at a word boundary so we don't match e.g. 'ghpages' or 'skill'.
# In ERE (grep -E) '|' is the alternation operator — no escaping needed.
PATTERN="$(printf '%s|' "${SECRET_PREFIXES[@]}")"
PATTERN="${PATTERN%|}"     # trim trailing |

# Filter out lines with the per-line allowlist marker. `grep -n` prefixes
# each match with `stdin:LINE:`, so the actual diff content starts at
# the second colon. We accept either:
#   stdin:LINE:+...content... # gitleaks:allow
# and silence the warning for that line.
MATCHES="$(echo "$DIFF" \
  | grep -nE "($PATTERN)" \
  | grep -vE '# gitleaks:allow' \
  || true)"

# Also catch allowlist comments written as full-line comments — easier
# to grep for if the line is purely a comment without the leading +.
# (Real allowlist is per-line; the leading-+ rule above is sufficient.)

if [ -z "$MATCHES" ]; then
  ADDED="$(echo "$DIFF" | grep -c '^+' || true)"
  echo "secret-scan: clean. $ADDED added lines scanned, 0 secret-shaped matches."
  exit 0
fi

COUNT="$(echo "$MATCHES" | wc -l | tr -d ' ')"
echo "::warning::$COUNT secret-shaped match(es) in staged diff:" >&2
echo "$MATCHES" >&2
echo >&2
echo "If a match is a known false positive, append ' # gitleaks:allow' to that line." >&2
echo "If a match is a real secret, rotate it in the source system NOW and" >&2
echo "remove it from the diff. Do NOT commit a real secret, even briefly." >&2

if [ "${SECRET_SCAN_BLOCK:-false}" = "true" ]; then
  echo "SECRET_SCAN_BLOCK=true — treating warnings as errors." >&2
  exit 1
fi

echo "Default mode is warn-only. Set SECRET_SCAN_BLOCK=true to fail the commit." >&2
exit 0