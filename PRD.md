# Product Requirements Document — give-to-get.com

**Version:** 1.0  
**Date:** April 26, 2026  
**Status:** Active — v1 MVP  
**Owner:** Aaron Wykoff / A. Wykoff Consulting  

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

### 5.4 Export
- Export modal: format selector (CSV, XLSX, JSON), field picker
- Credit cost = number of contacts selected
- Balance check before export (block if insufficient)
- Credits deducted via DB trigger on export creation
- File generated in Supabase Edge Function
- Signed download URL (7-day expiry)
- Export history
- Previously exported contacts: re-download free (no credit re-charge)

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

---

## 6. v1 Non-Goals

These are explicitly out of scope for v1:

- CRM integrations (Salesforce, HubSpot) — v2
- Chrome extension for LinkedIn importing — v2
- Contact scoring / quality signals — v2
- API access — v2
- Stripe billing / paid plans — v2 (v1 is free tier only)
- XLSX and JSON export — v1.1
- Column mapping UI (if CSV headers don't match) — v1.1
- Bulk import via API — v2
- Job change detection / data freshness — v2

---

## 7. Technical Architecture

### Stack
| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS v4 |
| Auth | Supabase Auth (email + Google OAuth) |
| Database | Supabase (Postgres 15) with RLS |
| Storage | Supabase Storage (CSV uploads, export files) |
| Edge Functions | Supabase Edge Functions (Deno) |
| Hosting | Vercel |
| Font | DM Sans (Google Fonts) |

### Key Database Tables
`workspaces` · `workspace_members` · `contacts` · `imports` · `exports` · `export_contacts` · `credits_ledger` · `workspace_contact_access`

### Critical Rules
- Credits ledger: **append-only** — never UPDATE or DELETE
- Email dedup key: `email_normalized` (LOWER + TRIM, generated column)
- Contact email: never returned in frontend queries without credit unlock
- RLS: enabled on all tables from day one

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
skills and how work is sequenced across build phases.

---

## 9. Design Reference

**Landing page design:** `index.html` — the original hi-fi mockup (60.7 KB)

**Screens implemented in design:**
- Landing page (`index.html` — 60.7 KB)
- Hero: "Give contacts. / Get contacts." + live product panel
- 3-step process, feature grid, pricing (Free/Pro/Team), competitor comparison

**Dashboard prototype:** `src/components/Dashboard.jsx`

**Screens:** Dashboard · Contacts · Import (Upload + Review) · Export Modal · Credits

---

## 10. Success Metrics (v1)

| Metric | v1 Target |
|---|---|
| Workspaces created | 100 in first 30 days |
| Contacts in global pool | 50,000 in first 60 days |
| Import completion rate | >70% of users who upload complete the import |
| Credits earned per workspace | >200 average |
| Export conversion | >40% of users who earn credits spend them |
| Zero critical bugs | No data leaks, no credit miscounts |

---

## 11. Pricing (Post-v1)

| Plan | Price | Credits |
|---|---|---|
| Free | $0 | 100 on signup, 500/month earn cap |
| Pro | $49/month | Unlimited earn, 500 bonus/month, 5 seats |
| Team | $149/month | Unlimited, 1,500 bonus/month, 15 seats, API |

v1 launches free-only. Stripe integration planned for v1.1.

---

## 12. Open Questions

- [ ] Should contributors see which workspace contributed a contact? (privacy vs. trust)
- [ ] What is the dispute resolution path if a user claims credits weren't awarded correctly?
- [ ] Should there be a minimum contribution quality bar before credits are awarded (e.g., must have `company` field)?
- [ ] How do we handle GDPR / CCPA for EU/CA contacts in the pool?
- [ ] At what pool size does the product become self-sustaining (cold start threshold)?
