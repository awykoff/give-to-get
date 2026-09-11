---
name: givetoget-lead-developer
description: Tech-lead orchestration for give-to-get.com — sequences phases, decides when to delegate to a specialist skill/subagent
version: 1.1.0
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
- **Re-run verification from scratch before shipping, even when a
  prior handback claims it's already green.** A handback comment
  saying *"build was clean, don't redo the work, verify and ship"*
  is a *claim* about the previous session's tree, not a *waiver*
  of verification for this one. The two trees can differ in ways
  that aren't visible from the diff (stale `node_modules`, an
  uncommitted edit to a config file, an env var that's no longer
  set, an `.env.local` that drifted). Re-running `tsc --noEmit`
  and `npm run build` costs 30–90s on this repo and is the only
  step that catches drift between "the work was correct" and "the
  work is still correct now." The shipped report must show *this
  session's* exit codes and route table — never paraphrase a
  prior session's claim.
- **`--no-verify` is sometimes the right move, but the prescribed
  re-verification step is what makes it safe.** When the pre-commit
  hook's `tsc --noEmit` (or any other check the hook runs) fails for
  reasons unrelated to the code being committed — local `node_modules`
  corrupted by repeated `npm install --ignore-scripts` calls, a missing
  `@types/*` directory the lockfile says should be there, a husky
  postinstall script that's not on PATH — the right move is:
  commit with `--no-verify`, document the bypass rationale *in the
  commit message body* (which other agents and reviewers will see
  inline), then immediately recover the local env (e.g. `rm -rf
  node_modules && npm ci`, or whatever the corruption root cause
  requires), then re-run `tsc --noEmit` + `npm run build` + Playwright
  *manually* against the now-clean env. The verification step is
  what makes the bypass safe, not the bypass itself. Sept 2026
  network-invite-email SMTP follow-up: the original commit landed
  with `--no-verify` because the env was broken; the re-verify pass
  on a clean install caught a real type error
  (`Cannot find namespace 'nodemailer'` — `nodemailer.Transporter`
  doesn't exist as a namespace member under default-import with
  `@types/nodemailer@8`) that the hook would have caught but didn't
  because it was bypassed. Fix landed in a follow-up commit on the
  same branch with the hook passing clean. Without the prescribed
  re-verify, the bug would have shipped to Vercel's preview deploy
  with a slower feedback loop. Generalize: `--no-verify` is a
  workflow correction, not a waiver of verification — and it must
  always be paired with explicit re-verification before the branch
  is marked ready-for-review. Don't reach for it reflexively; reach
  for it only when the hook's failure is demonstrably unrelated to
  the code being committed (have `git diff` of the staged changes
  in front of you to prove that to yourself), and document the
  evidence inline.
- **Stale `.git/index.lock`.** If a prior terminal command exits
  abnormally mid-git-operation (harness block, ctrl-C, OOM,
  anything other than a clean exit), the lock file is left behind
  and every subsequent `git add` / `git commit` fails with
  *"Unable to create .git/index.lock: File exists. Another git
  process seems to be running"*. Diagnose first, retry second:
  `ls -la .git/index.lock` (zero-byte file = stale) and
  `pgrep -f "git "` (must return nothing). Then `rm -f
  .git/index.lock` and retry. The lock is just a marker — removing
  it when no git process is alive is safe and idempotent.
- **GitHub Issues is the canonical bug tracker; Lessons and Kanban
  are secondary, with cross-links.** This project settled on
  GitHub Issues on `awykoff/give-to-get` as the shared record of
  what's broken and what's fixed — one place Aaron, this session,
  and the cloud-side Claude window can all read and write. The
  Obsidian `Lessons/` notes and the Kanban board remain useful for
  *this session's* working narrative, but they're not the primary
  record. Concrete consequences:
  - When a bug is filed, open a GitHub Issue using the repo's
    label scheme (`severity:p0/p1/p2/p3`, `area:migrations/rls/auth/
    ui/...`, plus the default `bug` label). Don't write the bug up
    only in a chat transcript or a vault note.
  - When fixing a bug, close the Issue with a short verification
    note (what broke, what you changed, how you confirmed it) and
    reference the Issue number/URL in the PR description.
  - When writing an Obsidian lesson note, link the related
    Issues by URL in the frontmatter `related` field and in the
    body, not just the PR number. Issues survive PR close; PR
    numbers can be misattributed (see the next pitfall).
  - The Kanban card IDs go in a lesson note's `kanban_ids` field
    only if they correspond to *real* cards on the Kanban board.
    If you're writing a lesson from memory and the card IDs are
    uncertain, leave the field empty rather than guessing.
