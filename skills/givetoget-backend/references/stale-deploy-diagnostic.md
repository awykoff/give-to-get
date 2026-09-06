# stale-deploy-diagnostic — when "fixed on disk" doesn't reach production

This is the failure mode where the on-disk source for a file is correct,
but the deployed runtime (Supabase Edge Function OR Vercel-deployed
Next.js route) is older than what's in the repo. It is the single most
common "I fixed it and nothing changed" pattern on give-to-get.com.

Hermes cannot redeploy from this machine. The whole point of this
document is to make the diagnosis fast and the handoff to Aaron
explicit so a fix doesn't get claimed as done when it's only done
on disk.

## When to suspect it

The bug report shape:

- "Production shows error X for column Y" — and X mentions a column
  name that **does not appear** in the on-disk source for the file the
  report blames.
- "I redeployed the Edge Function and it's still failing."
- "The error references a symbol/method/column that doesn't exist in
  the current source."
- The fix is clearly visible in the on-disk source (you can grep it
  out, the diff is unambiguous) but production behaves as if the fix
  isn't there.

## Two distinct stale surfaces

The redeploy command differs by surface. Don't conflate them.

### Surface A — Supabase Edge Functions

**Files**: `supabase/functions/<name>/index.ts` plus any `_shared/*` it imports.

**Redeploy command** (run by Aaron, not Hermes):

```
supabase functions deploy <name>
```

**Telltale that you're hitting Surface A**:

- Production error references a column/symbol/function that doesn't
  exist in `supabase/functions/<name>/index.ts`.
- Supabase Edge Function logs for that function show the invocation
  AND the error.

### Surface B — Vercel-deployed Next.js

**Files**: anything under `src/app/**` plus `next.config.*`. Specifically,
the API routes in `src/app/api/**/route.ts`.

**Redeploy command** (run by Aaron, not Hermes):

```
vercel --prod
```

or push to the branch Vercel watches (likely `main`).

**Telltale that you're hitting Surface B**:

- Response includes `Server: Vercel` header.
- Error string in the response body is a raw PostgREST message like
  `Could not find the '<col>' column of '<table>' in the schema cache`
  OR `new row violates row-level security policy for table "<table>"`.
- **Supabase Edge Function logs for the downstream function show ZERO
  invocations in the matching window.** This is the diagnostic
  combination: the request isn't reaching the Edge Function, so the
  failure is happening inside the Vercel route, before the
  `fetch(EDGE_FN_URL, ...)` call.
- The on-disk file under `src/app/api/...` has ZERO references to the
  failing column/symbol. **This is evidence FOR stale deploy, not
  against it** — the on-disk file may have been refactored since the
  deployed version was built.

The Surface B trap is especially insidious because the symptom looks
like a code bug, the file path matches the request URL, and a quick
grep shows the column isn't in the file — which reads as "the file
is fine, the bug must be elsewhere." But the file on Vercel may be
older than the file on disk.

## Diagnostic sequence (run in this order)

Before patching ANYTHING, walk this list. Skipping it produces patches
that don't fix production.

1. **Identify the failing column/symbol/error string.** Note exactly
   what the production error says.

2. **Grep the on-disk source for it.** Search the file the bug report
   blames, plus any file that could plausibly be responsible (e.g. for
   `/api/import`, search `/api/import/route.ts`, the Edge Function it
   forwards to, and any client-side mapping code).

   - **Found in on-disk source** -> real code bug, patch it.
   - **NOT found in on-disk source** -> suspect stale deploy, continue.

3. **Check git history of the failing file.**

   ```
   git log --all --oneline -- <path>
   git show <earliest-commit>:<path>
   ```

   If the file was substantially rewritten at some point (e.g. turned
   from a handler-with-inserts into a thin proxy), the deployed version
   may predate the rewrite. The on-disk file is then a different
   *program* from the deployed file even though they share a path.

4. **Check the downstream Edge Function logs.** Supabase dashboard ->
   Edge Functions -> `<name>` -> Logs. Filter by recent time window.

   - **Invocations present with errors** -> the Edge Function is the
     problem; it's stale OR has a real bug. Surface A.
   - **Zero invocations in the failure window** -> the request isn't
     reaching the Edge Function; the failure is upstream of it. Most
     likely Surface B (Vercel route stale).

5. **Check the Vercel deployment** (if Surface B is suspected).
   Vercel dashboard -> Project -> Deployments. Look at the SHA of the
   latest production deploy. Compare to your local `main` HEAD.

   ```
   git log --oneline -1
   ```

   If the deployed SHA is older than the local HEAD and the changes
   between them include the failing file, you've confirmed stale
   deploy. The fix is `vercel --prod`.

6. **Hand the redeploy back to Aaron.** Don't claim "fixed on disk"
   when "fixed on disk" hasn't shipped. The handoff needs:

   - Which surface (A or B).
   - The exact redeploy command.
   - The list of files that need to ship (for Edge Functions, that's
     `index.ts` plus any `_shared/*` it imports; for Vercel, anything
     that's changed in `src/app/**` since the last deploy).
   - Verification queries to run AFTER the redeploy (see below).

## Post-redeploy verification

After Aaron redeploys, run these to confirm the fix actually shipped:

**For Surface A (Edge Function)**:

```sql
-- In Supabase SQL Editor, after triggering an import:
select count(*) from contacts;
-- Should increment by expected new-contact count.

select type, amount, description, created_at
from credits_ledger
order by created_at desc
limit 5;
-- Should show a fresh 'earn' row (proves trg_import_credits fired).
```

**For Surface B (Vercel route)**:

```sql
-- Same as Surface A plus:
select count(*) from imports where status = 'complete';
-- Should reflect the import that just succeeded.
```

In the Supabase dashboard, check `Edge Functions -> import-processor ->
Logs` for the matching window — should now show invocations.

In the browser, re-trigger the import and check the response: a 200
with `{ new_contacts_count, duplicate_count, invalid_count,
credits_earned }` proves the whole pipeline ran end-to-end.

## Why this matters

This trap has hit the project at least four times in a row during
September 2026:

1. Auth callback route — code in repo, no `/auth/callback` route
   existed in git history -> deployed code was stale.
2. Workspace bootstrap migration — file sat in `supabase/migrations/`
   for months, never pasted into the SQL Editor.
3. `import-processor` Edge Function — on-disk source correct, deployed
   version stale.
4. `/api/import` API route — on-disk source correct, deployed version
   stale.

The pattern is consistent: production is months behind disk. Hermes can
fix what's on disk; Aaron owns the cloud-side deploy/apply step. Don't
paper over that split by claiming closure on fixes that haven't shipped.