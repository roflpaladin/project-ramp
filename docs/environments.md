# Environments — dev & prod

Ramp runs **two separate Supabase projects**. There is no single shared
database and no "environment toggle" inside one project — that Supabase feature
(Branching) needs a Pro plan + GitHub + the Supabase CLI, none of which we use.
Two projects fits our paste-into-SQL-Editor migration workflow with zero extra
tooling.

| | **Dev** | **Prod** |
| --- | --- | --- |
| Used by | Local `next dev`, vitest live tests, Playwright E2E | The deployed app only |
| Config source | `.env.local` on your machine (git-ignored) | Host env vars (e.g. Vercel → Production scope) |
| Data | Throwaway / seed data | Real tenant data |
| Migrations | Apply here **first**, verify, then prod | Apply after dev is verified |

## Why the split matters

The live tests (`tests/security/**`, `e2e/**`) don't mock Supabase — they run
real DDL (`test_add_crm_arr` / `test_drop_crm_arr`) and seed real workspaces.
Both `playwright.config.ts` and `vitest.config.ts` load `.env.local` via
`process.loadEnvFile()`, so **whatever project `.env.local` points at is the
project the tests read _and write_.** Keep `.env.local` on **dev** so a test run
can never touch prod. No source file hardcodes a Supabase URL — everything flows
through env, so repointing `.env.local` is the entire switch.

## Secrets: one value per environment

`NEXT_PUBLIC_SUPABASE_*` and `SUPABASE_SERVICE_ROLE_KEY` come from each Supabase
project's **Settings → API**. The signing/shared secrets are **not** issued by
anyone — you generate them, fresh per environment:

```bash
openssl rand -hex 32   # run once each for dev, once each for prod
```

- `PORTAL_SESSION_SECRET` — signs the buyer portal-access cookie.
- `CRM_WEBHOOK_SECRET` — the value CRM webhooks must send in the
  `X-Ramp-Webhook-Secret` header. `lib/crm/ingest.ts` fails **closed**: if it's
  unset, every CRM webhook is rejected 401. The same value must be configured on
  whatever sends the webhook (HubSpot/Salesforce relay).
- `APP_ENCRYPTION_KEY` (Sprint 10, Ticket 52) — AES-256-GCM key that
  encrypts the stored HubSpot refresh token at rest (`crm_connections`,
  `lib/encrypt-secret.ts`) and signs the OAuth `state` param
  (`lib/hubspot/oauth-state.ts`). **Not** `openssl rand -hex 32`'s general
  shape by convention only — it's a hard requirement here:
  `lib/encrypt-secret.ts` refuses to run against anything other than exactly
  64 hex characters (32 bytes), the AES-256 key length.

  **Known limitation — no rotation path.** Rotating this value makes every
  existing `crm_connections.encrypted_refresh_token` undecryptable
  immediately; there is no dual-key/re-encrypt migration. Every tenant with
  a live HubSpot connection has to reconnect (Settings → Integrations →
  Disconnect, then Connect again) after a rotation. Acceptable for now — a
  rotation-safe scheme is a flagged follow-up, not built in T52.

