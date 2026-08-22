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
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS v4 |
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
3. Never return a contact's email without a credit unlock or the workspace's
   own contribution of that contact.
4. Credit **earn** happens via a DB trigger when an import completes.
5. Credit **spend** happens via a DB trigger when an export record is created.
6. RLS is enabled on every table, from day one, no exceptions.
7. Personal email domains are rejected on import (gmail, yahoo, hotmail,
   outlook, icloud, etc.).

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
| `givetoget-architect` | Next.js 15 app structure, routing, API design, ADRs |
| `givetoget-frontend` | React components, dark theme tokens, Tailwind v4 |
| `givetoget-database` | Postgres migrations, RLS policies, triggers |
| `givetoget-backend` | Supabase Edge Functions — import + export pipelines |
| `givetoget-auth` | Supabase Auth, Google OAuth, workspace bootstrap |
| `givetoget-tester` | Unit, RLS, and Playwright E2E coverage |
| `givetoget-docs` | Keeping README/AGENTS.md/schema notes in sync |

## Build phase sequence

```
Phase 1 — Foundation:    Next.js scaffold, apply migrations, auth pages
Phase 2 — Core Screens:  Sidebar/TopBar, Dashboard, Credits
Phase 3 — Import:        import-processor Edge Function, upload + review UI
Phase 4 — Exchange:      Contacts table, filters, export modal, export Edge Function
Phase 5 — Polish:        Mobile pass, E2E suite, docs sync
```

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