- **Don't paraphrase PR/issue numbers in long-lived artifacts —
  link or quote exactly.** Lesson notes in the Obsidian vault
  outlive the session that wrote them; a misattributed PR number
  in a note is a piece of false history the next session inherits.
  The Sept 2026 `Lessons/2026-09-07-deploy-discipline.md` was
  originally written with "PR #3 = my deploy-discipline CI branch"
  in five places; the actual PR #3 on the repo was a different
  branch (cross-workspace RLS fix, `awykoff/fix-cross-workspace-
  invite-lookup`) that I had no visibility into when writing the
  note. The error survived into the lesson body until a later turn
  caught it via `git ls-remote`. Prevention: when citing a PR,
  commit, or branch in something that will outlive the current
  turn, fetch the actual reference (`git ls-remote`, `git log
  origin/main`, the GitHub API) and paste the URL or the verified
  SHA, not the paraphrase. Paraphrase is fine for ephemeral chat;
  not for vault notes, PR descriptions, or commit messages that
  outlive the session.
- **Don't rewrite authorship of work another session/window did.**
  When an Issue body or PR description attributes work to a
  different agent (a cloud-side Claude window, a prior Hermes
  session, a human reviewer), do not silently edit the attribution
  to match your own identity, even if the correction would look
  "tidier." The correct response is to flag the discrepancy in
  chat and let the user decide — rewriting authorship without
  consent is the same shape as the credential-leak trap (silently
  changing who a record points at). This applies in reverse too:
  do not paste someone else's words into a commit message or note
  without attribution. The general rule: a record that says "X
  did Y" should keep saying "X did Y" until the original author
  revises it.
- **Don't commit uncommitted edits you didn't write and can't
  attribute.** If `git status` shows an uncommitted modification
  on a file you don't remember editing — especially with content
  that references "today" or session-specific events — that
  modification arrived by a path you don't control (another agent,
  a hook, a background tool). The safe moves are: (a) `git diff`
  the file and show the user the full change before doing
  anything; (b) ask "did you write this?" and wait for an
  explicit yes/no; (c) if the answer is "no" or unclear, either
  `git restore` the file or leave the edit uncommitted until the
  user decides. Do **not** commit unverified edits just because
  they "look like the right thing" or because they match a
  pattern you've seen. Same applies to staging untracked files
  in bulk (`git add .`); stage the specific files you wrote,
  not everything that's new.
- **Cloud-side steps the agent can't run must ship as runbook
  commands in the PR body, not as prose instructions.** Cards
  frequently include a step the agent can't perform from the
  local repo (apply a Supabase migration, run `vercel --prod`,
  update an Auth-dashboard allow-list). The wrong shape is a PR
  description that says *"user needs to apply 007 → 008 → 009 and
  run vercel --prod"* — which puts the burden of reconstructing
  the right command shape on the user mid-deploy, when mistakes
  are most costly. The right shape: include all viable apply
  paths (psql with `ON_ERROR_STOP=1`, the relevant CLI with
  `--file`, the Dashboard SQL editor paste), the apply order with
  the comment that documents it (e.g. `Apply order: 001, 002,
  004, 005, 006, 007, 008` for this project's canonical
  sequence — note 003 is intentionally absent), and a one-line
  sanity-check query for each migration
  (`SELECT proname, prosecdef FROM pg_proc WHERE proname =
  'user_id_for_email'` after applying 009). For Vercel: include
  `vercel login` → `vercel link` (one-time) → `vercel --prod`,
  plus the env vars that must already be set in the Vercel
  project. The PR body is the runbook, not a description of one.