HubSpot OAuth also needs `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` (from
the HubSpot app's own Auth settings, not generated) and, per environment,
that HubSpot app's redirect URI registered to exactly
`${NEXT_PUBLIC_APP_URL}/api/integrations/hubspot/oauth/callback` — dev's
origin and prod's `https://getbrava.tech` are two separate registrations on
the same HubSpot app (or two apps, if HubSpot's console requires it); a
mismatched redirect_uri makes HubSpot reject the callback outright, before
`lib/hubspot/token-exchange.ts` is ever reached.

Never copy a dev secret into prod or vice-versa — a leaked dev secret must not
authenticate against prod.

## Applying a migration

`supabase/migrations/` holds numbered SQL files. There is no CLI link; apply by
hand in the Supabase **SQL Editor**:

1. Open the **dev** project → SQL Editor → paste files in order (`0001` → newest).
2. Verify (see below), exercise the feature locally.
3. Repeat the exact same paste, in order, on the **prod** project.

Always dev first. New files (`0008+`) get applied to both, dev leading.

## Verifying a project has the full schema

Tables and columns are visible over the REST API; **functions are not**.

Reachability + tables + columns (reads `.env.local`, prints only HTTP status):

```bash
set -a && . ./.env.local && set +a
for t in tenants workspaces links success_plans plan_stages plan_steps; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/$t?select=*&limit=1" \
    -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY")
  echo "$code  $t"
done
# 0004's columns on workspaces:
curl -s -o /dev/null -w "%{http_code}  workspaces(crm cols)\n" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/workspaces?select=crm_source,crm_object_id,trigger_stage&limit=1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

All `200` = schema present. A `400` on the column probe = migration `0004`
didn't run.

Functions from `0006`/`0007` — paste in the SQL Editor (expect **5 rows**):

```sql
select proname from pg_proc
where proname in ('reorder_plan_stages','reorder_plan_steps',
                  'reject_demo_tenant_hijack','test_add_crm_arr','test_drop_crm_arr');
```

## Setting up prod on the host

Move the prod Supabase keys into the host's env-var UI (e.g. Vercel → Settings →
Environment Variables). Generate **separate** `PORTAL_SESSION_SECRET` and
`CRM_WEBHOOK_SECRET` there. Prod values never live in any file in this repo.

### Scope each var per environment (Vercel)

Vercel env vars are scoped **Production / Preview / Development**. A single
variable name can hold different values per scope — but only as separate
entries. **Do not leave the Supabase vars on "All Environments"**: that makes
every PR **preview** deployment read and WRITE the prod project (real tenant
data), which defeats the whole split.

| Variable | Production scope | Preview + Development scope |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | prod project URL | **dev** project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod anon key | **dev** anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | prod service_role | **dev** service_role |
| `PORTAL_SESSION_SECRET` | prod secret | dev secret |
| `CRM_WEBHOOK_SECRET` | prod secret | dev secret |
| `APP_ENCRYPTION_KEY` | prod key | dev key |
| `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` | prod HubSpot app creds | dev HubSpot app creds |
| `SMTP_*` | real relay | test inbox (e.g. Mailtrap) or unset |

The Preview/Development values are exactly what's in your local `.env.local`. To
split an existing "All Environments" entry: edit it down to **Production** only,
then **Add New** with the same name, the dev value, and **Preview + Development**
checked.

Env vars are read at **build time** and `NEXT_PUBLIC_*` are inlined into the
bundle, so a scope change only takes effect on the next build — redeploy prod
(the blue "Redeploy" prompt after saving is safe: it rebuilds the current `main`
with unchanged prod values, build-first-then-swap, no downtime) and confirm a
fresh **preview** now reads from the dev project.

## Deploying to prod

Two independent pipelines. Only the code one is automatic.

**Code → Vercel (git-driven).** The GitHub repo is connected via Vercel's
integration (no `vercel.json`; config lives in the Vercel dashboard).
- Merge to **`main`** → **Production** deployment (Production-scoped env = prod).
- Push any other branch / open a PR → **Preview** deployment (Preview-scoped env
  = dev, once scoped per above).
- So shipping code to prod = **PR → merge into `main`**; Vercel builds and
  promotes automatically. `.github/workflows/ci.yml` gates the merge with tests;
  it does not deploy.

**Database → manual (SQL Editor).** Deploying code does **nothing** to the prod
DB. New migrations are still pasted by hand. Ordering is what bites: a deployed
app that queries a column/function not yet in prod errors for real users.

For **additive** migrations (all of `0001`–`0007` — `if not exists` /
`create or replace`), **migrate prod _before_ merging the code**:

1. Apply `NNNN_*.sql` in **dev** SQL Editor → verify → test locally.
2. Apply the same file in **prod** SQL Editor.
3. Then merge to `main` → Vercel deploys the code that uses it.

For **destructive** migrations (dropping a column/function), reverse it: deploy
code that stops using the object first, then drop it.

> Source-of-truth note: this runbook is operational/local. Product, schema, and
> RLS truth still live in Notion ("Technical Source of Truth") per CLAUDE.md.
