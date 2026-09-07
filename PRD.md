# Product Requirements Document — give-to-get.com

**Version:** 1.5
**Date:** September 6, 2026
**Status:** Active — v1 MVP + My Network (view-only sharing)
**Owner:** Aaron Wykoff / A. Wykoff Consulting

**Changelog:**
- **v1.1:** Added Trusted Contact Sharing — workspaces grant each other access to contributed contacts.
- **v1.2:** Scope reduced to capped free lookups (quota-based), bulk export always credit-gated.
- **v1.3:** Simplified further. No export at all between connections, no lookup quota. Connected partners can **view** (never download/export) each other's contributed contacts, plus see each other's own contact info. New **My Network** navbar tab.
- **v1.4:** Firmed up three items from v1.3's open questions into requirements: (1) "See Contacts" modal must paginate server-side, not render everything client-side; (2) a Settings/Profile page is now a required v1 feature, not optional; (3) **user profile data (name, phone, email) is explicitly walled off from the global `contacts` table — never merged, never searchable, never exportable via the credit-based flow.** This is a privacy requirement, not just an architecture preference.
- **v1.5 (current):** Resolved the last open question — `phone_number` in `user_profiles` confirmed optional, not required at signup. Rationale documented in Section 5.8.

---

## 1. Problem Statement

B2B sales and marketing teams pay $100–$50,000/year for contact databases (Apollo, ZoomInfo, Lusha) that are scraped, stale, and increasingly inaccurate. Meanwhile, every one of those teams already has a contact list sitting in their CRM — leads they've worked, accounts they've prospected, events they've attended — that they're not monetizing.

There is no platform that lets teams trade the data they have for the data they need.

---

## 2. Solution

**give-to-get.com** is a B2B contact database exchange. Upload your contact list, earn credits for every unique new contact you contribute to the shared pool, and spend credits to download contacts filtered by vertical, seniority, location, and company size.

The more teams contribute, the more valuable the database becomes for everyone.

**Tagline:** Give contacts. Get contacts.

---

## 3. Target Users

### Primary ICP
- **Role:** Sales Ops, RevOps, Growth, SDR Manager
- **Company:** B2B SaaS startup, Series A–C, 20–500 employees
- **Pain:** High cost of Apollo/ZoomInfo; has orphaned contact lists; needs vertical-specific data
- **Geography:** United States (primary)

### Secondary ICP
- Marketing agencies and lead gen firms with large contact archives
- Demand gen managers who need fresh data on specific verticals

### Not a Fit
- B2C companies
- Enterprises with locked-in ZoomInfo annual contracts
- Teams without any existing contact data to contribute

---

## 4. Core Credit Loop

```
User uploads CSV
  → System validates emails, rejects personal domains
  → Deduplicates against global contacts table (email = dedup key)
  → +1 credit per unique new contact inserted
  → Credits added to workspace ledger

User browses global database
  → Filters by vertical, seniority, location, company size
  → Selects contacts (email gated until export)
  → -1 credit per contact downloaded
  → Export file generated (CSV / XLSX / JSON)
```

Credits never expire. The ledger is append-only.

**My Network is entirely separate from the credit loop, and from the
global contacts pool itself (v1.4):** connected partners can view — never
export or download — each other's contributed contacts, for free.
Separately, a user's own profile info (name, phone) shown in My Network
is **never** part of the `contacts` table or the credit-based
search/export system. See Section 5.7 and Section 7 Critical Rules.

---

## 5. v1 Feature Set (MVP)

### 5.1 Authentication & Workspace
- Email + password signup
- Google SSO
- Workspace creation on first login
- 100 free credits on workspace creation
- Team member invites (admin / member roles)

### 5.2 CSV Import
- Drag-and-drop CSV upload
- Required columns: `first_name`, `last_name`, `email`
- Recommended: `company`, `title`, `location`, `vertical`
- Column validation with clear error messages
- Import review screen: new vs duplicate preview with per-row status
- Dedup via exact email match (case-insensitive, trimmed)
- Reject personal email domains (gmail, yahoo, hotmail, etc.)
- Batch insert in chunks of 500
- Credits earned = new contacts inserted (trigger-based)
- Import history with stats (rows, new, dupes, credits earned)

