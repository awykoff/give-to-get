// src/lib/email/resend.ts
//
// Thin Resend HTTP client. One function for v1: sendInviteEmail.
//
// Scope (minimal v1, per Issue #11):
//   - Plain-ish transactional email.
//   - Invitee is told a connection request is pending, with a link
//     back into the app at /network to accept/decline.
//   - No HTML polish, no react-email templates, no attachments.
//
// Why no SDK:
//   - Resend's HTTP API is small enough (POST /v1/emails) that the
//     native fetch in the Vercel runtime is sufficient.
//   - One fewer npm dependency to vet and version-pin.
//
// Failure-mode semantics (also captured in docs/operations/network-
// invite-email-setup.md and ADR 0002):
//   - The invite row is inserted BEFORE this function is called. If
//     the email send fails, the invite still exists and the recipient
//     can see it in-app. So this function is best-effort: it logs
//     and returns void. It does NOT throw, because throwing here
//     would convert a transient email failure into a 500 on a
//     request that otherwise succeeded (the invite was created).
//   - We do NOT retry inline. Retries would mask transient Resend
//     outages that Resend's own infrastructure already retries at
//     the API layer. If you find yourself wanting retry-on-failure
//     here, the right place is a background queue, not in the
//     request path.
//
// Why not an Edge Function:
//   - Per the chosen architecture for Issue #11 (Claude cloud,
//     2026-09-08): the email send lives in the Vercel-deployed
//     Next.js route, not a Supabase Edge Function. No new infra.
//   - Trade-off: every cold start of this route costs a tiny amount
//     of latency from the email send. For v1 (low invite volume)
//     this is fine. If invite volume grows, move to a background
//     queue / Edge Function. See ADR 0002.

const FROM_ADDRESS = "notifications@infinitekb.com";
const FROM_NAME = "give-to-get";
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://give-to-get.com";

const SUBJECT = "You have a pending connection request on give-to-get";

interface SendInviteEmailArgs {
  /** Recipient email address. Already normalized (trim+lowercase) by the caller. */
  to: string;
  /** The inviter's workspace name, e.g. "Acme Sales Ops". Falls back to "A give-to-get workspace" if missing. */
  inviterWorkspaceName: string;
  /** The recipient's email local-part for a friendly greeting, e.g. "aaron" from "aaron.wyk@infinitekb.com". The recipient may or may not have a user_profiles row (per the 007 migration's "no backfill" caveat); we don't try to read their first name because RLS gates user_profiles_select on auth.uid() = user_id. */
  recipientEmailLocalPart: string;
}

interface ResendSuccess {
  id: string;
}
interface ResendError {
  name?: string;
  message?: string;
  statusCode?: number;
}

/**
 * Sends the v1 invite-notification email. Returns void whether the
 * send succeeded or failed; logs to stderr on failure so the
 * platform's request log captures it. Caller MUST NOT treat an
 * email failure as an invite failure.
 */
export async function sendInviteEmail(args: SendInviteEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Not throwing on purpose: see file header. If the var is unset,
    // we want this to be visible in logs (so the deploy is flagged)
    // but not 500 the request. The invite row is already created.
    console.error(
      "[email] RESEND_API_KEY is not set; skipping invite email send to",
      args.to,
    );
    return;
  }

  const body = {
    from: `${FROM_NAME} <${FROM_ADDRESS}>`,
    to: [args.to],
    subject: SUBJECT,
    text: buildTextBody(args),
    html: buildHtmlBody(args),
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Capture status + a short error summary without echoing the
      // body (which may contain the email content).
      let parsed: ResendError | null = null;
      try {
        parsed = (await res.json()) as ResendError;
      } catch {
        // ignore JSON parse failure -- we still log the status
      }
      console.error(
        "[email] Resend send failed",
        JSON.stringify({
          to: args.to,
          status: res.status,
          resendError: parsed,
        }),
      );
      return;
    }

    // Success path. We don't log success at info level (would be
    // noisy at invite volume); failures are logged at error level
    // above. If you want a success audit trail, log here.
    const success = (await res.json()) as ResendSuccess;
    return;
  } catch (e) {
    // Network-level failure (DNS, TLS, connection reset). The invite
    // row is still in the DB; the recipient can find it in-app.
    console.error(
      "[email] Resend request threw",
      e instanceof Error ? e.message : String(e),
      { to: args.to },
    );
    return;
  }
}

function buildTextBody(args: SendInviteEmailArgs): string {
  const greet = friendlyGreeting(args.recipientEmailLocalPart);
  const inviter = args.inviterWorkspaceName || "A give-to-get workspace";
  return [
    `Hi ${greet},`,
    "",
    `${inviter} has invited your workspace to connect on give-to-get.`,
    "",
    `Open ${APP_BASE_URL}/network to accept or decline.`,
    "",
    "If you don't recognize the request, you can ignore this email -- the",
    "invite will not auto-create a connection.",
    "",
    "--",
    "give-to-get",
  ].join("\n");
}

function buildHtmlBody(args: SendInviteEmailArgs): string {
  const greet = escapeHtml(friendlyGreeting(args.recipientEmailLocalPart));
  const inviter = escapeHtml(args.inviterWorkspaceName || "A give-to-get workspace");
  const url = escapeHtml(`${APP_BASE_URL}/network`);
  return [
    `<p>Hi ${greet},</p>`,
    `<p><strong>${inviter}</strong> has invited your workspace to connect on <strong>give-to-get</strong>.</p>`,
    `<p><a href="${url}">Open give-to-get to accept or decline</a></p>`,
    `<p>If you don't recognize the request, you can ignore this email; the invite will not auto-create a connection.</p>`,
    `<hr><p style="color:#8B87A8;font-size:12px">give-to-get</p>`,
  ].join("\n");
}

function friendlyGreeting(localPart: string): string {
  // Take the local-part of the email and capitalize the first
  // character. Example: "aaron.wyk" -> "Aaron.wyk". Better than
  // generic "Hi there" but doesn't try to guess a real first name.
  if (!localPart) return "there";
  return localPart[0].toUpperCase() + localPart.slice(1);
}

function escapeHtml(s: string): string {
  // Minimal HTML escape for the body. We control the inputs (no
  // user-supplied content from the route reaches the email body
  // without going through this), but escape anyway -- defensive
  // habit for anything that ends up in HTML.
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}