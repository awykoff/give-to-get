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

## Verification

Visually diff against `Dashboard.jsx` and the landing page mockup
(`index.html`); confirm no light backgrounds or non-`#8B5CF6` accents via a
quick grep for hex codes outside the `C{}` object.