### 5.3 Contact Database
- Global shared contact pool (all workspaces contribute to one table)
- Contact metadata visible to all: name, title, company, vertical, location, seniority
- Email **gated** — only revealed after credit spend or own contribution
- Filter panel: vertical, seniority, location (text), company (text)
- Text search: name, company
- Multi-select with checkboxes
- Contact count display
- **My Network contacts are NOT blended into this page.** A connected partner's contacts are visible only through the dedicated My Network → "See Contacts" view (5.7), never through the general search/filter/export flow.
- **User profile data (Section 5.8) is never queryable, searchable, or exportable from this page or the underlying `contacts` table, under any circumstance.**

### 5.4 Export
- Export modal: format selector (CSV, XLSX, JSON), field picker
- Credit cost = number of contacts selected
- Balance check before export (block if insufficient)
- Credits deducted via DB trigger on export creation
- File generated in Supabase Edge Function
- Signed download URL (7-day expiry)
- Export history
- Previously exported contacts: re-download free (no credit re-charge)
- **No export path exists from My Network, and no user profile data is ever includable in an export**, regardless of field-picker configuration. These are two structurally separate data sources from `contacts`.

### 5.5 Credits
- Balance display: top bar pill + dedicated Credits page
- Transaction history: all earn (imports) and spend (exports) events
- Running balance per transaction
- Earn more panel: upload CSV, refer a friend, verify domain

### 5.6 Dashboard
- 4 stat cards: Total Contacts, Credits Balance, Imports This Month, Contacts Exported
- Recent Imports table with status and credits earned
- Contacts by Vertical bar chart
- How it works explainer card

### 5.7 My Network — View-Only Contact Sharing (New, v1.3, firmed up v1.4)

**Problem this solves:** Two networking partners who already trust each other today share spreadsheets manually over email/Slack, with no record of who has access to what. My Network gives connected partners a way to browse each other's contributed contacts directly in-app — for coordination and reference — without any credit cost, and without the platform hosting or transmitting a bulk data file.

**How it works:**

1. **Invite.** A workspace owner/admin sends a connection invite to another workspace by email address. The invite identifies a workspace, not an individual — if the recipient's workspace has multiple members, the connection applies to the whole workspace.
2. **Accept / Decline.** The invited workspace's owner/admin accepts or declines. **Requires mutual acceptance** — sending an invite alone grants nothing.
3. **My Network tab (new navbar item).** Once one or more connections are accepted, the sidebar shows a **"My Network"** entry. This page lists every accepted connection as a row with:
   - Friend's first name
   - Friend's last name
   - Friend's email address
   - Friend's phone number
   - A **"See Contacts"** button
   - *(All four fields sourced from `user_profiles`, Section 5.8 — never from the `contacts` table.)*
4. **"See Contacts" popup/modal — REQUIREMENT: server-side pagination.** Clicking it opens a modal showing every contact that friend's workspace has contributed — full detail visible (name, title, company, email, phone, LinkedIn URL). This is **read-only**: no checkboxes, no export button, no download link, no credit interaction. **The modal must fetch contacts page-by-page from the server (e.g., 25–50 rows per page, with in-modal search/filter), not load a friend's entire contact set into the browser at once.** This matters regardless of contact-count size — a friend with 5,000,000 contacts must never cause the client to attempt to render or hold that many rows in memory.
5. **Revoke.** Either party can revoke the connection at any time, unilaterally. Revocation immediately removes the row from My Network for both parties and re-gates the "See Contacts" view.

**Database changes needed:**

New table: `workspace_connections`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `requester_workspace_id` | uuid | FK → workspaces |
| `recipient_workspace_id` | uuid | FK → workspaces |
| `status` | text | `pending` \| `accepted` \| `declined` \| `revoked` |
| `requested_by` | uuid | FK → auth.users |
| `responded_by` | uuid, nullable | FK → auth.users |
| `created_at` | timestamptz | |
| `responded_at` | timestamptz, nullable | |

