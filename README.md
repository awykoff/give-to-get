# give-to-get.com

B2B contact database exchange — SaaS platform. Give contacts. Get contacts.

## Setup

```bash
npm install
npm run build           # generates next-env.d.ts and .next/types/routes.d.ts
npm run dev             # http://localhost:3000
```

`next-env.d.ts` is gitignored — Next.js rewrites its import path on every
build (prod path vs dev path) and it was previously committed, requiring
`git restore` after every commit. Run `npm run build` once on a fresh
clone so TypeScript can resolve the App Router route types
(`tsconfig.json` includes both `.next/types/**/*.ts` and
`.next/dev/types/**/*.ts`, so either build mode works).

Copy `.env.local.example` (not yet committed) or set the env vars listed
in `AGENTS.md` under "Production env vars".

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint via `next lint` |
| `npm run test:e2e` | Playwright E2E suite |

## Project docs

- `AGENTS.md` — Hermes session context: design tokens, business rules,
  deploy discipline, build phase sequence. Read this first.
- `PRD.md` — product spec (v1 scope, exclusions).
- `design/design-system.md` — full token set, typography, components.
- `skills/` — Hermes skill definitions (one per role).

## Deploy

See `AGENTS.md` "Deploy discipline". Hermes cannot redeploy from this
machine — the user runs `vercel --prod` and `supabase functions deploy`
themselves. A code change is not "done" until the corresponding
production runtime is updated and verified.