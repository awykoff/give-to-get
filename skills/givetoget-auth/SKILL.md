---
name: givetoget-auth
description: Supabase Auth, Google OAuth, workspace bootstrap, and PKCE callback for give-to-get.com
version: 1.1.0
metadata:
  hermes:
    tags: [supabase-auth, oauth, pkce, givetoget]
    category: auth
---

# give-to-get.com — Auth

## When to Use

Building login/signup pages, the PKCE code-exchange callback, session
middleware/proxy, or the first-login workspace-creation flow. Also load
when debugging any auth-related issue where a user can authenticate but
then can't use the app (workspace not provisioned, code not exchanged,
session not refreshing).

## Procedure

1. Build/edit the right files for the task:
   - `src/app/(auth)/login/page.tsx` — email + Google SSO, dark theme
   - `src/app/(auth)/signup/page.tsx` — email signup, dark theme
   - `src/app/auth/callback/route.ts` — PKCE code-exchange callback
     (handles both email confirmation and Google OAuth redirects)
   - `src/proxy.ts` — session refresh, route protection (Next 16 renamed
     middleware.ts → proxy.ts; the rename is a project convention, see
     header comment in proxy.ts)
   - `src/app/(dashboard)/layout.tsx` — auth guard, sidebar/topbar wrapper
2. Workspace bootstrap on first signup is **a DB trigger**, not app
   code. See `references/workspace-bootstrap.sql` for the canonical
   shape (helper function + auth.users trigger + idempotency guard +
   backfill DO block). Lives in `supabase/migrations/00X_signup_bootstrap.sql`.
3. After changing any auth route, update the Supabase Auth dashboard's
   Redirect URLs allow-list to match. Adding a new callback path
   without adding it there will silently break sign-in.

## Rules

- Dark theme applies to auth pages too — `#0C0C0F` bg, `#8B5CF6` primary
  button, same as everywhere else.
- Google OAuth is the primary CTA; email/password is secondary.
- Unauthenticated users hitting any `(dashboard)` route redirect to
  `/login`.
- Every Supabase Auth redirect (email confirmation, OAuth, magic link)
  MUST point at the PKCE callback route, never the final destination.
  Final destination is where the callback redirects *to* after exchange.
- Workspace bootstrap is owned by `private.provision_workspace_for_user`.
  Application code must never INSERT into `workspaces`,
  `workspace_members`, or write a `'bonus'` row to `credits_ledger`
  directly. The trigger is the only legitimate path.

## PKCE callback pattern

`/auth/callback` (or any equivalent) is mandatory for any Supabase +
Next.js project using `@supabase/ssr`. The bug shape if you skip it:
`signUp({ emailRedirectTo: '${origin}/dashboard' })` ships the PKCE
code straight to the destination, the destination has no
`exchangeCodeForSession` call, the code is dropped, the user lands
unauthenticated. The proxy/middleware's `getUser()` returns null, the
dashboard guard bounces them to /login.

Minimum callback shape (mirrors `src/app/auth/callback/route.ts`):

```ts
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
```

`signInWithOAuth` uses the same callback — set `redirectTo` (not
`emailRedirectTo`) to the callback URL. Both flows funnel through one
route, one exchange call, one redirect.

## Workspace bootstrap — where it lives and why

A migration (`supabase/migrations/006_signup_bootstrap.sql`) installs:

- `private.provision_workspace_for_user(user_id, email)` — single
  source of truth. Idempotent (skips if `workspace_members` already
  has a row for the user), `SECURITY DEFINER`, `SET search_path = ''`,
  fully-qualified `public.*` references. Creates the `workspaces` row,
  the admin `workspace_members` row, and the 100-credit bonus row.
- `private.handle_new_user()` — thin trigger function calling the
  provisioner.
- `trg_on_auth_user_created` — AFTER INSERT on `auth.users`, calling
  the trigger function.
- A `DO $$ ... $$` backfill block that walks existing `auth.users`
  rows without a workspace_members entry and runs the provisioner
  for each. This is what self-heals accounts created between the bug
  appearing and the migration being applied.

Why a DB trigger rather than app-side:

- Covers both signup paths (email confirmation AND Google OAuth) —
  both end in an `auth.users` INSERT, the trigger fires for both.
- Cannot be bypassed by a forgotten callback, a different SDK path,
  or a future client calling `supabase.auth.signUp()` directly.
- Atomic with the auth insert — if provisioning fails, the signup
  fails; no half-state where a user authenticates but has no workspace.
- Matches the existing `private` schema pattern from
  `004_private_schema_security.sql`.
- Honors all the AGENTS.md rules: `credits_ledger` stays append-only
  (the trigger INSERTs, never UPDATEs); RLS stays on for everything
  else (SECURITY DEFINER + BYPASSRLS bypasses it for the trigger
  body, but ordinary authenticated queries still hit the policies).

See `references/workspace-bootstrap.sql` for the full canonical
migration — copy and rename to the next available migration number.

## Pitfalls

- **Pointing `emailRedirectTo` (or `signInWithOAuth`'s `redirectTo`)
  at `/dashboard` directly.** No code exchange happens at the
  destination, the user lands unauthenticated. Always point at the
  callback route.
- **Skipping the workspace-bootstrap step on OAuth signups because
  "Google users go through a different code path".** Both paths must
  create the workspace + bonus credit. The DB trigger covers both
  automatically — but only if the migration has actually been applied.
  Grep `supabase/migrations/` for `handle_new_user` to confirm before
  declaring Phase 1 done.
- **Adding a new auth route without updating the Supabase Auth
  dashboard's Redirect URLs allow-list.** The dashboard rejects
  unknown redirect URLs server-side; users get bounced back to
  `/login` with no visible error. Whenever a callback path changes,
  the dashboard list must change too.
- **Doing session checks in individual pages instead of centrally in
  `proxy.ts` / the dashboard layout guard.** Auth checks belong in
  one place; per-page checks drift and miss new routes.
- **Calling the workspace-bootstrap from a client component because
  "the server route is too much hassle".** RLS forbids it (no
  workspace INSERT policy). The trigger exists precisely so this
  doesn't need to live in client code.
- **Marking Phase 1 shipped in AGENTS.md while the bootstrap is a
  commented-out template in 001.** AGENTS.md is the single source of
  truth for what's deployed — verify the migration actually ran
  (check `SELECT tgname FROM pg_trigger WHERE tgrelid =
  'auth.users'::regclass;` returns `trg_on_auth_user_created`) before
  moving on.

## Verification

New user via email and new user via Google OAuth both land in the
dashboard with a workspace created and 100 credits visible in the
credits pill. To verify the bootstrap end-to-end without trusting the
trigger, in Supabase Table Editor after signup check that the new
auth.users row has exactly one matching row in `workspaces`, one
matching row in `workspace_members` (role=admin), and one matching
row in `credits_ledger` (type=bonus, amount=100, balance_after=100).

If a user authenticates but the import flow says "No workspace found
for this user", the bootstrap is not running for that user — either
the trigger doesn't exist, or the user was created before the trigger
was installed and the backfill block wasn't re-applied.