- Unique constraint on `(requester_workspace_id, recipient_workspace_id)` to prevent duplicate pending invites; application logic should check both directions before insert.
- No usage/quota table needed — access is on/off based on `status = 'accepted'`, unlimited while connected.
- RLS: a new, narrowly-scoped policy allowing `SELECT` on `contacts` where `contributed_by_workspace_id` matches a workspace with an `accepted` row in `workspace_connections` linking it to the viewer's workspace. **This policy must only be exercised by the dedicated My Network "See Contacts" query path.** The general Contacts search page's own query must explicitly filter to `contributed_by_workspace_id = own workspace OR unlocked-via-credit`, deliberately excluding the connections path — RLS alone cannot enforce "only visible in My Network," so this is an application-query-scoping requirement, not just a database one.
- Export/credit-charge trigger: **completely unchanged.** My Network never touches the export pipeline.

### 5.8 Settings / Profile Page (New requirement, v1.4)

**Now required, not optional** — My Network's row display (Section 5.7) depends on it existing.

- New page, accessible from the sidebar or a user-menu dropdown (standard placement — not currently in the design reference, needs a UI slot decided at build time).
- Fields: `first_name`, `last_name`, `phone_number` (**optional, by design — see rationale below**), plus a read-only display of the account email (from `auth.users` — not editable here, since email changes should go through Supabase Auth's own flow, not a raw profile edit).
- **Why phone stays optional:** the target market (sales/marketing professionals) is unusually sensitive to unsolicited outreach — they know the pattern better than most. Requiring a phone number up front risks signaling "you're about to get sold to" and creating signup friction disproportionate to its value. A connected partner's My Network row may legitimately show a blank phone number — that's expected, not a defect.
- Saves to new table `user_profiles` (Section 7).
- **This table is architecturally and permanently separate from `contacts`.** See Critical Rules (Section 7) for the explicit privacy/architecture rule this enforces.

---

## 6. v1 Non-Goals

These are explicitly out of scope for v1 (v1.4 adds My Network + Settings per Sections 5.7–5.8, everything below remains deferred):

- CRM integrations (Salesforce, HubSpot) — v2
- Chrome extension for LinkedIn importing — v2
- Contact scoring / quality signals — v2
- API access — v2
- Stripe billing / paid plans — v2 (v1 is free tier only)
- XLSX and JSON export — v1.1
- Column mapping UI (if CSV headers don't match) — v1.1
- Bulk import via API — v2
- Job change detection / data freshness — v2
- **Any export/download path from My Network** — explicitly rejected. Connected partners can view contacts in-app only; screenshotting is an accepted, unaddressed limitation, not a feature to defend against.
- **Lookup quotas / usage limits on My Network viewing** — explicitly rejected. Removed from earlier drafts once export was taken off the table entirely.
- **Merging or exposing `user_profiles` data through the global `contacts` table, search, or export, in any form** — explicitly and permanently rejected as a privacy requirement, not a feature deferral. This is not a "v2 maybe" — it should never happen.
- **Automated partner-matching algorithm** (suggesting connections based on geography, vertical overlap, etc.) — v2. My Network in v1.4 is invite-only and manual.

---

## 7. Technical Architecture

### Stack
| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS v4, React 19 |
| Auth | Supabase Auth (email + Google OAuth) |
| Database | Supabase (Postgres 15) with RLS |
| Storage | Supabase Storage (CSV uploads, export files) |
| Edge Functions | Supabase Edge Functions (Deno) |
| Hosting | Vercel |
| Font | DM Sans (Google Fonts) |

### Key Database Tables
`workspaces` · `workspace_members` · `contacts` · `imports` · `exports` · `export_contacts` · `credits_ledger` · `workspace_contact_access` · `workspace_connections` *(new, v1.3)* · `user_profiles` *(new, v1.4)*

### Critical Rules
- Credits ledger: **append-only** — never UPDATE or DELETE
- Email dedup key: `email_normalized` (LOWER + TRIM, generated column)
- Contact email: never returned in frontend queries without credit unlock, own contribution, or an accepted My Network connection viewed via the dedicated My Network UI
- RLS: enabled on all tables from day one
- **My Network connections require mutual acceptance** — a pending invite grants zero access
- **My Network never touches the credit/export system** — no export path exists from that UI, no credit charge, no changes to the existing export Edge Function or its trigger
- **My Network contacts must not leak into the general Contacts search page** — application-query-scoping responsibility, not enforced by RLS alone
- **The "See Contacts" modal must use server-side pagination** — never fetch or render a friend's full contact list client-side in one request, regardless of that friend's total contact count
- **`user_profiles` is permanently and architecturally separate from `contacts`.** No query, view, join, export, or search path may ever surface `user_profiles` data (name, phone) as if it were a contact record in the shared pool, or vice versa. RLS on `user_profiles` should restrict visibility to: the profile owner (always), and any workspace with an accepted `workspace_connections` row linking to the owner's workspace (for My Network display only). This is a standing privacy requirement — any future feature that touches either table must preserve this separation, not just the initial build.
- Workspace bootstrap on signup is owned by `trg_on_auth_user_created` — see `AGENTS.md`
- Edge Function URLs are resolved via the shared `src/lib/edge-fn-url.ts` helper — see `AGENTS.md` Production env vars section

### Design System
- Background: `#0C0C0F` · Cards: `#18181D` · Sidebar: `#111115`
- Accent: `#8B5CF6` (violet) · Accent text: `#C4B5FD`
- Font: DM Sans · Borders: `rgba(255,255,255,0.07)` ghost
- Aesthetic: Attio dark mode — flat, enterprise SaaS, no shadows

---

## 8. Development Workflow

Development is organized into specialist roles, each covering one part of
the stack: architecture, frontend, database, backend, auth, testing, and
docs. See `AGENTS.md` in the repo root for how these are structured as
skills and how work is sequenced across build phases, including the
**Deploy Discipline** checklist (a fix isn't done until it's verified in
production across Vercel, Supabase Edge Functions, and any migrations).

---

## 9. Design Reference

**Landing page design:** `index.html` — the original hi-fi mockup (60.7 KB)

**Screens implemented in design:**
- Landing page (`index.html` — 60.7 KB)
- Hero: "Give contacts. / Get contacts." + live product panel
- 3-step process, feature grid, pricing (Free/Pro/Team), competitor comparison

**Dashboard prototype:** `src/components/Dashboard.jsx`

**Screens:** Dashboard · Contacts · Import (Upload + Review) · Export Modal · Credits · **My Network (new, v1.3)** · **Settings/Profile (new, v1.4 — no existing design reference; needs UI decided at build time)**

---

## 10. Success Metrics (v1 / v1.4)

| Metric | Target |
|---|---|
| Workspaces created | 100 in first 30 days |
| Contacts in global pool | 50,000 in first 60 days |
| Import completion rate | >70% of users who upload complete the import |
| Credits earned per workspace | >200 average |
| Export conversion | >40% of users who earn credits spend them |
| Zero critical bugs | No data leaks, no credit miscounts |
| **My Network connections formed** | Track adoption — no target yet; establish baseline in first 30 days post-launch |
| **"See Contacts" opens per connection** | Signal of actual usage vs. connections formed but never used |
| **Zero instances of `user_profiles` data appearing in `contacts` search/export** | This should be a hard zero at all times — treat any occurrence as a critical bug (data-privacy incident), not a normal defect |

---

## 11. Pricing (Post-v1)

| Plan | Price | Credits |
|---|---|---|
| Free | $0 | 100 on signup, 500/month earn cap |
| Pro | $49/month | Unlimited earn, 500 bonus/month, 5 seats |
| Team | $149/month | Unlimited, 1,500 bonus/month, 15 seats, API |

v1 launches free-only. Stripe integration planned for v1.1. My Network and Settings have no pricing tier interaction — free and unlimited for all plans.

---

## 12. Open Questions

- [ ] Should contributors see which workspace contributed a contact? (privacy vs. trust)
- [ ] What is the dispute resolution path if a user claims credits weren't awarded correctly?
- [ ] Should there be a minimum contribution quality bar before credits are awarded (e.g., must have `company` field)?
- [ ] How do we handle GDPR / CCPA for EU/CA contacts in the pool?
- [ ] At what pool size does the product become self-sustaining (cold start threshold)?
- [ ] Is there a reasonable cap on the number of connections a workspace can form? Likely fine unbounded for MVP; revisit if abuse patterns emerge.
- [x] **Resolved:** `phone_number` in `user_profiles` stays **optional**, entered later via Settings, never required at signup. Rationale: the target market for give-to-get.com is sales and marketing professionals — people who understand better than most how it feels to be on the receiving end of unsolicited outreach. Forcing a phone number up front would create friction and skepticism ("am I about to get sold to?") disproportionate to its value. My Network rows may legitimately show a blank phone number for some connections — that's an acceptable, expected state, not a bug.

