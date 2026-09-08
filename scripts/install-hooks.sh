#!/bin/bash
# scripts/install-hooks.sh
#
# Opt-in installer for the pre-commit secret-scan hook. We do NOT
# enable hooks by default — that decision belongs to the user, because
# hooks can be bypassed with --no-verify and a forced hook that fails
# on a stale pattern can block legitimate work. This script copies the
# hook into .git/hooks/ and explains how to disable it.
#
# Usage:
#   bash scripts/install-hooks.sh           # install
#   bash scripts/install-hooks.sh --uninstall   # remove

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_SRC="$REPO_ROOT/scripts/hooks/pre-commit"
HOOK_DST="$REPO_ROOT/.git/hooks/pre-commit"

if [ "${1:-}" = "--uninstall" ]; then
  if [ -e "$HOOK_DST" ] && grep -q "secret-scan-staged" "$HOOK_DST"; then
    rm "$HOOK_DST"
    echo "Removed pre-commit hook."
  else
    echo "No pre-commit hook installed by this script. Nothing to remove."
  fi
  exit 0
fi

if [ ! -f "$HOOK_SRC" ]; then
  echo "ERROR: hook source not found at $HOOK_SRC" >&2
  exit 1
fi

if [ -e "$HOOK_DST" ] && ! grep -q "secret-scan-staged" "$HOOK_DST"; then
  echo "WARNING: a pre-commit hook already exists at $HOOK_DST and was not" >&2
  echo "         installed by this script. Refusing to overwrite." >&2
  echo "         Move it aside first, then re-run this script." >&2
  exit 1
fi

cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"

echo "Installed pre-commit hook → $HOOK_DST"
echo
echo "The hook runs scripts/secret-scan-staged.sh before each commit."
echo "Bypass (use sparingly): git commit --no-verify"
echo "Uninstall:              bash scripts/install-hooks.sh --uninstall"
echo
echo "To enable hard-blocking on real secret matches (default is warn-only):"
echo "  export SECRET_SCAN_BLOCK=true"