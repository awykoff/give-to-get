---
name: givetoget-docs
description: Keeps give-to-get.com's README, AGENTS.md, and schema notes in sync with the actual codebase
version: 1.0.0
metadata:
  hermes:
    tags: [documentation, givetoget]
    category: docs
---

# give-to-get.com — Docs

## When to Use

After a phase completes, or whenever a route, component, or schema change
lands that isn't yet reflected in the project docs.

## Procedure

1. Update `AGENTS.md`'s Build Phase Sequence / File Structure sections to
   match reality — mark phases done, add new routes/components as they're
   built.
2. Update `README.md` to reflect actual project state (setup steps,
   env vars, current status) — not aspirational state.
3. Add a one-paragraph note to the relevant migration file's header comment
   when a schema change ships, so `givetoget-database` has context on the
   next session without re-reading the whole diff.

## Pitfalls

- Writing docs that describe the plan instead of the current state — mark
  unbuilt phases as unbuilt.
- Letting `AGENTS.md` go stale on a business rule (e.g. it stops mentioning
  the append-only ledger) — Hermes loads only this file for project
  context, so anything missing from it simply isn't in context at all.
- **AGENTS.md's Tech stack table drifts from `package.json` and
  `supabase/functions/*/deno.json`.** Example seen Sept 2026:
  AGENTS.md said "Next.js 15" while the build output reported
  "Next.js 16.2.7" (Next 16 was in `package.json`). The table is
  manually edited, not generated. When syncing docs after any
  dependency change, re-derive the version rows from the actual
  lockfiles instead of trusting the previous table value. Same rule
  for the Supabase JS client version, the Deno version the Edge
  Functions target, the Tailwind major version. A single stale
  version line in AGENTS.md produces "the doc says X but the build
  says Y" confusion in every future bug report until someone fixes
  it.
- **Cross-reference the Critical business rules list against the
  schema before declaring a docs sync complete.** New rules belong
  there (e.g. "PKCE callback is /auth/callback", "workspace
  bootstrap is owned by trg_on_auth_user_created",
  "contacts.num_employees is canonical, not company_size"). Rules
  are listed in the order they were added, not the order of
  importance — appending is fine, renumbering is not required.
  Each rule needs at least one on-disk artifact to point at (file
  path + the canonical helper or column name) so a reader can
  verify it without grepping.
- **`AGENTS.md` is gated by a user-approval hook. Don't retry, don't
  bypass.** This is a session-level hook on the always-loaded
  context file (and anything in the same category: README.md,
  CLAUDE.md, .cursorrules). The hook prompts the user for
  explicit consent; on timeout it returns a BLOCKED error with
  "silence is not consent" semantics and explicitly tells you to
  NOT retry via another path (terminal, execute_code, etc.). The
  right protocol when an AGENTS.md edit gets blocked: (a) surface
  the exact proposed change in chat as a patch or before/after
  text, (b) explicitly note it's blocked pending user consent,
  (c) wait for an explicit "go ahead" or alternative. Don't try
  `sed`, `printf`, or any other write path — the hook catches
  all of them and the BLOCKED message is the contract. This
  applies whether you're editing AGENTS.md directly or via an
  autonomous worker dispatch — workers that hit this hook should
  hand back, not retry. The companion lesson in
  `givetoget-lead-developer` covers the broader "don't retry
  blocked user-gated operations" rule.

## Verification

A fresh read of `AGENTS.md` top to bottom matches what's actually in `src/`
and `supabase/migrations/` — no phase marked "done" that isn't.
