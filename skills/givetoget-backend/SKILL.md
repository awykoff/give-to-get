---
name: givetoget-backend
description: Supabase Edge Functions for give-to-get.com's import and export pipelines, the thin Next.js API routes that gate them, and the deploy-discipline traps that surface when on-disk fixes don't reach production
version: 1.4.0
metadata:
  hermes:
    tags: [supabase, deno, edge-functions, vercel, deploy-discipline, dedup, givetoget]
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
   - `app/api/export/route.ts`, `app/api/import/route.ts` — thin Next.js
     routes that gate the Edge Functions (auth check, workspace resolve,
     forward to the function with the service-role key)
3. After every edit, `npm run build` before claiming done. Some
   TypeScript / Next.js errors (mismatched template literals, broken
   imports, malformed auth-header string concatenation) only surface
   at build time, not in single-file tsc.
4. Never claim a fix is shipped just because the on-disk source is
   correct. See the stale-deploy pitfall below — Hermes from this machine
   cannot redeploy either Supabase Edge Functions OR the Vercel route.
   The user runs the redeploy; until they do, production is unchanged.

## Import Processor Rules

- Reject personal email domains (gmail, yahoo, hotmail, outlook, icloud,
  etc.) before insert.
- Batch dedup in a single SQL query against `email_normalized` — never loop
  per-contact.
- **Dedup the incoming batch against itself, not just against existing DB
  rows.** The DB dedup query only catches emails that already exist in
  `contacts`. Two rows in the same CSV that normalize to the same
  `email_normalized` both pass the DB check, then the chunked INSERT
  hits the `UNIQUE(email_normalized)` constraint on the second row and
  aborts the entire import with a raw Postgres error. Canonical pattern
  (lives in `import-processor/index.ts` between the DB dedup and the
  chunk insert): walk `candidates` in order, track `_email` in a
  `Set<string>`, drop subsequent occurrences, bump an
  `intraBatchDuplicates` counter. First occurrence wins (preserves CSV
  upload order). Final `duplicateCount` =
  `(dedupedCandidates.length - newRows.length) + intraBatchDuplicates`.
  Verification scenario: 7-row CSV with one intra-batch duplicate
  (e.g. `dana@brightpeak.com` + `DANA@Brightpeak.com`) and 3
  personal-domain rows should produce 3 new + 1 duplicate + 3 invalid,
  no raw `duplicate key value violates unique constraint` error.
- **Defense in depth: per-row fallback when chunk INSERT hits a unique
  constraint.** Even with intra-batch dedup, two concurrent imports
  can both pass the DB dedup query then collide at insert time. If a
  chunk INSERT fails AND the error matches
  `/unique constraint|duplicate key/i`, fall back to per-row inserts
  within that chunk; count collisions as duplicates. Any other error
  class (NOT NULL violation, malformed UUID, value-too-long) is a real
  bug — surface it via `markFailed` and don't mask it. Per-row fallback
  is a safety net, not the primary path; the bulk insert is what gives
  you the 500-row round-trip efficiency.
- Chunk inserts at 500 rows max per statement.
- Derive seniority from the raw title string via `normalizeSeniority()`.
- Update the `imports` row's status to `complete` last — that's what fires
  the credit-earn trigger; don't award credits directly from this function.
- **`_email` normalization must match the DB's `email_normalized`
  definition or dedup silently breaks.** The DB column is
  `LOWER(TRIM(email))` (defined as `GENERATED ALWAYS AS ... STORED`
  in `001_initial_schema.sql` and inherited by `002_apollo_aligned_schema.sql`).
  The candidate-builder in `import-processor/index.ts` currently does
  `.toLowerCase()` only — a CSV cell with leading/trailing whitespace
  (e.g. `" dana@brightpeak.com "`) produces an `_email` that
  doesn't equal the DB's `email_normalized` and bypasses both the
  DB-dedup query and the intra-batch dedup. Fix: `const email =
  emailRaw.toLowerCase().trim();` at the candidate-build site. Same
  rule applies to the workspace-resolution lookup in
  `src/app/api/import/route.ts` if it ever takes a workspace
  identifier as user input.
