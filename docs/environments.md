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

## Canonical host (www vs bare domain)

The bare domain `https://getbrava.tech` 308-redirects to
`https://www.getbrava.tech`. Two values are deliberately different:

- `NEXT_PUBLIC_APP_URL` is the **bare** domain, `https://getbrava.tech`: the
  CRM OAuth callbacks (HubSpot, Salesforce) are registered against it, and they
  must match byte for byte.
- Everything public uses **`https://www.getbrava.tech`**: links we share, the
  health check, the Paddle webhook destination and the launch-checklist URLs.

Do not "fix" one to match the other without re-registering the OAuth callbacks.

## Shared dev DB and CI

CI's `Tests` job, your local runs and the other Claude session all use the
**same single dev Supabase project**. The suite writes and deletes rows under
shared sentinel ids and some specs add and drop a column, so two overlapping
runs break each other mid-assertion.

- **CI concurrency.** The `test` job in `.github/workflows/ci.yml` sits in the
  concurrency group `security-suite` with `cancel-in-progress: false`. GitHub
  keeps one running job and **one pending** job per group: a newer pending job
  cancels the older pending one (a running job is never cancelled). So open or
  push PRs **one at a time**, and wait for the check to start before pushing
  the next, or a PR's tests can be silently cancelled. (The separate `verify`
  job, for lint/typecheck/build, uses per-ref groups and does not touch the DB.)
- **The dev-DB slot.** Before running DB-backed tests locally, the session asks
  the other one ("slot?") and waits for "free"; when finished it says "slot
  released". Only one session holds the slot at a time. This is a human
  convention, nothing enforces it.
