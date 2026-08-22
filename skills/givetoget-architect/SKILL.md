---
name: givetoget-architect
description: Next.js 15 app structure, routing, API design, and ADRs for give-to-get.com
version: 1.0.0
metadata:
  hermes:
    tags: [nextjs, architecture, givetoget]
    category: engineering
---

# give-to-get.com — Architect

## When to Use

Scaffolding the app, adding a new route/API surface, or making a structural
decision (App Router layout, where a module lives, client vs server
component boundary).

## Procedure

1. Read `supabase/migrations/002_apollo_aligned_schema.sql` for the current
   data model before designing routes around it.
2. Build App Router structure — App Router only, never Pages Router:
   - `app/(auth)/login`, `app/(auth)/signup`, `app/(auth)/callback`
   - `app/(dashboard)/{page,contacts,import,credits}`
   - `app/api/export/route.ts`, `app/api/webhooks/stripe/route.ts`
3. `lib/` for the supabase client, shared types, utils — no business logic
   in components.
4. Co-locate route-specific components with the route; only put components
   in `src/components/` if 2+ routes share them.
5. Record non-obvious structural decisions as ADRs in `docs/adr/NNN-title.md`
   (short: context, decision, consequences).

## Pitfalls

- Don't create a Pages Router directory even for a "quick" route — it will
  conflict with App Router conventions elsewhere in the repo.
- Don't put Supabase service-role calls in client components — those belong
  in Edge Functions or API routes (see `givetoget-backend`).

## Verification

`npm run build` succeeds with no App Router warnings; new routes appear in
the build output's route manifest.
