---
name: givetoget-database
description: Postgres migrations, RLS policies, and triggers for give-to-get.com's Supabase schema
version: 1.0.0
metadata:
  hermes:
    tags: [supabase, postgres, rls, givetoget]
    category: database
---

# give-to-get.com — Database

## When to Use

Writing or editing a migration, an RLS policy, a trigger, or generated
TypeScript types.

## Procedure

1. Read `supabase/migrations/002_apollo_aligned_schema.sql` — this is the
   canonical schema (Apollo-aligned, 60+ contact fields, superseded 001).
   `004_private_schema_security.sql` layers on additional RLS hardening.
2. New migrations are numbered, sequential SQL files under
   `supabase/migrations/`. Never edit a migration that's already been applied
   to a live environment — write a new one.
3. Every new table gets RLS enabled in the same migration that creates it —
   not a follow-up migration.
4. Regenerate `lib/types/database.types.ts` after any schema change.

## Tables

```
workspaces, workspace_members, companies, contacts, imports, exports,
export_contacts, credits_ledger, workspace_contact_access
```

## Hard Rules

- `credits_ledger` is **append-only** — no `UPDATE`/`DELETE` policy should
  ever exist for it; write a Postgres rule or trigger that rejects those
  statements outright.
- `email_normalized` = `LOWER(TRIM(email))` is the global dedup key across
  the whole `contacts` table, not per-workspace.
- Credit mutations happen only via triggers fired by `imports`/`exports`
  status changes — never via a direct client-side insert into
  `credits_ledger`.
- RLS: workspace A must never be able to read workspace B's `imports`,
  `exports`, or unlocked contact rows.

## Pitfalls

- Forgetting RLS on a junction table (`export_contacts`,
  `workspace_contact_access`) because "it's just a join table" — these leak
  contact access just as easily as the primary tables.
- Writing dedup logic as a per-row loop instead of a single batch query —
  this is a `givetoget-backend` concern too, but the constraint (`UNIQUE` on
  `email_normalized`) belongs here.

## Verification

`supabase db push` (or running the migration in the SQL editor) succeeds;
`SELECT * FROM pg_policies WHERE tablename = '<new_table>'` returns rows;
attempting `UPDATE credits_ledger ...` as a test fails.