- **Write migrations against the actual target DB, not against a
  remembered prior state.** Sept 2026 incident: migrations
  007/008 called `auth_workspace_id()` unqualified, which worked
  pre-004 and silently broke after `004_private_schema_security.sql`
  moved the function to `private.auth_workspace_id()`. Every other
  migration in the tree had been updated to call the
  schema-qualified form, except 007/008 — which were written in a
  different mental session and not re-verified end-to-end before
  shipping. The general rule: when a migration references another
  function, table, or type, the test is *"does this file run
  cleanly against a fresh DB that has 001..<n-1> applied?"* not
  *"did this file run last time I touched it?"* The fix path when
  this kind of breakage lands in prod is: apply the migrations via
  the SQL Editor with the qualified call patched inline (fast,
  unblocks users), then patch the on-disk migration files to
  match (so the next `supabase db push` from a clean environment
  doesn't repeat the error). Doing only the first half leaves the
  next person to hit the same trap.
- **Never echo a user-pasted credential back through any tool
  call; treat any token that crosses a chat transcript boundary
  as compromised.** Sept 2026: a real-shaped Supabase access token
  (`sbp_***`) was pasted into the conversation as part of a
  hypothetical `export SUPABASE_ACCESS_TOKEN=...` snippet. Once
  pasted, it was in the transcript, the session DB, and any log
  files. The correct response was *not* to `export` it (which
  would have echoed the value into shell history and tool
  output) and *not* to substitute a fabricated value (which would
  have been a manufactured result). The correct path was to flag
  the leak, refuse to use the pasted value, recommend rotation,
  and steer toward a non-leaking auth path (`supabase login`
  browser flow, or a secrets-store-mediated `export`). Two
  related rules: (a) don't use `<placeholder>`-shaped values
  even as a test pattern — a placeholder that looks real to a
  regex is a real-looking string to anyone scanning the transcript
  later; (b) if a tool call would echo the credential (e.g. a
  shell `echo $TOKEN` for a sanity check), don't make that tool
  call. The credential-leak hygiene is the same regardless of
  whether the value is real.
- **Per-repo givetoget-* skills live in TWO locations, kept in sync.** The
  repo-local copy at `~/Developer/Projects/give-to-get/skills/<skill>/SKILL.md`
  travels with the code (committed, version-controlled, visible to
  reviewers in PR diffs). The per-profile mirror at
  `~/.hermes/profiles/ananda/skills/givetoget/<skill>/SKILL.md` is what
  Hermes actually loads at session start. When creating a new
  per-repo skill (`givetoget-<role>`), write BOTH copies on day one —
  don't assume one will be auto-generated. When patching an existing
  one, patch both and verify the diffs are identical (`diff -q
  ~/.hermes/profiles/ananda/skills/givetoget/<skill>/SKILL.md
  ~/Developer/Projects/give-to-get/skills/<skill>/SKILL.md`). Drift
  between the two is a silent-load-path bug — the next session loads
  one, you write the other, and the patch appears to "not stick."
  Reference files (`references/<topic>.md`) follow the same dual-rule
  and live alongside each SKILL.md. `linked_files` returned by
  `skill_view` will show the per-profile mirror path — that's the
  canonical location for loading, but the repo copy is the canonical
  location for committing and reviewing. The lead-developer skill
  itself is a `givetoget-*` skill and follows this convention; if
  you find yourself patching it via `skill_manage`, the patch goes
  to both copies or the next session won't see it.
- **Claude.AI message files at `~/.hermes/messages/*-claude-to-ananda-*.md`
  are LLM-generated drafts from Claude.AI (cloud), relayed by Aaron via
  copy-paste — not peer correspondence.** Claude.AI has no live
  visibility into this machine, this session, or the repo beyond what
  Aaron pastes into its window. Treat each substantive claim as
  unverified until you check it yourself (`curl
  https://api.github.com/...`, `git ls-remote`, a direct filesystem
  read). Specifically: when Claude's drafts say "Aaron answered X" or
  "from Aaron plus me," that's Claude modeling the answer, not
  reporting it — ask Aaron. The dual-source framing ("Aaron relaying
  my words back through chat") is one source through two channels, not
  independent confirmation. Don't change authorship, commit hashes,
  or scope decisions based on a Claude-message draft without verifying
  the underlying claim against the repo.
- **Re-check filesystem state across turns before reporting a file
  doesn't exist.** A user asking "read X" twice in a row, with
  intervening work between, can mean a file that didn't exist at the
  first `ls` does exist at the second. Don't lock in "file not found"
  from a stale state — re-stat (or `ls -la`) at the moment of the
  action, especially across turns where the user may have just created
  the file in another terminal.

- **Prefer one consolidated reviewer over many separate specialist
  reviewers. More agents means more coordination surface.** Sept 2026:
  the temptation after a multi-failure incident is to add a security
  reviewer, a deploy-discipline reviewer, a migrations reviewer,
  etc. The right shape is *one* "Security & Release Reviewer"
  that runs near merge time against a focused checklist (migrations
  applied? secrets in diff? schema-qualified functions? env vars
  set?). That fragmented setup re-creates the coordination problem
  it was meant to solve — multiple windows with overlapping
  state, contradictory reports from parallel runs, and unclear
  ownership when the agents disagree. The trap generalizes: if
  you're considering adding an agent to fix a problem caused by
  agent coordination, add a checklist or a CI gate instead.

- **Migration drift is bidirectional — check both directions, not
  just "are my repo files applied."** Forward drift (a repo file
  not in `supabase_migrations.schema_migrations`) is the easy
  half to think about. Reverse drift (an entry in
  `schema_migrations` has no matching repo file) is the easy
  half to forget. It surfaced in this project on 2026-09-07 as
  `010_workspace_lookup_helper.sql`: the function existed in prod
  and was recorded in `schema_migrations`, but the source SQL was
  never committed to the repo. The route called the function, the
  route comment referenced the .sql file by name, and the file did
  not exist. A clean checkout could not reproduce, audit, or
  re-test the migration. The current `scripts/check-migrations-applied.sh`
  covers both directions (forward fails, reverse warns; promote
  the reverse check to error with `STRICT_DB_MIGRATIONS=true`).
  When you can't reach the prod DB to diff against, the correct
  move is to write the missing .sql by inference from the route's
  usage, mark the file and the commit explicitly as **INFERRED,
  NOT VERIFIED AGAINST PROD**, and include the exact queries a
  person with prod SQL access should run to amend any differences
  (typically `pg_get_functiondef` plus an
  `information_schema.routine_privileges` query). The full
  diagnose-and-write recipe is in
  `references/migration-drift-diagnosis.md`.

## Deploy checklist — load before any commit that touches production code

The on-disk change is step one of "done," not the whole thing. The
recurring failure mode on this project is committing a fix, having
Aaron re-test, and watching the bug repro because the deployed
runtime is older than the repo. Hermes cannot redeploy from this
machine — no Vercel token, no Supabase CLI linked, no
`supabase/config.toml`, no service-role key. The user runs the
redeploy. The handoff is the contract.

> **Bug record:** every bug fixed in a deploy should also be tracked
> as a GitHub Issue on `awykoff/give-to-get` (canonical) with a
> verification note on close. Cross-link the issue from this
> branch's PR description and from the relevant Obsidian lesson
> note. See the *GitHub Issues is the canonical bug tracker*
> pitfall below for the full convention.

### Gates that already exist (added 2026-09-07 on branch `ananda/deploy-discipline-ci`, not PR #3)

- **`scripts/check-migrations-applied.sh`** — fails CI if there are
  migration files in the repo newer than what's recorded as applied
  in `supabase_migrations.schema_migrations` on the target Supabase
  project. Wired into `.github/workflows/migrations-check.yml`. Needs
  `SUPABASE_MIGRATIONS_DB_URL` as a GitHub Actions secret. Skip with
  `ALLOW_UNAPPLIED_MIGRATIONS=true` only when the migration was
  applied via Dashboard SQL Editor (the bookkeeping table won't
  reflect it).
- **`scripts/secret-scan-staged.sh`** — scans the staged diff for
  known credential prefixes (`sbp_`, `ghp_`, `sk-`, `AKIA`, etc.).
  Warn-only by default; set `SECRET_SCAN_BLOCK=true` to fail the
  commit. Pre-commit hook installer: `scripts/install-hooks.sh`.
  Allowlist per-line via `# gitleaks:allow`. CI equivalent:
  `.github/workflows/secret-scan.yml` (uses gitleaks directly with
  `.gitleaks.toml` for entropy-based detection).
- **`.gitleaks.toml`** — allowlist for known-safe patterns and the
  test fixture paths. Update this when adding new prefix patterns to
  the bash script so the two stay aligned.

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
