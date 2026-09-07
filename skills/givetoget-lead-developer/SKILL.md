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
- **`next-env.d.ts` is gitignored — do NOT re-add it to git.**
  Next.js 16 rewrites the import path on every `npm run build`
  (`.next/types/routes.d.ts` for prod, `.next/dev/types/routes.d.ts`
  for dev). The file used to be tracked and required `git restore`
  after every commit; that policy was retired Sept 2026 in favor of
  ignoring it. `tsconfig.json` already includes both path variants
  in its `include` array, so types resolve regardless of which
  path the regenerated file points at. If `git status` ever shows
  `next-env.d.ts` modified, the answer is *not* to commit it —
  check that `.gitignore` still contains the entry. The full
  policy is in `AGENTS.md` under "next-env.d.ts policy" and in the
  README setup steps.
- **When wrapping up a multi-bug session, split commits along bug
  boundaries, not feature boundaries.** Aaron explicitly asked for
  this on the Sept 2026 close-out (six-bug arc: auth callback,
  workspace bootstrap, num_employees, stale Vercel, missing env
  var, intra-batch + trim). The reason is `git blame` and rollback:
  one commit per bug means `git revert <sha>` cleanly takes out a
  single fix without dragging in the others; one giant commit makes
  every future investigation re-read the entire diff. Mapping rule
  used in that session: each commit's diff = the files that changed
  to fix exactly one of the listed bugs. Cross-bug refactors
  (env-var warning, safeUrl redactor, causeChain walker in the
  proxy route) go in a single commit attributed to the bug that
  motivated them; if no single bug motivates them, fold into a
  follow-up "chore: harden X" commit. Pure docs commits (skill
  pitfall codification, AGENTS.md deploy checklist) ship last so
  the bug-fix history reads linearly before the docs polish.
- **Quoting version numbers in bug reports: cross-check
  `package.json` before stating them.** AGENTS.md's Tech stack
  table is manually maintained and drifts. Example: AGENTS.md says
  "Next.js 15" but `npm run build` reports "Next.js 16.2.7". If a
  bug report says "the Next.js 15 route handler does X", an
  operator who runs `npm run build` first will be momentarily
  confused. Either update AGENTS.md (preferred — that's
  `givetoget-docs`'s job) or quote the version from `package.json`
  / the build output directly.
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
- **`AGENTS.md` is gated by a user-approval hook. Don't retry, don't
  bypass, don't edit via another path.** Editing an always-loaded
  context file (AGENTS.md is the canonical one — README.md,
  CLAUDE.md, .cursorrules, and any other file the agent loads every
  session are in the same category) trips a hook that prompts the
  user for explicit consent. If the prompt times out without a
  response, the hook rejects the write with a hard "silence is not
  consent" error and the file-system tool returns a BLOCKED message
  with explicit guidance: "Do NOT retry it or attempt the same edit
  via another path (terminal, execute_code, etc.)." Respect the
  hook literally — don't retry, don't try `sed`/cat via terminal,
  don't `execute_code` a write. The right move is to surface the
  proposed change in chat with the exact patch (or before/after
  text), explicitly note it's blocked on user consent, and wait for
  an explicit "go ahead" or an alternative instruction (e.g. "pin
  package.json instead" or "skip the doc sync for this session").
  Same rule applies if the hook prompts and you don't see a
  response — don't assume silence means consent. This bit twice
  in the Sept 2026 session (Next.js version sync card, the
  env-var docs sync) and would have been the right move earlier
  both times. The lesson generalizes: if you find yourself
  thinking "I'll just try once more in a slightly different way,"
  the answer is no.
- **Re-read the current PRD/feature spec on disk before starting
  any feature build. Don't trust earlier drafts.** Specs in this
  project go through several scope revisions per session (the
  Sept 2026 My Network feature went v1.1 → v1.5 in one afternoon).
  Anything cached from an earlier read may be stale on three
  counts: (a) decisions you thought were made may have been
  reversed, (b) requirements may have been added (the v1.4 → v1.5
  privacy/wall-off requirements were the binding hard rules, not
  aspirational), (c) explicit "open questions" from earlier drafts
  may now be "resolved" with answers that contradict what you
  remember. The right pattern: read the current `PRD.md` (or
  feature spec) in full at session start, ignore any cached
  summaries you (or another agent) wrote earlier, and treat the
  on-disk document as the only source of truth. After re-reading,
  surface every ambiguity in one batched question rather than
  dribbling — the user would rather answer four design decisions
  in one form than have the build stop four times.

## Deploy checklist — load before any commit that touches production code

The on-disk change is step one of "done," not the whole thing. The
recurring failure mode on this project is committing a fix, having
Aaron re-test, and watching the bug repro because the deployed
runtime is older than the repo. Hermes cannot redeploy from this
machine — no Vercel token, no Supabase CLI linked, no
`supabase/config.toml`, no service-role key. The user runs the
redeploy. The handoff is the contract.

Run all that apply, in order:

1. **Code only** (anything under `src/app/**`, components,
   `next.config.*`) → user runs `vercel --prod`. Confirm Vercel
   shows a successful deployment for the new SHA.
2. **Edge Function** (`supabase/functions/<name>/index.ts` plus any
   `_shared/*` it imports) → user runs `supabase functions deploy
   <name>`. Confirm Supabase Edge Function logs show the new
   version's invocations after the redeploy.
3. **Migration** (anything new under `supabase/migrations/`) → user
   applies via Supabase SQL Editor or `supabase db push`. Verify the
   new objects exist (run `\df`, `\dt`, `\dT`, or the matching
   `information_schema` query).
4. **Supabase Auth dashboard** (any change to a callback path, a
   redirect URL, or an OAuth provider) → user updates the Redirect
   URLs allow-list. Independent of any code; setting code without
   the allow-list entry silently breaks sign-in.
5. **Verify in production** before reporting done. For Edge Functions:
   Supabase Edge Function logs for the new version. For Vercel
   routes: hit the route from the browser with the same input the
   bug report used. For migrations: query the DB directly.

If the bug report has a scope note ("don't merge yet" / "I'll
re-test … before moving on"), do not commit on the user's behalf —
write the fix on disk, run `npm run build`, report back what needs
to be applied/redeployed. The retest gate is the point; do not
short-circuit it.

See `AGENTS.md` "Deploy discipline" section for the always-loaded
copy of this checklist and `givetoget-backend`'s
`references/stale-deploy-diagnostic.md` for the diagnostic sequence
when a fix on disk doesn't reach production.

## Verification

Before marking a phase complete: `npm run build` succeeds, the page/route
matches the dark theme tokens in `AGENTS.md`, and (from Phase 3 onward)
relevant tests in `givetoget-tester`'s suite pass.
