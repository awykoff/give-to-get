# Network invite email — Resend setup checklist

> For: Aaron (or whoever rotates onto this work later).
> Scope: what you need to do *once* to make the network-invite email flow work in production.

The code is in `src/lib/email/resend.ts` and is wired into `src/app/api/network/invites/route.ts`. The decision rationale and failure-mode contract are in [ADR 0002](../adr/0002-network-invite-email.md). This doc is the operational checklist.

## 1. Create the Resend account

Sign up at <https://resend.com>. The free tier is 100 emails/day and 3,000/month — covers give-to-get.com MVP volume.

## 2. Add and verify the `infinitekb.com` domain

In Resend's dashboard:

1. **Domains → Add Domain → `infinitekb.com`.**
2. Resend will give you DNS records to add at your registrar. They look like:

   ```
   TXT  @  "v=spf1 include:_spf.resend.com ~all"
   CNAME resend._domainkey  <value>.resend.com
   ```

   (Exact record names + values are shown in Resend's UI. Add them at your DNS registrar — that's outside Resend and outside the give-to-get repo.)

3. Wait for Resend to verify the records (a few minutes typically; can take up to an hour for propagation). Status flips from "Pending" to "Verified" in the dashboard.

## 3. Create an API key

In Resend's dashboard:

1. **API Keys → Create API Key.**
2. Name it something you'll recognize later (e.g. `give-to-get-prod`).
3. **Permission:** "Sending access" (the default; don't grant "Full access" — this key only sends emails).
4. Copy the key value (shown once, format `re_*****`).

⚠️ **The key is shown once.** If you lose it, revoke and create a new one.

## 4. Set the Vercel env var

In Vercel → give-to-get project → Settings → Environment Variables:

| Name | Value | Environments |
|---|---|---|
| `RESEND_API_KEY` | (the `re_*****` value from step 3) | Production, Preview |

Don't add it to Development — local dev can run without Resend (the route logs and skips the send if the var is unset).

⚠️ **The key is now in Vercel.** Vercel masks env var values in UI and logs, but anyone with production-env write access to the project can read it. Treat as you would a database password.

## 5. (Optional) Send a test from Resend's UI

Resend's "Audiences" / "Send test email" feature lets you send a one-off `From: notifications@infinitekb.com` to verify the domain is really sending. Worth doing once after DNS propagates to confirm the setup before relying on it for real invites.

## 6. Verify end-to-end

Once the code is deployed and `RESEND_API_KEY` is set in Vercel Production:

1. Sign in as a real user in workspace A.
2. Go to My Network, invite a real user in workspace B.
3. Confirm workspace B's user receives the email within ~30 seconds.
4. Confirm the email subject is `You have a pending connection request on give-to-get` and the From line is `give-to-get <notifications@infinitekb.com>`.
5. Click the link in the email — confirm it lands on `/network` with the invite visible.

## Failure modes you'll see in logs

| Symptom | Cause | Fix |
|---|---|---|
| Email not arriving; Vercel logs show `[email] RESEND_API_KEY is not set` | Env var not set in the right Vercel environment, or deploy hasn't picked up the new env | Re-set `RESEND_API_KEY` for the right environment; redeploy if necessary. |
| Email not arriving; Vercel logs show `[email] Resend send failed status: 401` | Invalid API key, or revoked | Create a new key in Resend, update Vercel, redeploy. |
| Email not arriving; Vercel logs show `[email] Resend send failed status: 403` | API key lacks sending permission, OR sender domain not verified | Check Resend → API Keys (permissions) and Domains (verification status). |
| Email not arriving; no log line at all | `RESEND_API_KEY` is set but `void sendInviteEmail(...)` was lost to a runtime termination | Verify the invite was created (it should be); if consistently missing across many invites, the Vercel runtime may be terminating faster than expected. Move to a background queue. |
| Email arrives but From address shows `@resend.dev` instead of `@infinitekb.com` | Domain not verified, OR the from address in code is overridden somewhere | Confirm `infinitekb.com` shows "Verified" in Resend → Domains. The code hardcodes `notifications@infinitekb.com` (in `src/lib/email/resend.ts:14`). |

## What Aaron does NOT need to touch

- The code. Aaron shouldn't need to read or modify `src/lib/email/resend.ts` or `src/app/api/network/invites/route.ts` to make this work.
- DNS records for the `give-to-get.com` domain. We're sending from `infinitekb.com` per Aaron's decision; `give-to-get.com` DNS is unchanged.
- Database / Supabase. The email flow is Vercel-side; no SQL, no Supabase config.

## Rotation

Every 6 months (or on suspicion of compromise):

1. Create a new API key in Resend.
2. Update the `RESEND_API_KEY` value in Vercel.
3. Redeploy.
4. Revoke the old key in Resend.

The variable name stays the same; Vercel will inject the new value on the next deploy. No code change needed.