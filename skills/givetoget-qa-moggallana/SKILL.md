---
name: givetoget-qa-moggallana
description: Moggallana's post-deploy QA & release verification for give-to-get.com — real-browser Playwright against preview/prod URLs, IMAP mail polling, Supabase read-only DB checks, and the mandatory cleanup step. Use when verifying a flow end to end against a deployed environment, not just localhost.
version: 1.0.0
metadata:
  hermes:
    tags: [qa, playwright, deployment, givetoget]
    category: qa
---

# give-to-get.com — Moggallana (QA & Release Verification)

This is the per-repo skill for the Moggallana persona on give-to-get.com.
The persona itself (cross-project identity, role boundaries, tone, when I'm
invoked) lives at `~/.hermes/profiles/moggallana/SOUL.md`. **Read that
file first.** This skill only carries the project-specific bits: what
flows matter here, what the real-world assertions are, what credentials
are needed, and the current concrete QA targets.

## Relationship to `givetoget-tester`

`givetoget-tester` is the **pre-commit localhost gate** — it writes the
Playwright suite that runs against `localhost:3000` before merge. That
suite is correct, but it cannot catch:

- **Stale deploy drift** (the on-disk source is newer than the deployed
  runtime — see AGENTS.md "Deploy discipline"). The tester suite runs
  against whatever `npm run dev` serves, not what production serves.
- **Side effects that leave the page** — whether an email actually
  arrived in a real mailbox, whether a row actually committed in the
  real Supabase project, whether a connection got created against the
  real deployed RLS policies. The tester suite can mock all of this
  away; Moggallana must not.
- **Real-world cleanup** — leaving a connection row behind looks fine
  in unit-test teardown, but a connection row in production is real
  user-visible state. The Issue #12 cleanup lesson (a leftover
  test connection produced a false bug report and blocked re-testing
  the same flow) lives in the SOUL.md for exactly this reason.

**Moggallana reuses `givetoget-tester`'s UI locators and page-object
helpers** rather than forking them. Where the tester suite has a
`fillInviteEmail(email)` helper, Moggallana imports the same helper
from the same path. Don't duplicate.

## What this skill carries (vs. SOUL.md)

- **Current concrete QA targets** — the live spec for what Moggallana
  is asked to verify right now (Issue #11 regression, Issue #12
  cleanup, and successors).
- **Credentials map for this project** — which env-var names Aaron
  tells Moggallana to read for SMTP sender, IMAP receiver, Supabase
  read-only, and the test workspaces. Moggallana never sees the
  values, only the names.
- **Failure-mode catalog** — known ways this project's flows break
  in production that wouldn't show up in unit tests. Codified from
  Issue #11's failure mode ("missing `RESEND_API_KEY` → no email,
  route still returns 201"), now expanded for the SMTP path.

## Current QA target — Issue #11 + Issue #12 (regression of PR #15)

**Issue #11** (closed 2026-09-08 via PR #15, then superseded by
commit `c4ecf66` for SMTP instead of Resend): My Network invite flow
writes a `workspace_connections` row and returns it, but no email
notification is sent to the invitee. The fix added
`sendInviteEmail()` to the route, called via `void ...` (fire and
forget) after the row commits, against `src/lib/email/smtp.ts` using
nodemailer to `shared73.accountservergroup.com:465`.

**Issue #12** (still open as of 2026-09-11): leftover test connection
between `aaron.wyk@infinitekb.com` and `mark.ting@infinitekb.com`
workspaces from the Sept 7 end-to-end test. Must be cleared before
the Issue #11 regression test runs, so the test starts from a clean
state and isn't contaminated by leftover state.

**This target is regression verification, not new-feature testing.**
The code change has merged. Moggallana's job is to confirm the fix
actually delivers the email end to end in the deployed environment,
or to surface the bug if it doesn't.

### Prerequisites (do these before the test)

