# Auth-schema lookups from a route handler

## Problem

A Next.js API route handler running with the cookie-backed server client
(`@/lib/supabase/server`) cannot read the `auth.users` table. PostgREST
doesn't expose the `auth` schema in its `expose_schemas` setting, so
queries against it return a stable schema-not-found error. This bites
any feature that needs to resolve an email address to its
`auth.users.id` (e.g. connection invites resolved by recipient email).

## Options (and why most are wrong)

1. **`supabase.from('auth.users').select('id').eq('email', email)`** —
   fails. PostgREST rejects the request with a schema-not-exposed error.
   Don't write this query; it wastes an integration-test cycle.

2. **Switch to the service-role client** — works, but exposes the
   service-role key to a user-driven code path. Vercel server-side env
   vars stay on the server, but using service-role from arbitrary
   request handlers violates least-privilege: any future bug that lets
   a caller influence the query becomes a privilege-escalation path.

3. **Call `admin.auth.getUserByEmail(email)` via a separate admin
   client** — works, but requires service-role again. Same problem.

4. **Denormalize `email` onto a public-schema table** at signup time
   (e.g. add an `email` column to `user_profiles` or to
   `workspace_connections.invitee_email`). — Works, but mutates schema
   for every feature that needs the lookup. Doesn't generalize.

## Canonical pattern: SECURITY DEFINER RPC

Define a narrow RPC in the `public` schema that:

- accepts a normalized email,
- returns ONLY the user_id (uuid) — no email echo, no PII,
- runs SECURITY DEFINER so it can read `auth.users` on behalf of the
  caller,
- is GRANTed to `authenticated` only — anonymous probing is rejected
  at the function-call level.

```sql
-- supabase/migrations/009_email_lookup_helper.sql
CREATE OR REPLACE FUNCTION public.user_id_for_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT id FROM auth.users
  WHERE email = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.user_id_for_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_id_for_email(text) TO authenticated;
```

Call from the route handler:

```ts
const { data: recipientUserId, error } = await supabase.rpc(
  "user_id_for_email",
  { p_email: email },
);
```

## Trade-offs

- **Email enumeration risk.** A caller who already knows an email
  gets back `null` or `uuid`. That's the same shape they'd get from a
  raw `select id from auth.users where email = ...` query, so no new
  side channel. Supabase Auth's existing rate limits apply. Acceptable
  for v1; revisit if account-enumeration becomes a real concern.

- **Doesn't expose email itself.** The function returns only the
  `id`. If the caller also needs to *display* the email (e.g. My
  Network's row showing the friend's email), this RPC is the wrong
  tool — see the variant below.

## Variant: when you also need the friend's email

The My Network feature (Sept 2026) ran into this. `auth.users.email`
is gated to the row owner under Supabase Auth's RLS, so a route
handler looking up a friend's profile can't read the friend's email
either. Three options if you need it:

- **Denormalize `email` onto `user_profiles`** (new column). User-managed
  contact email; can differ from sign-in email. Most general solution.
- **Add `invitee_email TEXT` to `workspace_connections`** at invite
  time. Specific to that feature. Cheap.
- **Service-role helper `getEmailForUser(userId)`** callable only from
  server context. Most flexible, but every read path needs the helper.

Pick whichever matches the data model of the feature. Do NOT route
this through a generic `user_id_for_email` variant — the privacy
shape is different (returning an email is more sensitive than
returning an id).

## Apply order note

The function depends on the `authenticated` role existing (Supabase
Auth creates it). It does not depend on any specific table from this
project — independent of 001–008 migrations. Apply after Supabase Auth
is set up, before any feature that needs the lookup.