- **Fix landed.** Run-scoped fixture ids (PR #73, merged 2026-10-11) give each
  run its own rows so runs stop colliding (see "Running tests while another run
  is going" below). The concurrency group is being removed in a follow-up PR;
  until that merges, keep opening PRs one at a time.

## Running tests

`npm test` runs the whole vitest suite, including live specs that read and
write the **shared dev DB** (see above). `.env.local` must point at **DEV**, never prod.

- **Locally, prefer spec files by path:** `npx vitest run tests/billing/paddle-signature.spec.ts`
  (or a folder). Run the full suite only when you hold the dev-DB slot.
- **Where specs live:**
  - `tests/components` (DOM specs, `*.dom.spec.tsx`, happy-dom)
  - `tests/security` (buyer boundary, RLS; live DB and a real server)
  - `tests/plans` (a mix of pure and live-DB specs)
  - `tests/billing` (Paddle events, signature, entitlement, webhook route)
  - `tests/design` (contrast, fonts)
  - other folders under `tests/` cover api, auth, backup, crm-import, email,
    hubspot, import, portal, salesforce and ssrf
  - `e2e/` is Playwright: `npx playwright test`. It is **not** run in CI.
- **Live-server gotcha.** `tests/security/support/live-server.ts` starts
  `next start` and only builds when no `.next/BUILD_ID` exists, so it **reuses
  an existing build**. After changing code, run `npm run build` first or the
  security specs test stale output.
- `npm run test:security` runs just `tests/security`; `npm run typecheck` and
  `npm run lint` are separate.

## Running tests while another run is going

Every test run mints one `TEST_RUN_ID` (in `vitest.config.ts` /
`playwright.config.ts`) and every fixture id and email carries it
(`tests/fixtures/run-id.ts`). CI, session A and session B can therefore run
against the shared dev project at the same time without touching each other's
rows. Two things to know:

- Two local runs on one machine both want port 4173 for the live server. Give
  the second one its own: `LIVE_SERVER_PORT=4174 npm run test` (Playwright reads
  the same variable). It must be a whole number from 1024 to 65535.
- A crashed run can leave rows behind. Each run starts by sweeping fixture rows
  older than six hours (`tests/fixtures/sweep-stale-fixtures.ts`). To clean one
  up sooner, re-run with the same id: `TEST_RUN_ID=<11 hex chars> npm run test`.

The `crm_arr` column that `buyer-boundary.spec.ts` adds is no longer dropped
after the run (a concurrent run's drop would break the other run mid-test).
It stays on dev as an unused nullable column.

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
- `APP_ENCRYPTION_KEY` (Sprint 10, Ticket 52; extended to Salesforce in
  Sprint 11, Ticket 55) — AES-256-GCM key that encrypts every stored CRM
  refresh token at rest (`crm_connections`, `lib/encrypt-secret.ts` via
  `lib/crm-connections/token-store.ts`) and signs each provider's own OAuth
  `state` param (`lib/hubspot/oauth-state.ts`, `lib/salesforce/oauth-state.ts`
  — independently keyed HKDF subkeys per provider and per purpose, see
  `lib/app-encryption-key.ts`). Sprint 12, Ticket 62 added a third subkey on
  the same master key: the buyer portal's access-code hash
  (`lib/portal-access-token.ts`) is now an HMAC, so **without this variable no
  buyer can be issued or verify a code at all** — it is required in every
  environment, and `tests/fixtures/env.ts` now asserts it before the live
  suites run. **Not** `openssl rand -hex 32`'s general
  shape by convention only — it's a hard requirement here:
  `lib/encrypt-secret.ts` refuses to run against anything other than exactly
  64 hex characters (32 bytes), the AES-256 key length.

  **Known limitation — no rotation path.** Rotating this value makes every
  existing `crm_connections.encrypted_refresh_token` undecryptable
  immediately; there is no dual-key/re-encrypt migration. Every tenant with
  a live HubSpot or Salesforce connection has to reconnect (Settings →
  Integrations → Disconnect, then Connect again) after a rotation.
  Acceptable for now — a rotation-safe scheme is a flagged follow-up, not
  built in T52 or T55.

HubSpot OAuth also needs `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` (from
the HubSpot app's own Auth settings, not generated) and, per environment,
that HubSpot app's redirect URI registered to exactly
`${NEXT_PUBLIC_APP_URL}/api/integrations/hubspot/oauth/callback` — dev's
origin and prod's `https://getbrava.tech` are two separate registrations on
the same HubSpot app (or two apps, if HubSpot's console requires it); a
mismatched redirect_uri makes HubSpot reject the callback outright, before
`lib/hubspot/token-exchange.ts` is ever reached.

Salesforce OAuth (Sprint 11, Ticket 55) needs `SALESFORCE_CLIENT_ID` /
`SALESFORCE_CLIENT_SECRET` (from the Salesforce External Client App's
connected-app settings, not generated) and, per environment, that app's
callback URL registered to exactly
`${NEXT_PUBLIC_APP_URL}/api/integrations/salesforce/oauth/callback` — same
byte-for-byte-match-or-reject rule as HubSpot's redirect_uri above. Prod's
registration (`https://getbrava.tech/api/integrations/salesforce/oauth/callback`)
was confirmed 2026-09-04; **the dev origin's own callback still needs
registering on the same External Client App** — flagged as a human
follow-up, not yet done as of T55.

The live External Client App (founder-configured, 2026-09-04) forces **PKCE**
on — `lib/salesforce/pkce.ts` implements this unconditionally, no env var
controls it — and grants only the `api` + `refresh_token` scopes
(`lib/salesforce/env.ts`'s `SALESFORCE_SCOPES`; refresh-token policy on that
app is "expire if unused for a long window", IP relaxation "relaxed"). The
dev org is a Developer Edition, authenticating against the standard
`https://login.salesforce.com` — optionally overridable per environment via
`SALESFORCE_LOGIN_BASE_URL` (e.g. `https://test.salesforce.com` for a
sandbox org).

Transactional email (`lib/email/send-access-code.ts`) sends through
**Resend** (T57, Sprint 11, Ticket 57 — replaces the Google Workspace SMTP
relay used through Sprint 10): `RESEND_API_KEY` (from the Resend dashboard →
API Keys, not generated) and `RESEND_FROM` (a verified sender, e.g. `"Brava
<noreply@getbrava.tech>"`). `SMTP_*` is **retired** — `send-access-code.ts` no
longer reads it; the vars can be deleted once nothing else references them.
See `docs/adr/0001-transactional-email-provider.md` for why, and the DNS
records (SPF/DKIM/DMARC) the domain needs for Resend to send as
`getbrava.tech` without landing in spam.

Never copy a dev secret into prod or vice-versa — a leaked dev secret must not
authenticate against prod.

## Applying a migration

`supabase/migrations/` holds numbered SQL files. There is no CLI link; apply by
hand in the Supabase **SQL Editor**:

1. Open the **dev** project → SQL Editor → paste files in order (`0001` → newest).
2. Verify (see below), exercise the feature locally.
3. Repeat the exact same paste, in order, on the **prod** project.

Always dev first. New files (`0008+`) get applied to both, dev leading.

### Applied: `0015_deal_limits.sql` and `0016_rate_limit_windows.sql`

Dev and prod both have migrations `0001`–`0016` applied. `0015` (Sprint 12,
Ticket 60: `workspaces.is_sample`, the `mark_plan_live()` function and its
trigger) and `0016` (Ticket 62: the shared-store rate limiter) went onto prod
on 2026-09-22/23, before PRs #62 and #61 merged. The two files are independent
of each other. Their **VERIFY FIRST** blocks and the checks under "Verifying a
project has the full schema" below still work for any future fresh project.

Lesson kept: for a **non-backwards-compatible** migration (one the old code
cannot live with, like `0015`'s trigger refusing the old go-live button), paste
it on prod **immediately before** merging the PR that needs it.

## Granting a manual entitlement by hand (invoice customers)

Enterprise and design-partner tenants are invoiced by the founder, not billed
through Paddle. They get their entitlement from
`tenant_subscriptions.manual_entitlement_tier`, which beats every Paddle status
and never shows a paywall or an active-deal limit. Nothing in the app writes
it — by design. Set it in the **SQL Editor**, on the environment the customer
actually uses:

```sql
-- 1. Find the tenant id (never guess it).
select id, company_name from tenants where company_name ilike '%acme%';

-- 2. Grant. The NOT NULLs in 0014 (tier_id, status) must be satisfied even
--    though Paddle knows nothing about this row; 'active' + the same tier id
--    keeps the billing page readable. Tier ids come from
--    lib/billing/plans.ts: 'starter' | 'pro' | 'advanced' | 'enterprise'.
insert into tenant_subscriptions (tenant_id, tier_id, status, manual_entitlement_tier, manual_entitlement_note)
values ('<tenant-uuid>', 'enterprise', 'active', 'enterprise', 'Invoiced annually — PO 1234, 2026-09-21')
on conflict (tenant_id) do update
   set manual_entitlement_tier = excluded.manual_entitlement_tier,
       manual_entitlement_note = excluded.manual_entitlement_note,
       updated_at = now();

-- 3. Confirm — and check the NAME, not just the id. If the company here
--    isn't the customer you meant to grant, you pasted the wrong uuid.
select t.company_name,
       s.tier_id,
       s.status,
       s.manual_entitlement_tier,
       s.manual_entitlement_note
  from tenant_subscriptions s
  join tenants t on t.id = s.tenant_id
 where s.tenant_id = '<tenant-uuid>';
```

To revoke, set `manual_entitlement_tier` (and the note) back to `null` — never
delete the row. Standing rule: billing rows and Paddle entities are permanent.

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

Migration `0016` (shared-store rate limiter, Sprint 12 Ticket 62) — paste in
the SQL Editor (expect **1 row**, with `rowsecurity` = `true`, then **1 row**):

```sql
select relname, relrowsecurity as rowsecurity from pg_class where relname = 'rate_limit_windows';
select proname from pg_proc where proname = 'check_rate_limit';
```

Until `0016` is applied the app still rate-limits — `lib/rate-limit-durable.ts`
falls back to the in-memory limiter and logs `[rate-limit] shared store
unavailable` on each check. Seeing that line in the host's logs after a deploy
means `0016` has not been pasted on that project yet.

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
| `SALESFORCE_CLIENT_ID` / `SALESFORCE_CLIENT_SECRET` | prod Salesforce ECA creds | dev Salesforce ECA creds |
| `SALESFORCE_LOGIN_BASE_URL` | unset (defaults to login.salesforce.com) | unset, unless dev points at a sandbox |
| `RESEND_API_KEY` | prod Resend API key | dev/test Resend API key (or unset) |
| `RESEND_FROM` | prod verified sender | dev/test verified sender (or unset) |
| `EMAIL_DAILY_LIMIT` | unset (defaults to 90, under Resend's free plan); set to the new plan's daily quota minus headroom after upgrading | unset |
| `NEXT_PUBLIC_APP_URL` | `https://getbrava.tech` (bare domain; invite links, OAuth callbacks; see "Canonical host") | unset, or the preview origin |
| `NEXT_PUBLIC_LANDING_MODE` | `waitlist` now; flip to `signup` and **redeploy** on Nov 1 | `waitlist` (or `signup` to rehearse) |
| `NEXT_PUBLIC_PADDLE_ENV` | `production` | `sandbox` |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | live client token (`live_…`) | sandbox client token (`test_…`) |
| `PADDLE_API_KEY` | live API key | sandbox API key |
| `PADDLE_WEBHOOK_SECRET` | live notification destination's secret key | sandbox destination's secret key |
| `PADDLE_PRICE_<TIER>_MONTH` / `_YEAR` | live price ids (`pri_…`); `_YEAR` for every checkout tier or none | sandbox price ids |
| ~~`SMTP_*`~~ | retired (T57) — no longer read | retired (T57) — no longer read |

**Health check (T63).** `GET https://www.getbrava.tech/api/health` answers
`{"ok":true}` (200), `{"ok":false}` (503), or `{"ok":false}` with **429** and a
`Retry-After` header when one IP exceeds 20 requests per 5 minutes
(`HEALTH_RATE_LIMIT` in `lib/health.ts`), nothing more. A monitor polling every
5 minutes (UptimeRobot, live since 2026-10-11) uses 1 of the 20. It fails when any var
in `REQUIRED_PROD_ENV` (lib/health.ts) is empty or the database can't be read,
and the server log (Vercel → Logs, search `[health]`) names the reason. The
CRM integration vars are deliberately not required.

The Preview/Development values are exactly what's in your local `.env.local`. To
split an existing "All Environments" entry: edit it down to **Production** only,
then **Add New** with the same name, the dev value, and **Preview + Development**
checked.

Env vars are read at **build time** and `NEXT_PUBLIC_*` are inlined into the
bundle, so a scope change only takes effect on the next build — redeploy prod
(the blue "Redeploy" prompt after saving is safe: it rebuilds the current `main`
with unchanged prod values, build-first-then-swap, no downtime) and confirm a
fresh **preview** now reads from the dev project.

## Paddle webhook setup

Route: `app/api/billing/paddle/webhook/route.ts`. Create one **notification
destination** per environment in the Paddle dashboard (Developer tools →
Notifications):

| Environment | Destination URL |
| --- | --- |
| Prod (live Paddle) | `https://www.getbrava.tech/api/billing/paddle/webhook` |
| Preview (sandbox Paddle) | the branch alias URL + `/api/billing/paddle/webhook?x-vercel-protection-bypass=<secret>` (the secret is the Vercel deployment-protection bypass secret; without it Vercel's login wall answers instead of the route) |

**Events** (`lib/billing/paddle-event.ts`):

- Applied to `tenant_subscriptions`: `subscription.created`, `.updated`,
  `.activated`, `.trialing`, `.past_due`, `.paused`, `.resumed`, `.canceled`.
- Recorded only (stored for support, never change entitlement, never cause a
  500): `transaction.completed`, `customer.created`, `customer.updated`.
- Any other subscribed event type is acknowledged with 200 and ignored.

**Secret.** Each destination has its own secret key (`pdl_ntfset_…`). Put it in
`PADDLE_WEBHOOK_SECRET`: Production scope gets the live destination's key,
Preview + Development the sandbox destination's. If it is unset the route
answers **401** (same as a bad signature) and only the server log says why.

**Testing.** Paddle's simulator only works if the destination's usage type is
**"platform + simulation"**. Send a simulated event and expect **200 `{"ok":true}`**.
A 401 means a wrong or missing secret (check the log for `[paddle-webhook]`).

**Never delete Paddle entities** (destinations, products, prices, customers,
subscriptions). Refund and cancel only; deactivating is the most you do to a
destination.

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

For **additive** migrations (ones old code ignores, e.g. `if not exists` /
`create or replace`, like `0001`–`0007`), **migrate prod _before_ merging the
code**:

1. Apply `NNNN_*.sql` in **dev** SQL Editor → verify → test locally.
2. Apply the same file in **prod** SQL Editor.
3. Then merge to `main` → Vercel deploys the code that uses it.

For **destructive** migrations (dropping a column/function), reverse it: deploy
code that stops using the object first, then drop it.

> Source-of-truth note: this runbook is operational/local. Product, schema, and
> RLS truth still live in Notion ("Technical Source of Truth") per CLAUDE.md.

## Backups (prod)

**Decision (2026-09-26, Ticket 63):** prod stays on Supabase **Free**, which has
no restorable platform backups. Instead, `.github/workflows/prod-backup.yml`
takes one **every Sunday at 02:17 UTC** (and on demand: GitHub → Actions →
"Prod backup" → Run workflow).

- **Recovery point: up to 7 days.** Anything written since the last Sunday
  backup is lost in a disaster. **Revisit Supabase Pro (daily backups) at the
  first paying customers.**
- **What's in it:** the `public` and `auth` schemas (all app data plus seller
  logins). `rate_limit_windows` data is left out on purpose (scratch state).
  The app stores no files in Supabase Storage.
- **Where:** each run's workflow artifact, `prod-backup-<date>-run<id>`, kept
  **90 days**. It is one gpg-encrypted file (AES256). The passphrase lives only
  in the `BACKUP_PASSPHRASE` repo secret and the founder's password manager;
  **without it no backup can be opened.**
- **Tested every time:** the same run restores the backup into a throwaway
  Postgres and fails unless every table's row count matches prod's (small
  drift allowed for writes during the dump). A failed run emails the repo
  owner. `.github/workflows/backup-selftest.yml` proves the mechanics on
  fake data whenever the backup scripts change.
- **Secrets:** `PROD_DB_URL` (prod **session pooler** connection string, since
  GitHub runners have no IPv6 for the direct one) and `BACKUP_PASSPHRASE`.
  Rotating the prod database password means updating `PROD_DB_URL` too.

**Running it.** The schedule runs on `main`; the manual "Run workflow" button
works **only on `main`** (the backup job is gated on `refs/heads/main`). The
artifact is named `prod-backup-<YYYY-MM-DD>-run<run id>`. The passphrase
(`BACKUP_PASSPHRASE`) is also kept in the founder's password manager; check you
can open that entry before you ever need it.

**What the archive holds:** `prod.dump` (pg_dump custom format, `public` +
`auth`), `prod-counts.tsv`, `taken-at.txt`, `pg-dump-version.txt`.

**Tested restore (what CI does every run, `scripts/backup/restore-verify.sh`).**
Into an empty throwaway Postgres of the same major version:
1. Decrypt with gpg and untar.
2. Create the Supabase roles (`anon`, `authenticated`, `service_role`,
   `supabase_auth_admin`, `supabase_admin`) and the `extensions` schema with
   `pgcrypto` and `uuid-ossp`, because the dump refers to them.
3. `pg_restore --no-owner --no-privileges` of the whole `prod.dump` (both
   schemas). Errors are counted, not fatal; **row counts decide**.
4. Run `scripts/backup/counts.sql` on the result and compare with
   `prod-counts.tsv` (`scripts/backup/compare-counts.mjs`).

**Real restore (disaster only; get a second pair of eyes first).** Same
decrypt step and the same count comparison as the tested path; the one
difference is that a new Supabase project already owns its `auth` schema, roles
and extensions, so step 2 is skipped and `auth` is restored as data only.
This variant (auth users into a fresh Supabase project) is **not** exercised by
CI; the throwaway-container restore above is the tested one.
1. Create a NEW Supabase project; never restore over a live one.
2. Download the newest `prod-backup-…` artifact from the latest green run.
3. On a machine with gpg and a `pg_restore` matching the dump's major version
   (`pg-dump-version.txt`): `gpg --decrypt backup.tar.gpg | tar -xf -` (asks
   for the passphrase), then restore the seller accounts as data only, then the
   app schema:
   `pg_restore --no-owner --no-privileges --data-only --schema=auth --table=users --dbname="$NEW" prod.dump`
   `pg_restore --no-owner --no-privileges --schema=public --dbname="$NEW" prod.dump`
   (`$NEW` = the new project's session pooler connection string). As in the
   tested path, a few `pg_restore` errors can be noise: judge by row counts.
4. Compare `prod-counts.tsv` against
   `psql … -At -f scripts/backup/counts.sql`, then point Vercel's env vars at
   the new project and redeploy.
