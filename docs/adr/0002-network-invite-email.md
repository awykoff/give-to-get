---
type: adr
project: give-to-get
status: accepted
owner: Aaron Wykoff
created: 2026-09-08
updated: 2026-09-08
tags: [email, smtp, nodemailer, my-network, observability]
related:
  - https://github.com/awykoff/give-to-get/issues/11
decision: Use direct SMTP via the project's existing email hosting (nodemailer transport) for the network-invite notification email. Send from the Vercel-deployed Next.js route handler (not a Supabase Edge Function). Make the email send best-effort with a contract that the invite row is the source of truth, not the email.
repo_path: docs/adr/0002-network-invite-email.md
---

# ADR 0002: Transactional email for network invites

## Context

Closing [Issue #11](https://github.com/awykoff/give-to-get/issues/11): My Network invites didn't notify the invitee by email. The invite row was created in the DB, returned 201, and that was it. A real invitee had no way to know they'd been invited unless they happened to open the app. This was a missing feature since day one — not a regression.

Issue #11 closed and a greenlight was given to ship the v1 fix on 2026-09-08. Decisions:

- **Transport: SMTP via the project's existing email hosting** (initially Resend was the plan; changed after the greenlight to SMTP because Aaron already controls an email host with SMTP capability, avoiding a new account and domain-verification cycle). See "Update 2026-09-08" below.
- Sender: `notifications@infinitekb.com` (Aaron's existing sending domain on the hosting account).
- API credentials location: Vercel env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, optionally `SMTP_SECURE`). Standing rule unchanged: agents read the env var names but never see or handle the actual values.
- Architecture: send from the Vercel-deployed Next.js route handler, NOT a Supabase Edge Function.
- Scope: minimal v1 — plain-ish notification email with a single CTA link to `/network`. No HTML polish, no react-email templates, no attachments.

## Update 2026-09-08: transport changed from Resend to SMTP

The original greenlight was to use Resend as the email provider. Before any code was shipped, Aaron decided to use his existing email hosting's SMTP capability instead, to avoid signing up for a third-party service. The code in `src/lib/email/smtp.ts` (originally `src/lib/email/resend.ts`) was rewritten to use `nodemailer` against `smtp://shared73.accountservergroup.com:465` (implicit TLS).

The decision rationale and ADR shape are unchanged — only the transport differs. The fire-and-forget pattern, the failure-mode contract, and the recipient-greeting limitation still apply exactly as documented below.

## Decision

1. **Direct SMTP via nodemailer as the email transport.** New `src/lib/email/smtp.ts` exposes one function, `sendInviteEmail({ to, inviterWorkspaceName, recipientEmailLocalPart })`, using `nodemailer.createTransport` to talk SMTP. One npm runtime dep (`nodemailer`), one dev dep (`@types/nodemailer`). The route reads `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` from the environment; the actual values never live in this repo or in any chat transcript.

2. **Send from the Vercel-deployed Next.js route, not a Supabase Edge Function.** This is the architectural decision that differs from the original three-option proposal in the conversation that produced Issue #11. Rationale:

   - The route handler already runs in Vercel and has access to the SMTP creds via Vercel env. No new infra.
   - Edge Functions would require the same creds in Supabase Edge Function secrets, which means another secret to manage and another auth flow to set up.
   - For v1 invite volume (low), the inline send is fine.

3. **Fire-and-forget the email send** (`void sendInviteEmail(...)`, not `await`). The 201 returns immediately, the email sends in the background. If the route's runtime terminates before the send completes, the email may not go out — but the invite row IS already committed (see point 4).

4. **The invite row is the source of truth, not the email.** Failure-mode contract: if the email send fails, the request still returns 201 with the created row. The invitee can find the request in `/network`. `sendInviteEmail` never throws; it logs to stderr on failure and returns void. This converts a transient SMTP outage from a 500 on a request that otherwise succeeded into a logged warning. ADR stands for the same trade-off in either call site (route handler or background worker).

5. **The inviter workspace name is fetched inside the route** via `supabase.from('workspaces').select('name').eq('id', callerWorkspaceId).single()` after the successful insert. RLS permits this (the caller is by definition a member of their own workspace). Falls back to a generic name if the lookup fails.

6. **The recipient is greeted by email local-part** (e.g. `aaron.wyk@infinitekb.com` → `Hi Aaron.wyk,`). We do NOT try to read `user_profiles.first_name` for the recipient because RLS (`user_profiles_select` from migration 007) gates reads on `auth.uid() = user_id` — the inviter's session cannot read the recipient's profile. Adding a `public.first_name_for_user(uuid)` SECURITY DEFINER RPC to mirror the `user_id_for_email` / `workspace_id_for_user` pattern is a reasonable v1.1 upgrade; for v1 minimalism, the local-part greeting is acceptable.

## Consequences

**Easier:**
- closing Issue #11 by adding a small, well-isolated module. ~210 lines of email code plus ~30 lines of integration in the route.
- No new account / billing relationship / domain-verification cycle (the project's existing email hosting already has the sending domain set up and warmed).
- No new infra (no Edge Function, no queue).
- Clear failure-mode contract that doesn't make a successful invite fail just because email is down.

**Harder:**
- The fire-and-forget pattern relies on Vercel keeping the runtime alive long enough for the send to complete. For v1 (low volume), this is reliable. Under high invite volume or sustained SMTP latency, sends may be dropped on lambda termination. When that becomes a problem, move to a background queue (Supabase Edge Function + `pg_net`, or a Vercel cron-driven retry table).
- `inviterWorkspaceName` requires an extra DB roundtrip per invite. Negligible at v1 volume but adds one more query path that needs to keep working.
- The recipient greeting is impersonal (email local-part). Acceptable for v1; revisit with the recipient-name RPC if product feedback warrants it.
- `SMTP_PASSWORD` is a long-lived credential that needs rotation. See `docs/operations/network-invite-email-setup.md` for the rotation playbook.

## Alternatives considered

- **Resend via the Resend HTTP API** (the original greenlit plan; rolled back before any code shipped). Would have required signing up for Resend, verifying `infinitekb.com` via DNS records (SPF/DKIM), and creating an API key. The SMTP-via-existing-hosting approach skipped all of that.
- **Supabase Edge Function + Resend**. Rejected for v1 because the SMTP creds would need to live in Supabase Edge Function secrets AND the architecture doubles the moving parts (Edge Function invocation + DB writes). The Vercel-inline approach is simpler for current volume.
- **Supabase Auth hook + custom template**. Rejected: tighter API surface, less control over the email body, harder to debug.
- **Vercel cron + SMTP relay**. Rejected: latency (cron interval), more moving parts, requires Vercel cron setup which the project doesn't use today.
- **`await` instead of `void`** in the route. Considered for v1, rejected because route latency would jump from ~50ms to ~500ms (typical SMTP connection + send). Acceptable trade-off if you want a synchronous guarantee; can be flipped in a one-line change.

## Out of scope

- React Email templates / HTML polish. Plain-ish body for v1.
- Reply-to handling (route doesn't accept inbound replies).
- Bounce / unsubscribe handling. The hosting provider's admin tools handle these out-of-band; no client code needed for v1.
- A recipient-name lookup RPC. v1.1 candidate.
- Background queue + retry. Whenever invite volume makes inline sends unreliable.
- Multi-tenant sender domain switching (we hardcode `notifications@infinitekb.com` per Aaron's instruction).