- **Numeric coercion for `num_employees` / `annual_revenue` / `quality_score`
  must handle ranges.** B2B CSVs routinely store employee count as a text
  range (`"51-200"`, `"1,001-5,000"`) or an open-ended value
  (`"10000+"`), not as a bare integer. Naive `Number(cleaned)` returns
  `NaN` for any of these and silently drops the cell. Canonical algorithm
  (matches `import-processor/index.ts` `coerceForColumn`):

  1. Strip currency / thousands-separators / whitespace (`[,$%\s]`).
  2. Split the cleaned string on `[-+]` (range separators). A leading
     `-` or `+` on the very first character is a sign, not a separator,
     but `num_employees` is never meaningfully negative so this is
     academic — the rule that matters is "don't let `"-200"` parse as
     a negative number when it really means a range endpoint".
  3. From each part, extract the first `^-?\d+` match. Collect up to
     two integers total; stop early once you have two.
  4. One number → use it. Two numbers → midpoint, rounded
     (`Math.round((a + b) / 2)`). Zero numbers → null.

  Worked examples for sanity:
  `"51-200"` → 125 (midpoint)
  `"1,001-5,000"` → 3000 (commas stripped first)
  `"10000+"` → 10000 (only one integer found)
  `"100"` → 100
  `"$5M"` → 5 (currency stripped, `M` ignored — `$1M-$5M` parses as
  midpoint of 1 and 5, which is wrong but rare enough to ignore)
  `"abc"` → null (no schema-cache error raised)
  `"-100"` → 100 (sign dropped — `num_employees` shouldn't be negative)

  No digits at all → null. The function must never raise a
  schema-cache error from this path; null is always safe because the
  column is nullable. Use this shape verbatim; rewriting the regex
  naively reintroduces the bug where range separators are interpreted
  as signs.

  See `references/numeric-coercion.md` for the Python verification
  script that confirms the algorithm against ~30 inputs.

- **Import review screen handles range strings the same way.** The
  client-side preview in `ImportReview.tsx` shows the first 5 mapped
  fields from the raw row, so for a `num_employees` column the user
  sees `"51-200"` in the preview but the imported integer is `125`.
  That's correct — the preview is the raw value, the stored value is
  the coerced integer. Don't try to "fix" the preview to show 125; it
  would silently disagree with the CSV the user uploaded.

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
- **Inserting into `contacts` with the anon-keyed Next-style client.** RLS
  on `contacts` is `INSERT ... WITH CHECK (auth.role() = 'service_role')`.
  The Next.js API route uses the user's anon-keyed server client (cookies +
  `auth.getUser()`), so it cannot insert contacts — PostgREST reports the
  failure as `new row violates row-level security policy for table
  "contacts"`, which is easy to misdiagnose as a missing column or bad
  constraint. The contact-insert path must run on the service-role client
  inside the Edge Function, with the API route as a thin auth gate that
  resolves `workspace_id` and forwards the payload. Same rule applies to
  `companies` (also service-role-only INSERT). When the API route does need
  to write a workspace-scoped row on behalf of a user (`imports`,
  `exports`), the path is Edge Function + service role + `trg_*_credits`
  triggers, not an anon-keyed insert.
- **Deployed runtime can be stale relative to source on disk — and the
  stale surface is whichever one production is actually running.** This
  is the single most common "I fixed it and nothing changed" failure
  mode on this project. It applies to **two distinct surfaces** with
  the same shape but different redeploy commands:

  **Surface A — Supabase Edge Functions** (e.g. `import-processor`):
  deployed via `supabase functions deploy <name>`. Hermes from this
  machine has no CLI linked, no `supabase/config.toml`, no service-role
  token. Telltale: the production error references a column/symbol
  that doesn't exist in `supabase/functions/<name>/index.ts`. Fix is
  always a redeploy — never a "weird bug, must be something else"
  rabbit hole. List the files that need to ship (`index.ts` plus any
  `_shared/*` it imports).

  **Surface B — Vercel-deployed Next.js** (e.g. `src/app/api/import/route.ts`):
  deployed via `vercel --prod` or by pushing to the branch Vercel
  watches. Hermes has no Vercel token. Telltales: response has the
  `Server: Vercel` header AND the error string is a raw PostgREST
  message like `Could not find the '<col>' column of '<table>' in the
  schema cache` AND the Supabase Edge Function logs for the
  *downstream* function show zero invocations in the matching window.
  The combination is diagnostic: the request is failing inside the
  Vercel route BEFORE the `fetch(EDGE_FN_URL, ...)` call, which means
  the deployed route has its own contact-insert code (older version
  predating the refactor that turned it into a thin proxy). Verifying
  the on-disk `/api/import/route.ts` and finding it has zero references
  to the failing column is **evidence for stale deploy, not evidence
  against it**.

  Diagnostic sequence before patching anything:

  1. Grep the on-disk source for the failing column/symbol. If absent,
     suspect stale deploy. If present, suspect actual code bug.
  2. Check git history of the failing file. If the file was rewritten
     (e.g. became a thin proxy from a heavier handler), the deployed
     version may predate the rewrite.
  3. Check the Supabase Edge Function logs for the *downstream*
     function. Zero invocations during the failure window = the request
     isn't reaching it = failure is upstream (Vercel route) or in
     pre-fetch auth code.
  4. Hand the redeploy back to the user explicitly with the exact
     command. Don't claim "fixed locally" when "fixed on disk" hasn't
     shipped.

  See `references/stale-deploy-diagnostic.md` for the full checklist,
  Vercel-vs-Supabase commands, and the verification queries to run
  after redeploy.
