// src/lib/email/smtp.ts
//
// Thin SMTP email client for the network-invite notification flow.
// Uses nodemailer (https://nodemailer.com/) against the project's
// existing email hosting's SMTP capability -- no third-party service
// signup required.
//
// Scope (minimal v1, per Issue #11):
//   - Plain-ish transactional email.
//   - Invitee is told a connection request is pending, with a link
//     back into the app at /network to accept/decline.
//   - No HTML polish, no react-email templates, no attachments.
//
// Why SMTP and not Resend/Postmark/SES:
//   - Aaron already pays for and controls a hosting account with
//     SMTP capability. Reusing it avoids a new account, new
//     billing relationship, and new domain-verification cycle.
//   - The sending domain is already configured and warmed on
//     that host, which improves deliverability vs. a fresh
//     provider.
//
// Failure-mode semantics (also captured in docs/operations/network-
// invite-email-setup.md and ADR 0002):
//   - The invite row is inserted BEFORE this function is called. If
//     the email send fails, the invite still exists and the recipient
//     can see it in-app. So this function is best-effort: it logs
//     and returns void. It does NOT throw, because throwing here
//     would convert a transient SMTP failure into a 500 on a
//     request that otherwise succeeded (the invite was created).
//   - We do NOT retry inline. Retries would mask transient outages
//     that the SMTP layer's own retry semantics already handle at
//     a lower level. If you find yourself wanting retry-on-failure
//     here, the right place is a background queue, not in the
//     request path.

import nodemailer from "nodemailer";

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

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  // Require all four. If any is missing, return null so the caller
  // skips the send and logs a clear message. Same best-effort
  // shape as the Resend version: missing env == skip, not fail.
  if (!host || !port || !user || !pass) {
    return null;
  }
  // secure: true means implicit TLS on port 465 (the project's
  // setup per the setup note). If the host moves to port 587 with
  // STARTTLS, the operator can set SMTP_SECURE=false to flip this.
  const secure = process.env.SMTP_SECURE !== "false";
  const parsedPort = Number.parseInt(port, 10);
  if (Number.isNaN(parsedPort)) return null;
  return { host, port: parsedPort, secure, user, pass };
}

/**
 * Sends the v1 invite-notification email. Returns void whether the
 * send succeeded or failed; logs to stderr on failure so the
 * platform's request log captures it. Caller MUST NOT treat an
 * email failure as an invite failure.
 */
export async function sendInviteEmail(args: SendInviteEmailArgs): Promise<void> {
  const config = readSmtpConfig();
  if (!config) {
    // Not throwing on purpose: see file header. If the vars are
    // unset, we want this to be visible in logs (so the deploy is
    // flagged) but not 500 the request. The invite row is already
    // created.
    console.error(
      "[email] SMTP_HOST/PORT/USER/PASSWORD not all set; skipping invite email send to",
      args.to,
    );
    return;
  }

  const text = buildTextBody(args);
  const html = buildHtmlBody(args);

  // nodemailer creates a new transporter per send. This is the
  // recommended pattern for low-volume transactional email: it
  // avoids connection-pool state leaking across sends, and the
  // connection setup cost (a single TLS handshake) is negligible
  // compared to the rest of the route's work.
  let transporter: nodemailer.Transporter;
  try {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  } catch (e) {
    // createTransport throws synchronously on misconfiguration (e.g.
    // invalid port). Same best-effort shape: log, return void.
    console.error(
      "[email] SMTP transporter creation failed",
      e instanceof Error ? e.message : String(e),
      { to: args.to },
    );
    return;
  }

  try {
    await transporter.sendMail({
      from: `${FROM_NAME} <${FROM_ADDRESS}>`,
      to: [args.to],
      subject: SUBJECT,
      text,
      html,
    });
    // Success path. We don't log success at info level (would be
    // noisy at any real volume); failures are logged at error
    // level. If you want a success audit trail, log here.
  } catch (e) {
    // Network-level or SMTP-protocol failure. The invite row is
    // still in the DB; the recipient can find it in-app.
    console.error(
      "[email] SMTP sendMail failed",
      e instanceof Error ? e.message : String(e),
      { to: args.to },
    );
  } finally {
    // Close the transporter so we don't leak the connection. Best
    // effort; if it throws, ignore -- we're already in a
    // cleanup path.
    try {
      transporter.close();
    } catch {
      // intentional: nothing useful to do here
    }
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