# AGENTS.md — give-to-get.com

> This file is auto-loaded by **Hermes Agent** (Nous Research) at session start.
> It is the single source of project context — keep it concise. Deep specs
> (schema DDL, brand tokens, full PRD) live in `PRD.md`, `design/design-system.md`,
> and `supabase/migrations/`, and are pulled in on demand via the skills in `skills/`.

---

## What this is

**give-to-get.com** — a B2B SaaS contact database exchange. Upload a CSV of
B2B contacts → earn 1 credit per unique new contact contributed to the
shared pool → spend credits to download contacts filtered by vertical,
seniority, location, and company size.

**Tagline:** Give contacts. Get contacts.
**Stage:** MVP v1. **Owner:** Aaron Wykoff / A. Wykoff Consulting.
**Domain:** give-to-get.com (hosted on Vercel)
**Repo:** https://github.com/awykoff/give-to-get (branch `main`)

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS v4, React 19 |
| Auth | Supabase Auth — email + Google OAuth |
| Database | Supabase (Postgres 15) + RLS + triggers |
| Storage | Supabase Storage |
| Edge Functions | Supabase Edge Functions (Deno) |
| Hosting | Vercel |

## Design system (non-negotiable)

```js
bg: "#0C0C0F"  sidebar: "#111115"  surface: "#18181D"
accent: "#8B5CF6"  accentText: "#C4B5FD"
text: "#F0EEFF"  muted: "#8B87A8"
border: "rgba(255,255,255,0.07)"   // ghost borders only, never solid
```
Font: DM Sans. Aesthetic: Attio-style dark mode — flat surfaces, no drop
shadows. Full token set, typography scale, and component specs are in
`design/design-system.md` — load the `givetoget-frontend` skill before
writing UI so those tokens are in context.

**Never:** light/white backgrounds, any accent besides `#8B5CF6`, drop
shadows on cards, solid-color borders, `<form>` tags in React.

## Critical business rules

1. `credits_ledger` is **append-only** — never UPDATE or DELETE rows.
2. `email_normalized` (LOWER + TRIM) is the global contact dedup key.
   All candidate-builder normalization must use `.toLowerCase().trim()` to
   match — see `supabase/functions/import-processor/index.ts` candidate
   build site and the givetoget-backend skill pitfall.
3. Never return a contact's email without a credit unlock or the workspace's
   own contribution of that contact.
4. Credit **earn** happens via a DB trigger when an import completes.
5. Credit **spend** happens via a DB trigger when an export record is created.
6. RLS is enabled on every table, from day one, no exceptions.
7. Personal email domains are rejected on import (gmail, yahoo, hotmail,
   outlook, icloud, etc.).
8. **Canonical schema column names (002_apollo_aligned_schema.sql).** The
   `contacts.num_employees` column is INTEGER — NOT the older
   `company_size` TEXT enum from `001_initial_schema.sql`. Use
   `num_employees` everywhere; `company_size` references are stale
   schema and will surface as `Could not find the 'company_size'
   column of 'contacts' in the schema cache`. Same caution applies to
   any other 001→002 renames (see `givetoget-database` skill for the
   canonical list).
9. **Workspace bootstrap is owned by `trg_on_auth_user_created`.** The
   trigger on `auth.users` calls `private.provision_workspace_for_user`
   which creates the workspaces row, the admin workspace_members row,
   and the 100-credit bonus credits_ledger row. Installed by
   `supabase/migrations/006_signup_bootstrap.sql`. Works for both
   email confirmation and Google OAuth because both end in an
   `auth.users` INSERT. Application code must NEVER insert directly
   into `workspaces`, `workspace_members`, or write a `'bonus'` row
   to `credits_ledger` — that's the trigger's job. If a new user
   authenticates but gets "No workspace found for this user", the
   trigger isn't running (either the migration wasn't applied or the
   user pre-dates the trigger and the backfill didn't run).
