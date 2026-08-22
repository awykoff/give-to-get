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

## Verification

A fresh read of `AGENTS.md` top to bottom matches what's actually in `src/`
and `supabase/migrations/` — no phase marked "done" that isn't.
