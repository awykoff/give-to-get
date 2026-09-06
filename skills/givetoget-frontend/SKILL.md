---
name: givetoget-frontend
description: React/Tailwind components for give-to-get.com's dark theme design system
version: 1.0.0
metadata:
  hermes:
    tags: [react, tailwind, design-system, givetoget]
    category: frontend
---

# give-to-get.com — Frontend

## When to Use

Building or editing any React component, page, or piece of UI.

## Procedure

1. Read `design/design-system.md` for the full color object `C{}`,
   typography scale, and layout tokens before writing markup.
2. Read `src/components/Dashboard.jsx` as the reference implementation —
   match its patterns rather than inventing new ones.
3. Start every new component from the `C{}` color object; never hardcode a
   hex value that isn't in it.
4. Import DM Sans from Google Fonts; never fall back to a system sans
   silently — the fallback stack is `-apple-system, BlinkMacSystemFont, sans-serif`.
5. Use Tailwind v4 utility classes plus the token values for anything
   Tailwind's default palette doesn't cover (it won't — this palette is
   custom).

## Component Reference

- `Sidebar.tsx` — 224px wide, `#111115`, active item = `rgba(139,92,246,0.12)` bg + `#C4B5FD` text + 3px purple left border
- `TopBar.tsx` — 52px, credits pill (`rgba(139,92,246,0.12)` bg, `#C4B5FD` text)
- Cards — `#18181D` bg, `1px solid rgba(255,255,255,0.07)` border, 10px radius, **no drop shadow**
- Tables — 40px row height, `rgba(139,92,246,0.04)` hover tint
- Buttons — primary `#8B5CF6` bg / white text / 7px radius; ghost = transparent + ghost border

## Pitfalls

- Never use `<form>` — use `onClick`/`onChange` handlers directly (React
  Artifact convention carries over to this codebase too).
- Never introduce a second accent color "just for this one badge" — reuse
  the semantic colors (`success`, `danger`, `warn`) already in `C{}`.
- Don't add `box-shadow` to cards even subtly — flat surfaces only.
- **UI components referencing schema columns that drifted between
  migrations.** `001_initial_schema.sql` and `002_apollo_aligned_schema.sql`
  use different column names for the same concept (`company_size` TEXT
  CHECK vs `num_employees` INTEGER, plus `total_rows` vs
  `original_row_count`, etc.). 002 is canonical but client UI was often
  built before the rename and never updated. The breakage pattern: a
  page renders fine until it issues a Supabase query
  (`.select("..., company_size")` or `.eq("company_size", value)`),
  then 400s with `Could not find the 'company_size' column of 'contacts'
  in the schema cache`. When you find a query referencing a column
  that doesn't exist in `002`, don't just rename the symbol — check
  whether the data type and meaning also changed. `company_size` was a
  TEXT enum bucket (`"51-200"`); `num_employees` is an INTEGER
  (`125`). Renaming the select/filter is necessary but not sufficient —
  any UI that consumed the old bucket strings (dropdown options, table
  cell rendering) needs a UX rewrite, not just a string replace. Before
  touching any component, grep the codebase for both the old and new
  column names together to catch all the references. See
  `givetoget-database` for the canonical list of renamed fields, and
  `givetoget-backend` for the parallel trap on the Edge Function side
  plus the broader deploy-discipline lesson
  (`references/stale-deploy-diagnostic.md`) — production can be
  running a build that's months behind this branch, so a column fix
  shipped to disk may still 400 in production.

## Verification

Visually diff against `Dashboard.jsx` and the landing page mockup
(`index.html`); confirm no light backgrounds or non-`#8B5CF6` accents via a
quick grep for hex codes outside the `C{}` object.
