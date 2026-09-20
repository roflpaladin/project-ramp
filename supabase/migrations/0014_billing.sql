-- Sprint 12, Ticket 59 (slice 1): Paddle fulfillment — what a tenant is
-- paying for, which webhook events we have already processed, and the
-- server-issued references that bind a checkout to a tenant.
--
-- Applied by pasting into the Supabase SQL Editor per this project's
-- migration workflow (no CLI link/psql available) — same as every migration
-- before it. Idempotent throughout (`if not exists` / `drop policy if
-- exists` before `create policy`) so a re-paste is safe.
--
-- BILLING UNIT IS THE TENANT (founder ruling, 2026-09-20): one subscription
-- per seller org, hence `tenant_id` unique on tenant_subscriptions. Tiers
-- are flat with an active-deal cap each (Free 1 / Starter 3 / Pro 8 /
-- Advanced unlimited / Enterprise unlimited, invoiced outside Paddle) —
-- those caps live in lib/billing/plans.ts, NOT in this schema: a price
-- change must never need a migration. This table stores only which tier id
-- Paddle says the tenant is on.
--
-- RLS SHAPE, per table:
--   * tenant_subscriptions — RLS on, exactly ONE policy: a seller may SELECT
--     their own tenant's row (same `auth.jwt() -> 'app_metadata' ->>
--     'tenant_id'` claim read as 0001's "AE reads own tenant"). No insert/
--     update/delete policy at all: only the webhook writes here, through the
--     service-role client (lib/supabase/admin.ts), which bypasses RLS.
--     A seller must be able to see their own plan; a seller must never be
--     able to grant themselves one.
--   * paddle_webhook_events / billing_checkout_refs — RLS on, ZERO policies
--     (default-deny for anon/authenticated), the same shape 0002's
--     portal_access_tokens, 0008's waitlist_signups and 0010's
--     crm_connections already use. Neither table has any client-side reader.

begin;

-- 1. What the tenant is paying for -----------------------------------------

create table if not exists tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- Unique: one subscription per tenant (see header). on delete cascade so
  -- deleting a tenant cannot leave an orphaned entitlement behind.
  tenant_id uuid not null unique references tenants (id) on delete cascade,
  paddle_customer_id text,
  -- Unique and nullable: the webhook resolves later events for a known
  -- subscription through this column, and a tenant granted a manual
  -- entitlement (below) may have no Paddle subscription at all.
  paddle_subscription_id text unique,
  -- A tier id from lib/billing/plans.ts's TIER_DEFINITIONS ("starter",
  -- "pro", "advanced", "enterprise"). Deliberately NOT a check constraint or
  -- enum: the tier list is product config that changes without a migration,
  -- and lib/billing/entitlement.ts already refuses to grant anything for an
  -- id it does not recognise.
  tier_id text not null,
  billing_cycle text check (billing_cycle in ('month', 'year')),
  -- Paddle's own subscription statuses, verbatim — no local vocabulary to
  -- translate (and mistranslate) between.
  status text not null check (status in ('active', 'trialing', 'past_due', 'paused', 'canceled')),
  current_period_ends_at timestamptz,
  -- Paddle's scheduled_change object as sent ({action, effective_at}). A
  -- SCHEDULED cancellation is not a cancellation: status stays 'active' and
  -- the tenant keeps access until the period actually ends.
  scheduled_change jsonb,
  -- Anchor for the 7-day grace after a failed payment (founder ruling):
  -- stamped when the subscription FIRST goes past due, cleared when it
  -- recovers. Not derivable from `status` alone, which is why it is a column.
  past_due_since timestamptz,
  -- The out-of-order guard. Webhooks arrive out of order and get retried;
  -- an event whose occurred_at is not strictly newer than this is ignored
  -- (lib/billing/subscription-reducer.ts), so a late "upgrade" can never
  -- undo the renewal that followed it.
  last_event_occurred_at timestamptz,
  -- Manual entitlement override for invoice-paying customers (Enterprise,
  -- design partners): set by hand, never written by a webhook, and it beats
  -- every Paddle status — those customers never see a paywall.
  manual_entitlement_tier text,
  manual_entitlement_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenant_subscriptions_paddle_subscription
  on tenant_subscriptions (paddle_subscription_id);

alter table tenant_subscriptions enable row level security;

-- Read-only, own-tenant-only, for the seller's own UI. Mirrors 0001's "AE
-- reads own tenant" claim read exactly.
drop policy if exists "AE reads own tenant subscription" on tenant_subscriptions;
create policy "AE reads own tenant subscription"
  on tenant_subscriptions for select
  using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- 2. Webhook idempotency ---------------------------------------------------

create table if not exists paddle_webhook_events (
  -- Paddle's own event id AS THE PRIMARY KEY: that is the whole idempotency
  -- mechanism. The route inserts here BEFORE computing anything, so a
  -- redelivery (normal Paddle behaviour) hits a unique violation and is
  -- acknowledged as a no-op rather than applied twice.
  event_id text primary key,
  event_type text not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  processing_outcome text not null default 'received'
    check (processing_outcome in ('received', 'applied', 'duplicate', 'stale', 'ignored', 'failed')),
  -- Why an event was ignored ("unknown_price_id", "unresolved_tenant", ...).
  -- For support and debugging; never shown to a user.
  processing_reason text,
  -- The verified payload, kept for reconciliation and dispute evidence.
  -- Service-role only — this is also why webhook logging (see the route)
  -- carries event ids and outcomes, never the payload itself.
  payload jsonb not null
);

create index if not exists idx_paddle_webhook_events_received_at
  on paddle_webhook_events (received_at desc);

alter table paddle_webhook_events enable row level security;

-- Deliberately NO policies — default-deny for anon/authenticated, exactly
-- like portal_access_tokens (0002) and crm_connections (0010).

-- 3. Server-issued checkout references -------------------------------------

create table if not exists billing_checkout_refs (
  -- An opaque 32-byte base64url nonce generated server-side
  -- (lib/billing/subscription-repository.ts), never anything derived from
  -- the tenant. This is the ONLY thing the browser learns about a checkout:
  -- the page no longer sends a tenant id in Paddle customData, because a
  -- signed-in user could tamper with one and have a payment credit another
  -- tenant.
  id text primary key,
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Short-lived: it only has to survive one checkout. Every later event for
  -- the same subscription resolves through paddle_subscription_id instead.
  expires_at timestamptz not null,
  -- Record of first use, not a one-shot lock: Paddle can send several events
  -- for one checkout, and each must still resolve to the same tenant.
  consumed_at timestamptz
);

create index if not exists idx_billing_checkout_refs_tenant
  on billing_checkout_refs (tenant_id);
create index if not exists idx_billing_checkout_refs_expires_at
  on billing_checkout_refs (expires_at);

alter table billing_checkout_refs enable row level security;

-- Deliberately NO policies — same default-deny shape as above. Issued and
-- read only through the service-role client.

commit;

-- Down / rollback (manual -- uncomment and run only to reverse this migration):
--   begin;
--     drop table if exists billing_checkout_refs;
--     drop table if exists paddle_webhook_events;
--     drop table if exists tenant_subscriptions;
--   commit;