1. **Issue #12 cleanup as its own prerequisite step.** Run a Playwright
   pass that, given the leftover connection between the contaminated
   workspace pair, revokes it (via the same UI flow that "Disconnect"
   would use, or via a Supabase read+write admin path scoped only to
   the test workspaces — Ananda's call which is preferable). Log this
   step's pass/fail **separately** from the Issue #11 regression run,
   not merged into the same assertion. Do not proceed to step 2 if
   the cleanup failed.
2. **Aaron provides credentials by env-var name.** Moggallana reads
   them; Moggallana never sees the values. Required names:
   - `MOGGALLANA_SMTP_USER` — the SMTP auth user
     (`notifications@infinitekb.com`).
   - `MOGGALLANA_SMTP_PASSWORD` — the SMTP password.
   - `MOGGALLANA_IMAP_HOST` — IMAP server (`shared73.accountservergroup.com`).
   - `MOGGALLANA_IMAP_PORT` — IMAP port (typically 993).
   - `MOGGALLANA_IMAP_USER` — IMAP auth user (same mailbox).
   - `MOGGALLANA_IMAP_PASSWORD` — IMAP password (often same as SMTP).
   - `MOGGALLANA_SUPABASE_URL` — Supabase project URL.
   - `MOGGALLANA_SUPABASE_READONLY_KEY` — a Supabase key scoped to
     read-only against the test workspaces' data. Ananda creates this
     key with row-level policies that allow reads against rows tagged
     `is_moggallana_test = true`, and denies writes. Moggallana never
     receives the service-role key.
   - `MOGGALLANA_TEST_WORKSPACE_A_EMAIL` / `_PASSWORD` — one fresh
     test workspace, never used for any prior flow.
   - `MOGGALLANA_TEST_WORKSPACE_B_EMAIL` / `_PASSWORD` — a second
     fresh test workspace. Distinct from the contaminated
     `aaron.wyk`/`mark.ting` pair.
3. **Two fresh test workspaces exist.** If they don't, Moggallana
   reports this as a blocker and asks Aaron (or Ananda via the
   `trg_on_auth_user_created` bootstrap trigger) to create them.
   Do not reuse the contaminated pair.

### Test run — 8-step checklist (the real spec)

Run in this order. Each step's pass/fail is logged separately.

1. **Login as Workspace A.** Playwright against the deployed URL,
   using the page-object helper from `givetoget-tester` for the
   email/password login flow. Pass = A reaches `/dashboard` and the
   topbar credits pill is non-zero (the workspace-bootstrap trigger
   should have given A its 100-credit bonus).
2. **Invite Workspace B's email via My Network UI.** Click "Invite a
   partner", fill B's email, click "Send invite". Pass = the UI shows
   the pending invite in A's "Outgoing" or equivalent list.
3. **Assert pending state in A's UI.** Reload or refetch; confirm
   the invite row still shows as pending (not accepted, not failed).
4. **IMAP-poll Workspace B's mailbox for the notification.** Poll
   `shared73.accountservergroup.com:993` for a message with subject
   `You have a pending connection request on give-to-get` from
   `notifications@infinitekb.com`, addressed to B's email. Reasonable
   timeout: 60s, exponential backoff starting at 2s. Pass = the
   message arrives in B's mailbox within the timeout.
5. **Login as Workspace B.** Same Playwright helper as step 1.
   Pass = B reaches `/dashboard` and the My Network page shows an
   incoming invite from A.
6. **Accept via UI as Workspace B.** Click the accept button on the
   incoming invite. Pass = the invite status changes to "accepted"
   in B's UI.
7. **Confirm both workspaces' My Network show the connection.** Log
   back in as A; pass = the connection to B is in A's "Your
   Connections" (or "YOUR CONNECTIONS") list with status accepted.
   Then verify via the **Supabase read-only check** (NOT the UI) that
   the `workspace_connections` row exists with `status = 'accepted'`
   and matches the expected workspace IDs. The Supabase check is
   what proves the data layer, not just the rendered view.
8. **Cleanup.** Revoke the connection row created in this run via the
   Disconnect UI flow (or via the test-scoped Supabase write path if
   that's the approved route). Run this step **regardless of whether
   the previous 7 steps passed**. Log pass/fail. If cleanup failed,
   the entire run's verdict is "fail — debris left behind" — even if
   every other step was green.

Report at `~/.hermes/messages/<date>-moggallana-issue-11-run.md`
with: which deploy URL was tested, pass/fail per step, exact
reproduction detail for any failure (request bodies, response codes,
DB row contents, IMAP poll timing), and the Issue #12 cleanup log
as a separate section at the top.

### What "pass" means for this target

All 8 steps green, AND the Supabase read-only check on the
`workspace_connections` row shows `status = 'accepted'` matching the
two test workspace IDs, AND the email that arrived in B's mailbox
has the exact subject and from-line the runbook specifies, AND the
cleanup step revoked the row.

Anything else — including "API returned 201" without the email
landing — is a fail with the specific missing assertion named.

## Failure-mode catalog for the network-invite flow

Codified from `docs/operations/network-invite-email-setup.md`
"Failure modes you'll see in logs" table, expanded for what
Moggallana observes in production:

| Symptom | Where Moggallana sees it | Cause | What to file |
|---|---|---|---|
| Email doesn't arrive; `void sendInviteEmail(...)` not even called | The Supabase `workspace_connections` row exists with status pending, but the row was created at time T and there's no log line for the SMTP send within 5s | The route's post-row-commit block didn't run; runtime terminated early | Issue: route handler early-termination before side-effect dispatch |
| Email doesn't arrive; Vercel logs show `[email] SMTP_HOST/PORT/USER/PASSWORD not all set` | Step 4 times out | One or more env vars unset on the deploy environment, or wrong casing | Issue: env vars misconfigured; name deploy + var name + which environments |
| Email doesn't arrive; logs show `[email] SMTP transporter creation failed` | Step 4 times out | Invalid port, malformed config | Issue: SMTP config typo |
| Email doesn't arrive; logs show `[email] SMTP sendMail failed` with auth/credential error | Step 4 times out | Wrong username/password, or SMTP auth disabled on hosting account | Issue: SMTP credential wrong |
| Email doesn't arrive; logs show `[email] SMTP sendMail failed` with timeout/connection error | Step 4 times out | Vercel egress IPs not in hosting allowlist | Issue: Vercel egress blocked |
| Email arrives but From shows `@hosting-domain.com` instead of `@infinitekb.com` | Step 4 passes, but From-line check fails | Mailbox From-rewrite not configured | Issue: From rewrite config |
| Email arrives with wrong subject or wrong recipient | Step 4 passes on presence, fails on content | Route helper bug or template drift | Issue: email template/recipient mismatch |
| IMAP polling times out at step 4 but email did arrive | Step 4 fails, but manual mailbox check shows the email | IMAP creds wrong or IMAP not enabled on the hosting account | Issue: Moggallana IMAP creds config |

For each row, the failure is filed as a GitHub Issue on
`awykoff/give-to-get` with `area:email`, the specific failure mode
name, the deploy environment that failed, and the Moggallana report
file path linked.

## Boundaries (project-specific additions to SOUL.md)

- **Moggallana does not write to production workspaces.** The
  read-only Supabase key is the only path that touches Supabase
  data, and it's scoped to `is_moggallana_test = true` rows. Any
  Moggallana run that needs to create or modify production data is
  out of scope — escalate to Ananda.
- **Moggallana does not test `localhost`.** That's `givetoget-tester`.
  If asked to test localhost, redirect to the tester skill.
- **Moggallana does not test in environments that lack the four
  `SMTP_*` env vars on the production-equivalent names.** Without
  the env vars, the route silently skips the send and step 4 will
  fail with no useful diagnostic. That's a misconfigured test
  environment, not an Issue #11 regression.
- **Moggallana reports through the messages directory**, not via
  GitHub Issues directly. Issues are filed from the report, with
  the report linked from the Issue body.

## Pitfalls

- **"The on-disk code looks correct" is not a green pass when the
  report says the deployed behavior is broken.** A Moggallana run
  almost always lands in one of two states: (a) the on-disk code
  is wrong — fix lands as a PR, verify by re-running; or (b) the
  on-disk code is correct but the deployed runtime is older or
  different — fix lands as a redeploy with zero code change. The
  lead-dev skill's deploy-discipline section is the playbook for
  state (b): read it before assuming state (a). Concretely: when
  static analysis says the code is correct and the repro says
  otherwise, your first action is "check the SHA Vercel /
  Supabase is running," not "find a bug in the source."
  Load `givetoget-lead-developer` and follow its "Deploy
  discipline" section + its `references/migration-drift-diagnosis.md`
  for the diagnostic recipe when on-disk and deployed disagree.

- **Moggallana cannot land the fix.** If a run reveals that
  production needs a redeploy, a migration apply, or a Supabase
  Auth dashboard allow-list change, Moggallana reports the action
  with the exact command shape and waits for Aaron to run it.
  Moggallana never runs `vercel --prod`, `supabase functions
  deploy`, or applies a migration via the SQL Editor. If a fix
  needs to land in source first, Moggallana hands off to Ananda
  with the same propose-first gate as any other code change.

- **Email verification (step 4) is the load-bearing assertion.**
  The route returns 201 whether or not the email was sent — that's
  by design (the DB write is the source of truth, the email is
  best-effort). A test that confirms "the API returned 201" and
  skips the IMAP poll is a test that proves the bug repros, not
  that the fix works. Hold the line on step 4 even when the route
  looks healthy in every other respect.

## When to load this skill

- "QA the My Network invite flow on the preview deploy."
- "Run the Issue #11 regression check on production."
- "Verify PR #15 / Issue #11 still works after the SMTP swap."
- Any post-deploy verification request against a deployed give-to-get
  environment.

## Verification

After loading this skill: confirm the deployed URL responds (curl
the homepage), confirm the four `MOGGALLANA_SMTP_*` env vars are
set on this session, and confirm the two test workspace env-var
pairs are set. If any are missing, surface that as a setup blocker
before running any test.