10. **PKCE callback is `/auth/callback`** (`src/app/auth/callback/route.ts`).
    Every Supabase Auth redirect — `signUp({ emailRedirectTo })`,
    `signInWithOAuth({ redirectTo })`, magic links — MUST point at
    this callback, never at the final destination. The callback calls
    `exchangeCodeForSession()` then redirects to `?next` (default
    `/dashboard`). Without it, the PKCE code param is dropped at the
    destination and the user lands unauthenticated. After changing
    the callback path, also update the Supabase Auth dashboard's
    Redirect URLs allow-list.

**Known limitation (v1 export):** The `trg_export_credits` trigger fires
on `INSERT INTO exports`, before the Edge Function has generated the file
or uploaded it to Storage. If anything fails between the row insert and
the final `status='complete'` UPDATE, the workspace has already been
charged (`credits_ledger` 'spend' row written) and the file does not
exist. The user is out those credits either way. This is accepted for
MVP v1; a proper rollback would need the credit deduction to be deferred
past the file-and-storage success path (e.g. a two-stage trigger or a
custom helper that wraps both halves in one transaction). See
`supabase/functions/export-generator/index.ts` header comment.

## How this project runs on Hermes

There's no persistent named swarm here — Hermes doesn't keep long-lived
"agent" identities. Instead:

- **The Lead Developer is just this session** — the main Hermes agent,
  reading this file, acting as tech lead for the repo.
- **Specializations are Skills**, not standing agents. Each role from the old
  swarm (architect, frontend, database, backend, auth, tester, docs) is now a
  skill in `skills/`, loaded on demand via `/skill-name` or delegated to a
  subagent with that skill's brief. Run `/givetoget-lead-developer` to load
  the orchestration skill first — it explains phase sequencing and when to
  delegate to a subagent vs. do the work inline.
- **Delegation** — when a piece of work is large and self-contained (e.g.
  "build the entire import pipeline"), use Hermes subagent dispatch rather
  than trying to simulate multiple agents in one thread. Give the subagent
  the relevant skill name plus a written brief (what's been decided, what's
  left).

Skill directory (see each `SKILL.md` for full detail):

| Skill | Covers |
|---|---|
| `givetoget-lead-developer` | Orchestration, phase sequencing, when to delegate |
| `givetoget-architect` | Next.js 16 app structure, routing, API design, ADRs |
| `givetoget-frontend` | React components, dark theme tokens, Tailwind v4 |
| `givetoget-database` | Postgres migrations, RLS policies, triggers |
| `givetoget-backend` | Supabase Edge Functions — import + export pipelines |
| `givetoget-auth` | Supabase Auth, Google OAuth, workspace bootstrap |
| `givetoget-tester` | Unit, RLS, and Playwright E2E coverage |
| `givetoget-docs` | Keeping README/AGENTS.md/schema notes in sync |

- **Obsidian knowledge vault setup** lives at `docs/obsidian-vault/README.md`
  (product specs, ADRs, agent memory conventions — bootstrap a personal
  vault from there). The reasoning for why this is in the repo rather than
  a personal tool is in `docs/adr/0001-documentation-architecture.md`.
  Convention: contributor-facing docs live in `docs/`; per-contributor
  working vaults stay local and never get committed to this repo.

## Build phase sequence

```
Phase 1 — Foundation:    Next.js scaffold, apply migrations, auth pages
Phase 2 — Core Screens:  Sidebar/TopBar, Dashboard, Credits
Phase 3 — Import:        import-processor Edge Function, upload + review UI
Phase 4 — Exchange:      Contacts table, filters, export modal, export Edge Function
Phase 5 — Polish:        Mobile pass, E2E suite, docs sync
```

Phase 1 was retroactively completed by `006_signup_bootstrap.sql` —
that migration installed the workspace-bootstrap trigger that should
have shipped with the original 001 migration. Phases 3 and 4 are
shipped; the import flow is end-to-end verified as of Sept 2026.

## Production env vars (Vercel project settings)

Set these in Vercel → Project Settings → Environment Variables before
the deploy is considered done. Missing vars are silent failures — the
app starts, requests succeed for cached routes, and the first request
that touches the Edge Function fails with a generic `fetch failed`.

