# Ramp

Internal codename for **Brava** (https://www.getbrava.tech): a shared workspace
where a seller and a buyer commit to a mutual success plan and act on it
together. Two people, one plan, one next move. Code, repo and internal docs say
"Ramp"; "Brava" appears only on user-facing surfaces.

## Stack

- Next.js 15 (App Router) with React 19 and TypeScript, Tailwind CSS 4
- Supabase (Postgres, Auth, RLS); two projects, dev and prod
- Paddle for billing, Resend for transactional email
- Vercel for hosting; GitHub Actions for CI and the weekly prod backup
- Vitest and Playwright for tests

## Prerequisites

- Node 22 or newer (`engines` in `package.json`), npm 11
- A Supabase **dev** project (never point local work at prod)

## Setup

```bash
git clone <repo-url> && cd <repo-folder>
npm install
cp .env.example .env.local   # fill in the DEV project's values
npm run dev                  # http://localhost:3000
```

`.env.local` is read by the dev server and by the tests, so it must point at
the **dev** Supabase project. Details: [docs/environments.md](docs/environments.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run lint` | `next lint` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Full vitest suite (hits the shared dev DB) |
| `npm run test:security` | Only `tests/security` |
| `npm run test:watch` / `test:coverage` | Vitest watch / coverage |
| `npm run seed:demo` | Seed demo data into the DB `.env.local` points at |
| `npm run check:contrast` | Colour contrast check |
| `npx playwright test` | End-to-end tests (not run in CI) |

## Docs

- [docs/environments.md](docs/environments.md): dev/prod split, env vars,
  migrations, tests, Paddle webhook, backups
- [docs/launch-checklist.md](docs/launch-checklist.md): the Nov 1 launch plan
- [docs/adr/](docs/adr/): architecture decision records

## Source of truth

Product requirements, design system and the technical spec (schema, RLS) live
in Notion, not in this repo. Files under `docs/` are dated snapshots or
operational runbooks; if one disagrees with Notion, Notion wins.
