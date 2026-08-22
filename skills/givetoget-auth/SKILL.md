---
name: givetoget-auth
description: Supabase Auth, Google OAuth, and workspace bootstrap for give-to-get.com
version: 1.0.0
metadata:
  hermes:
    tags: [supabase-auth, oauth, givetoget]
    category: auth
---

# give-to-get.com — Auth

## When to Use

Building login/signup pages, the OAuth callback, session middleware, or the
first-login workspace-creation flow.

## Procedure

1. Build/edit:
   - `app/(auth)/login/page.tsx` — email + Google SSO, dark theme
   - `app/(auth)/signup/page.tsx` — email signup, dark theme
   - `app/(auth)/callback/route.ts` — OAuth callback handler
   - `middleware.ts` — session refresh, route protection
   - `app/(dashboard)/layout.tsx` — auth guard, sidebar/topbar wrapper
2. On first login: create a `workspaces` row for the user, add them as
   `admin` in `workspace_members`, and insert a 100-credit bonus row into
   `credits_ledger` (via trigger/RPC, not a raw insert from the client).

## Rules

- Dark theme applies to auth pages too — `#0C0C0F` bg, `#8B5CF6` primary
  button, same as everywhere else.
- Google OAuth is the primary CTA; email/password is secondary.
- Unauthenticated users hitting any `(dashboard)` route redirect to
  `/login`.

## Pitfalls

- Skipping the workspace-bootstrap step on OAuth signups because "Google
  users go through a different code path" — both paths must create the
  workspace + bonus credit.
- Doing session checks in individual pages instead of centrally in
  `middleware.ts` / the dashboard layout guard.

## Verification

New user via email and new user via Google OAuth both land in the
dashboard with a workspace created and 100 credits visible in the credits
pill.
