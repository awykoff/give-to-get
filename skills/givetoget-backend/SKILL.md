---
name: givetoget-backend
description: Supabase Edge Functions for give-to-get.com's import and export pipelines
version: 1.0.0
metadata:
  hermes:
    tags: [supabase, deno, edge-functions, givetoget]
    category: backend
---

# give-to-get.com — Backend

## When to Use

Building or editing an Edge Function, especially the import-processor or
export-generator pipelines.

## Procedure

1. Confirm `givetoget-database`'s migrations are already applied — these
   functions assume the Apollo-aligned schema exists.
2. Build/edit:
   - `supabase/functions/import-processor/index.ts` — CSV parse, dedup,
     insert, credit earn
   - `supabase/functions/export-generator/index.ts` — fetch contacts,
     generate file, upload, unlock
   - `supabase/functions/_shared/cors.ts`, `_shared/supabase.ts` — shared
     helpers, service-role client
   - `app/api/export/route.ts` — thin Next.js route that triggers the Edge
     Function

## Import Processor Rules

- Reject personal email domains (gmail, yahoo, hotmail, outlook, icloud,
  etc.) before insert.
- Batch dedup in a single SQL query against `email_normalized` — never loop
  per-contact.
- Chunk inserts at 500 rows max per statement.
- Derive seniority from the raw title string via `normalizeSeniority()`.
- Update the `imports` row's status to `complete` last — that's what fires
  the credit-earn trigger; don't award credits directly from this function.

## Export Generator Rules

- Runs with the service-role key only — a contact's email must never be
  returned to a client without a completed credit spend.
- Insert `workspace_contact_access` rows for every contact included in the
  export.
- Generate a signed Storage URL with a 1-hour expiry.
- Support CSV, XLSX, and JSON output formats.

## Pitfalls

- Doing the dedup check client-side "to show a live preview" and trusting
  it — the server-side batch query is the only source of truth.
- Forgetting the CORS shared helper on a new function, breaking calls from
  the Next.js API route.

## Verification

Local `supabase functions serve` invocation with a sample CSV produces the
expected new/duplicate/rejected counts; an export request against a
workspace with insufficient credits is blocked before file generation.
