---
name: givetoget-tester
description: Unit, RLS, and Playwright E2E test coverage for give-to-get.com
version: 1.0.0
metadata:
  hermes:
    tags: [testing, playwright, rls, givetoget]
    category: qa
---

# give-to-get.com — Tester

## When to Use

After any feature lands, before marking a phase done — write or extend
coverage rather than only manually clicking through.

## Procedure

1. Unit tests → `__tests__/` (utility functions, e.g. `normalizeSeniority`,
   email normalization).
2. RLS policy tests → `__tests__/rls/` — assert cross-workspace reads fail.
3. Import/credit tests → `__tests__/import/`, `__tests__/credits/`.
4. E2E → `e2e/` using Playwright (`playwright.config.ts` already configured
   in the repo) for critical user flows: signup → import → browse → export.

## Critical Test Cases

- Import rejects personal email domains.
- Import dedups on case-insensitive exact email match.
- Credit earn count equals **new** contacts inserted, not total CSV rows.
- Export credit deduction equals contacts actually selected.
- `credits_ledger` rejects `UPDATE` and `DELETE` statements.
- Workspace A cannot read workspace B's `imports`/`exports`/contacts.
- Export is blocked when the workspace has insufficient credit balance.

## Pitfalls

- Testing the dedup count against total CSV rows instead of unique new
  contacts — this is the single most common off-by-N bug in this codebase.
- Writing RLS tests as the service-role client, which bypasses RLS entirely
  and gives a false pass.
- **Boundary with the Moggallana QA role (`givetoget-qa-moggallana`,
  when created).** `givetoget-tester` runs Playwright against **localhost
  dev** as a pre-commit gate — the same `e2e/` directory, the same
  flows (signup → import → browse → export), but aimed at the developer's
  local server with whatever test data the developer has seeded. The
  Moggallana role runs Playwright against a **deployed URL** (Vercel
  preview for a PR, or production for a release-verification pass) and
  asserts real-world side effects beyond the page itself: real IMAP
  mailbox delivery, real Supabase row state, mandatory cleanup of any
  state the test created. If a test needs IMAP polling or a deployed
  URL, it does NOT belong in `givetoget-tester` — defer it to the
  Moggallana skill or a future `givetoget-qa-moggallana` placeholder
  in this same `givetoget-*` family.

## Verification

`npm run test` and `npx playwright test` both pass locally before a phase
is marked complete in `AGENTS.md`/README.
