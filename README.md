# Project Ramp

A multi-tenant SaaS for B2B sellers (Account Executives) to spin up a branded,
access-gated "deal room" portal per prospect, aggregate deal resources into
it, and track buyer engagement with those resources.

Two surfaces: a seller-facing **Admin** app (`/admin`) where AEs build and
manage workspaces, and a buyer-facing **Portal** (`/portal/[id]`) where the
prospect verifies their email and views the curated resources.

## Tech stack

- [Next.js 15](https://nextjs.org/) (App Router) + React 19 + TypeScript
- [Supabase](https://supabase.com/) — Postgres, Auth (AE login), Row-Level Security for tenant isolation
- [nodemailer](https://nodemailer.com/) against a configurable SMTP relay (buyer access-code emails)
- No ORM, no client-side state library — server actions and route handlers talk to Supabase directly

## Project structure

```
app/
  admin/                  AE-facing app, behind Supabase Auth (see middleware.ts)
    workspaces/new/       Create a workspace
    workspaces/[id]/      Manage a workspace's links (with paste-a-URL metadata autofill)
  portal/[id]/            Buyer-facing deal room: email gate -> 4-digit code -> curated links
  api/
    auth/send-token/      POST — issue + email a buyer's access code
    track/                GET  — masked click redirector + click/view analytics logging
    scrape-meta/          POST — OpenGraph/HTML metadata scraper (SSRF-guarded)
lib/
  supabase/               Client constructors: browser, server (RLS-scoped), admin (service-role)
  portal-session.ts       Signed httpOnly cookie proving a buyer passed the email gate
  portal-access.ts        Buyer email whitelist/domain-match logic
  portal-access-token.ts  4-digit access token issuance, shared by the gate form and the API route
  email/                  Access-code email sending
  branding.ts, domain.ts  Target-domain normalization + favicon lookup for portal branding
  meta-scrape.ts          Dependency-free OpenGraph/HTML tag parser
  ssrf-guard.ts           Blocks private/loopback/link-local/metadata addresses before any server-side fetch
supabase/migrations/      Numbered SQL files, applied manually via the Supabase SQL Editor
```

## Data model

- `tenants` — one row per paying customer org.
- `workspaces` — one deal room per prospect, scoped to a tenant (`tenant_id` is the RLS anchor) with a buyer email whitelist (`approved_emails`).
- `links` — the curated resources inside a workspace.
- `portal_access_tokens` — hashed, short-lived 4-digit codes for the buyer email gate. RLS-enabled with zero policies (service-role only).
- `workspace_analytics` — `portal_view` / `link_click` events, tenant-isolated via RLS, written only by the service-role client.

AEs authenticate via Supabase Auth; their `tenant_id` is set as an
`app_metadata` claim at provisioning time (no self-serve signup yet). Buyers
never get a Supabase Auth session — they authenticate via the magic-code
flow above, and portal/API routes read through the service-role client
after verifying that token/session.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in real values, see below
npm run dev
```

### Environment variables (`.env.local`)

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API |
| `PORTAL_SESSION_SECRET` | Any long random string, e.g. `openssl rand -hex 32` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Supabase project → Settings → Auth → SMTP Settings, or any SMTP provider |

### Database migrations

There's no Supabase CLI project link checked in — migrations under
`supabase/migrations/` are applied by pasting each numbered file into the
Supabase Dashboard's **SQL Editor**, in order.

## Conventions

- One branch per roadmap ticket (`ticket-N/kebab-case-title`), merged to `main` with `Merge ticket-N: Title`.
- Full ticket specs, acceptance criteria, and engineering logs live in Notion (Project Ramp → Roadmap).
