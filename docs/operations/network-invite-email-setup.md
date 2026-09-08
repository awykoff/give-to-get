# Network invite email — SMTP setup checklist

> For: Aaron (or whoever rotates onto this work later).
> Scope: what you need to do *once* to make the network-invite email flow work in production.

The code is in `src/lib/email/smtp.ts` and is wired into `src/app/api/network/invites/route.ts`. The decision rationale and failure-mode contract are in [ADR 0002](../adr/0002-network-invite-email.md). This doc is the operational checklist.

## 1. Create the mailbox in your hosting control panel

In your hosting's webmail/cPanel/etc. UI:

1. Create a new mailbox: **`notifications@infinitekb.com`**.
2. Set a strong password. (You'll paste this directly into Vercel — it never lands in the repo or in any chat transcript.)
3. Verify you can send a test message from the webmail UI to a personal address to confirm outbound SMTP works on this account.

**No DNS work needed.** The sending domain (`infinitekb.com`) is already configured and warmed on your hosting account. No SPF, DKIM, or DMARC changes are required for this — your existing DNS records cover the new mailbox.

## 2. Get SMTP connection details from the hosting account

You'll need these for Vercel:

| Field | Value (yours; example shown) |
|---|---|
| SMTP host | `shared73.accountservergroup.com` |
| SMTP port | `465` |
| Security | Implicit TLS (port 465 — `SMTP_SECURE` defaults to `true` and should be left alone) |
| Username | `notifications@infinitekb.com` (or whatever the hosting's SMTP auth user is — sometimes it's the full email, sometimes a local-part, sometimes a separate SMTP user) |
| Password | The password you set in step 1 |

**If your hosting supports both 465 (implicit TLS) and 587 (STARTTLS):** the code defaults to `secure: true` (port 465). To use 587 instead, set `SMTP_SECURE=false` in Vercel — the code will fall through to STARTTLS-style connection. Don't set `SMTP_SECURE=false` unless you actually want STARTTLS; the default is correct for 465.

## 3. Set the Vercel env vars

In Vercel → give-to-get project → Settings → Environment Variables:

| Name | Value | Environments |
|---|---|---|
| `SMTP_HOST` | `shared73.accountservergroup.com` | Production, Preview |
| `SMTP_PORT` | `465` | Production, Preview |
| `SMTP_USER` | `notifications@infinitekb.com` (or your host's SMTP auth user) | Production, Preview |
| `SMTP_PASSWORD` | (the password from step 1) | Production, Preview |
| `SMTP_SECURE` | (omit; default is `true`) | — |

Don't add these to Development — local dev can run without SMTP (the route logs and skips the send if any of the vars is unset).

⚠️ **The password is now in Vercel.** Vercel masks env var values in UI and logs, but anyone with production-env write access to the project can read it. Treat as you would a database password.

## 4. Verify end-to-end

Once the code is deployed and the four SMTP env vars are set in Vercel Production:

1. Sign in as a real user in workspace A.
2. Go to My Network, invite a real user in workspace B.
3. Confirm workspace B's user receives the email within ~30 seconds.
4. Confirm the email subject is `You have a pending connection request on give-to-get` and the From line is `give-to-get <notifications@infinitekb.com>`.
5. Click the link in the email — confirm it lands on `/network` with the invite visible.

If the email doesn't arrive, the most common causes (in order of likelihood) are:

- Auth credentials wrong (username format, password)
- Firewall / IP allowlist — Vercel egress IPs need to be allowed by your host
- TLS mismatch (port 465 with `secure: true` is what the code defaults to; if you set `SMTP_SECURE=false` accidentally, you get STARTTLS, which the host may not accept on 465)
- Mailbox quota or send-rate limit on the hosting account

## Failure modes you'll see in logs

| Symptom | Cause | Fix |
|---|---|---|
| Email not arriving; Vercel logs show `[email] SMTP_HOST/PORT/USER/PASSWORD not all set` | One or more env vars unset, or the wrong env var name (must match exactly: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, all uppercase, all four required) | Re-set the missing var(s) for the right environment; redeploy if necessary. |
| Email not arriving; Vercel logs show `[email] SMTP transporter creation failed` | Invalid port number, malformed config. The error message will include the specific issue. | Fix the config; redeploy. |
| Email not arriving; Vercel logs show `[email] SMTP sendMail failed` with auth/credential error in the message | Wrong username/password, or the hosting account has SMTP auth disabled | Verify credentials in the hosting UI; confirm SMTP auth is enabled on the account. |
| Email not arriving; Vercel logs show `[email] SMTP sendMail failed` with timeout or connection error | Egress from Vercel not allowed by the host's firewall. Some hosts block SMTP from non-listed IPs. | Add Vercel's egress IP ranges to the host's allowlist. Vercel publishes these ranges in their docs. |
| Email not arriving; no log line at all | `void sendInviteEmail(...)` was lost to a runtime termination before the SMTP connection completed | Verify the invite was created (it should be); if consistently missing across many invites, the Vercel runtime may be terminating faster than expected. Move to a background queue. |
| Email arrives but From address shows `@something.hosting-domain.com` instead of `@infinitekb.com` | Mailbox's "From" rewrite not configured on the host | Most hosts let you set the From header freely via SMTP; if yours rewrites it, configure the alias from `notifications@infinitekb.com` on the mailbox. |

## What Aaron does NOT need to touch

- The code. Aaron shouldn't need to read or modify `src/lib/email/smtp.ts` or `src/app/api/network/invites/route.ts` to make this work.
- DNS records. The sending domain is already configured on the host; nothing to add at the registrar.
- Database / Supabase. The email flow is Vercel-side; no SQL, no Supabase config.

## Rotation

Every 6 months (or on suspicion of compromise):

1. Change the password on `notifications@infinitekb.com` in the hosting control panel.
2. Update the `SMTP_PASSWORD` value in Vercel.
3. Redeploy.
4. The other three vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`) shouldn't need to change. If your hosting ever moves SMTP to a different host or port, update those at the same time.

The variable names stay the same; Vercel will inject the new values on the next deploy. No code change needed.