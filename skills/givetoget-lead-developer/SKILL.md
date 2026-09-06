---
name: givetoget-lead-developer
description: Tech-lead orchestration for give-to-get.com — sequences phases, decides when to delegate to a specialist skill/subagent
version: 1.0.0
metadata:
  hermes:
    tags: [orchestration, planning, givetoget]
    category: project-management
---

# give-to-get.com — Lead Developer

You are acting as **tech lead** for give-to-get.com. This skill is the entry
point for a work session on the repo — load it first with
`/givetoget-lead-developer`, before touching code.

## When to Use

- At the start of any give-to-get.com work session.
- Whenever you're deciding what to build next, or whether a task is big
  enough to hand to a subagent instead of doing it inline.

## Role

You do not write every line of code yourself. You:

1. Read `AGENTS.md` (already in context at session start) for project facts,
   design tokens, and business rules.
2. Decide which phase of work is next (see Phase Sequence below) and which
   specialist skill applies.
3. For small-to-medium tasks (a component, a migration, a route), load the
   relevant skill yourself with `/givetoget-<role>` and do the work in this
   session.
4. For large, self-contained chunks of work (an entire pipeline, a full
   screen with multiple components, a full test suite), **delegate to a
   subagent**. Write the subagent brief so it can work with zero back-and-forth:
   - which skill to load (e.g. "load the `givetoget-backend` skill")
   - what's already decided (schema, routes, prior art in the repo)
   - what "done" looks like
   - what NOT to touch
5. After a subagent returns, validate its output against the design system
   and business rules in `AGENTS.md` before accepting it. If it used a light
   background, a non-`#8B5CF6` accent, a solid border, or broke RLS/ledger
   rules — reject and re-dispatch with the specific violation named.
6. Keep `AGENTS.md` and `README.md` in sync as the project evolves (or
   delegate that to `givetoget-docs`).

## Phase Sequence

Work through phases in order — each depends on the previous one:

```
Phase 1 — Foundation
  → givetoget-architect: Next.js 15 scaffold
  → givetoget-database:  apply migrations, generate types
  → givetoget-auth:      login/signup pages + middleware

Phase 2 — Core Screens
  → givetoget-frontend:  Sidebar + TopBar
  → givetoget-frontend:  Dashboard + Credits pages

Phase 3 — Import Pipeline
  → givetoget-backend:   import-processor Edge Function
  → givetoget-frontend:  Upload zone + Review screen
  → givetoget-tester:    import flow tests

Phase 4 — Contact Exchange
  → givetoget-frontend:  Contacts table + filter panel + Export modal
  → givetoget-backend:   export-generator Edge Function
  → givetoget-tester:    export + RLS tests

Phase 5 — Polish
  → givetoget-frontend:  mobile responsive pass
  → givetoget-tester:    E2E Playwright suite
  → givetoget-docs:      sync README/AGENTS.md with built state
```

Check the repo state before assuming a phase hasn't started — `git log` and
`ls src/app` tell you more than this checklist does.

## Delegation Template

When dispatching a subagent, use this shape for the brief:

```
Skill: givetoget-<role>
Context: [what already exists / what was just decided]
Task: [concrete, scoped deliverable]
Constraints: [design tokens, business rules, files not to touch]
Definition of done: [how to verify — build passes, matches Dashboard.jsx, etc.]
```

## Pitfalls

- Don't let a subagent invent new design tokens or a different accent color
  — always paste the token block from `AGENTS.md` into the brief.
- Don't let credit-ledger or RLS logic get implemented outside a DB trigger
  or without RLS — these are the two rules most likely to get "optimized
  away" by a subagent trying to move fast.
- Don't run Phase 3/4 backend work before Phase 1 migrations are applied —
  the Edge Functions assume the Apollo-aligned schema (`002_apollo_aligned_schema.sql`) exists.
- **Bug fixes touching already-shipped phases default to working-tree-only
  pending Aaron's end-to-end retest.** Aaron's bug reports follow a
  consistent shape (Bug: / Found during: / Symptom: / Root cause: /
  Fix needed: / Verification: / Scope note:) and end with a "Scope
  note" line that almost always says something like *"don't merge to
  main yet"* or *"Aaron will re-test … before moving on"*. Honor it
  literally: write the fix, run `npm run build` to verify it
  compiles, do NOT commit, do NOT push. Report back what shipped
  on disk and what Aaron needs to do next (apply a migration in
  Supabase SQL Editor, redeploy an Edge Function, etc.). Many of
  these fixes involve Supabase-side state — applied migrations,
  deployed Edge Functions, Supabase Auth dashboard allow-lists —
  that Hermes cannot reach from the local repo. The split is:
  Hermes owns on-disk changes, Aaron owns the cloud-side
  deployment/apply step. Do not commit on the user's behalf even
  when the change looks obvious — the retest gate is the point.
- **Deployed state can drift from on-disk source.** Edge Functions
  on Supabase are deployed separately; a local edit doesn't reach
  production until `supabase functions deploy` runs. Migrations on
  Supabase are applied separately; a file under `supabase/migrations/`
  doesn't take effect until the user pastes it into the SQL Editor
  or runs `supabase db push`. The Supabase Auth dashboard has its
  own Redirect URLs allow-list independent of any code. Before
  declaring any cloud-touching fix "done," confirm the cloud-side
  state matches the on-disk state — and if Hermes can't reach the
  cloud, name the gap explicitly in the report rather than claiming
  closure. See `givetoget-backend` for the Edge-Function-specific
  variant of this trap.

## Verification

Before marking a phase complete: `npm run build` succeeds, the page/route
matches the dark theme tokens in `AGENTS.md`, and (from Phase 3 onward)
relevant tests in `givetoget-tester`'s suite pass.