- `NEXT_PUBLIC_SUPABASE_URL` — anon-keyed client.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon-keyed client.
- `SUPABASE_SERVICE_ROLE_KEY` — used by Edge Functions only; never
  exposed to the browser bundle.
- `SUPABASE_EDGE_FN_URL` — base URL for the import-processor Edge
  Function. Read by `src/app/api/import/route.ts` and forwarded as
  the upstream for `POST /api/import`. **Required in production.**
  Without it the route falls back to `http://localhost:54321/...`
  which fails on every prod request.
- `SUPABASE_EDGE_FN_URL_EXPORT` — base URL for the export-generator
  Edge Function, read by `src/app/api/export/route.ts`.

**Naming inconsistency flag:** the two Edge-Function URL vars are
named differently (`SUPABASE_EDGE_FN_URL` for import,
`SUPABASE_EDGE_FN_URL_EXPORT` for export). Easy to set one and
forget the other. Consider normalizing to a single
`SUPABASE_EDGE_FN_URL_BASE` with per-function paths, or a shared
helper, the next time either route is touched.

## Deploy discipline — a fix is not done until it's in production

Hermes from this machine cannot redeploy. It can write code, write
migrations, run `npm run build`, run tests. It cannot run
`supabase functions deploy` (no Supabase CLI linked, no
`supabase/config.toml`, no service-role token) and cannot run
`vercel --prod` (no Vercel token). The user runs the redeploys.

That asymmetry is the source of the recurring "I fixed it and nothing
changed" failure mode. The on-disk source is correct, production is
running something older, the bug repros.

**The deploy checklist. Run all that apply, in order.**

1. **Code only** (Next.js / app / components) → `vercel --prod` from
   the user's machine. Confirm Vercel deployment succeeded.
2. **Edge Function** (`supabase/functions/<name>/index.ts` or any
   `_shared/*` it imports) → `supabase functions deploy <name>` from
   the user's machine. Confirm Supabase Edge Function logs show the
   new version's invocation.
3. **Migration** (anything under `supabase/migrations/`) → apply via
   Supabase SQL Editor or `supabase db push`. Verify the new
   objects exist (`\df`, `\dt`, `\dT`, or the matching
   `information_schema` query).
4. **Supabase Auth dashboard** (any change to a redirect URL,
   callback path, or OAuth provider) → update the Redirect URLs
   allow-list in the dashboard. This is independent of any code;
   setting the code without updating the allow-list silently breaks
   sign-in.
5. **Verify in production** before declaring done. For Edge Functions:
   check the Supabase Edge Function logs for the new version. For
   Vercel routes: hit the route from the browser with the same input
   the bug report used, confirm the response matches the fix. For
   migrations: query the database directly.

**Hermes's contract:** write the on-disk change, run `npm run build`
to confirm it compiles, hand the redeploy back to the user with the
exact command. Do NOT commit on the user's behalf when the bug
report has a scope note like "don't merge yet" or "I'll re-test". Do
NOT claim a fix is shipped until production behaves as fixed.

See `skills/givetoget-lead-developer/SKILL.md` for the session-time
view of the same rule, and
`skills/givetoget-backend/references/stale-deploy-diagnostic.md` for
the diagnostic sequence when a fix on disk doesn't reach production.

## File structure

```
AGENTS.md              ← this file (Hermes context)
PRD.md                  ← product spec (v1 scope in §5, exclusions in §6)
skills/                 ← Hermes skills (this project's "agents")
src/app/                ← Next.js App Router
src/components/         ← React components + Dashboard.jsx prototype
supabase/migrations/    ← numbered SQL migrations (002 is the Apollo-aligned schema — use it)
design/design-system.md ← full token set + component specs
```

## Do not

- Never use light backgrounds, another accent color, drop shadows, or solid
  borders.
- Never `UPDATE`/`DELETE` `credits_ledger` rows.
- Never expose a contact email without a credit deduction.
- Never skip RLS on a new table.
- Never use `<form>` tags in React — event handlers only.
- Never commit `.DS_Store`.
- Never use the Pages Router.