- **Schema-name drift between migrations catches Edge Functions too.**
  `001_initial_schema.sql` and `002_apollo_aligned_schema.sql` use
  different column names for the same concept (`company_size` TEXT CHECK
  vs `num_employees` INTEGER, `total_rows` vs `original_row_count`,
  `file_name` vs `filename`, etc.). 002 is canonical per AGENTS.md but
  001 still lives in the migrations directory. If a previous Edge
  Function was written against 001's column names and deployed, then
  someone later renamed them in `002` and applied the migration, the
  deployed function still references the old names and PostgREST will
  reject the INSERT with `Could not find the '<old_name>' column of
  '<table>' in the schema cache` — even though the on-disk source is
  correct. Always cross-check column references in
  `supabase/functions/**/index.ts` against `002` (not 001) before
  declaring a column-related bug "fixed on disk". And note the same
  drift exists in client UI — see `givetoget-frontend` for the UI-side
  version of this trap, and `givetoget-database` for the canonical
  list of renamed fields.
- **Node `fetch()` wraps every network error in `TypeError: fetch
  failed` — the real reason is on `.cause`, not `.message`.** Any
  `try { await fetch(...) } catch (e) { return e.message }` in an
  API route is silently swallowing the actual diagnostic (DNS failure,
  connection refused, TLS handshake, request abort, timeout). The
  cause chain can be one or two levels deep — Node's undici wraps the
  socket error in a `TypeError` whose `.cause` is the system-level
  error (`Error: connect ECONNREFUSED 127.0.0.1:54321` etc.), and
  some libraries wrap that again. Always walk `.cause` (and
  `.errors[]` for `AggregateError`) up to ~5 levels and emit every
  distinct message you find. The user-facing response can collapse
  back to a single string once the underlying issue is known, but
  during debugging include `causes: [...]` and `url: <the URL we
  tried, credentials redacted>` so the operator can immediately see
  whether it's DNS, connection, TLS, or timeout — and where you tried
  to send the request. Pattern lives in
  `src/app/api/import/route.ts` as `causeChain(e)` +
  `redactCredentials(EDGE_FN_URL)` — both routes share the same
  helper and the same pattern now; the helper is at
  `src/lib/edge-fn-url.ts`.
- **Edge-Function URL from env var with a localhost fallback silently
  fails in production.** Both routes go through the canonical helper
  at `src/lib/edge-fn-url.ts` (`getEdgeFnUrl(name)` reads
  `SUPABASE_EDGE_FN_URL` and appends `/functions/v1/<name>`; the
  export route additionally consults `getLegacyExportUrl()` for the
  one-redeploy-cycle `SUPABASE_EDGE_FN_URL_EXPORT` migration aid).
  If `SUPABASE_EDGE_FN_URL` is unset the helper falls back to
  `http://localhost:54321/functions/v1/<name>` so `supabase start`
  works — but in Vercel production a missing var means the route
  silently fetches localhost on a network with no listener, fails
  with the generic `fetch failed`, and looks identical to a
  misconfigured URL or a Supabase outage. The helper handles three
  things so the trap is loud instead of silent: (1) `console.warn`
  at module load when the fallback is in use, so a missing production
  var shows up in cold-start logs not at first request; (2)
  `redactCredentials(url)` for any URL you log or return, defensive
  against a leaked service role key embedded as `user:pass@host`;
  (3) the caller is responsible for including the redacted URL in
  the fetch-failed response body so the operator immediately sees
  whether they're hitting the right host. **Don't reintroduce the
  per-route env-var reads** — adding a new Edge Function means
  passing a new `<name>` to `getEdgeFnUrl()`, not a new env var.

## Verification

Local `supabase functions serve` invocation with a sample CSV produces the
expected new/duplicate/rejected counts; an export request against a
workspace with insufficient credits is blocked before file generation.

## Tool-usage gotchas (file editor)

- **The patch tool redacts the literal `Bearer ` substring inside
  `Authorization` headers.** When writing or editing an
  `Authorization: Bearer <secret>*** header, prefer string concatenation
  over template literals:

  ```ts
  // Works — string concatenation, no redaction
  Authorization: "Bearer " + serviceKey

  // Breaks — the patch tool redacts "Bearer " and the resulting diff
  // contains literal `***` instead, producing invalid TS
  Authorization: `Bearer ${serviceKey}`
  ```

  Symptom when this bites you: a successful `patch` (no error returned)
  but the next build fails with LSP diagnostics like
  `Cannot find name '$'` or `',' expected` near the Authorization line,
  because the on-disk file now contains `Authorization: *** ${...}\``
  with the `Bearer ` prefix silently replaced by `***`. The fix is
  to switch to string concatenation, re-patch, and re-run
  `npm run build` to confirm.
