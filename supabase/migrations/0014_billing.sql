-- Sprint 12, Ticket 59 (slice 1): Paddle fulfillment — what a tenant is
-- paying for, which webhook events we have already processed, and the
-- server-issued references that bind a checkout to a tenant.
--
-- Applied by pasting into the Supabase SQL Editor per this project's
-- migration workflow (no CLI link/psql available) — same as every migration
-- before it. Idempotent throughout (`create … if not exists`, `add column
-- if not exists`, and `drop … if exists` ahead of every policy, index and
-- function this file owns), so it converges both on a fresh database AND on
-- one that already ran an earlier draft of this same file.
--
-- BILLING UNIT IS THE TENANT (founder ruling, 2026-09-20): one subscription
-- per seller org, hence `tenant_id` unique on tenant_subscriptions. Tiers
-- are flat with an active-deal cap each (Free 1 / Starter 3 / Pro 8 /
-- Advanced unlimited / Enterprise unlimited, invoiced outside Paddle) —
-- those caps live in lib/billing/plans.ts, NOT in this schema: a price
-- change must never need a migration. This table stores only which tier id
-- Paddle says the tenant is on.
--
-- RLS SHAPE: all three tables are RLS on with ZERO policies — default-deny
-- for anon/authenticated, the same shape 0002's portal_access_tokens,
-- 0008's waitlist_signups and 0010's crm_connections already use. Nothing
-- client-side reads any of them: every read goes through server code on the
-- service-role client (lib/supabase/admin.ts), which bypasses RLS.
--   * tenant_subscriptions deliberately has NO seller-SELECT policy (review
--     ruling, 2026-09-20). An earlier draft had one; it was dropped because
--     nothing needs it yet and a row-level grant would expose every column
--     (paddle ids, manual entitlement notes) to the browser. When the seller
--     UI does need to show a plan, expose a COLUMN-LIMITED VIEW (tier,
--     status, current_period_ends_at) with its own tenant-scoped policy —
--     not a select policy on this table.
--
-- DELETE BEHAVIOUR: tenant_id carries `on delete cascade` on
-- tenant_subscriptions and billing_checkout_refs. Trade-off, accepted
-- deliberately: deleting a tenant must not leave an orphaned entitlement or
-- a live checkout reference pointing at nothing, and PADDLE — not this
-- table — is the system of record for what was actually billed, so nothing
-- financial is lost. paddle_webhook_events has NO tenant foreign key at all
-- and therefore retains the full event history regardless of what happens
-- to a tenant row. (Standing founder rule: we never delete or "tidy up"
-- Paddle entities or billing rows ourselves.)
--
-- KNOWN FOLLOW-UPS (not built in this slice, deliberately — each is its own
-- ticket, none is a blocker for fulfillment):
--   * PII retention: paddle_webhook_events.payload keeps the verified event
--     body indefinitely. It can contain customer identifiers. A retention
--     window (and a redaction or archival policy for anything past it) is
--     needed before this table grows real volume.
--   * Pruning: expired/consumed billing_checkout_refs rows are never
--     removed. A scheduled job should delete rows past expires_at; the
--     index on expires_at below exists so that stays cheap.
--   * Rate limiting: the webhook route has NO rate limit at all (an
--     unauthenticated POST whose signature check is cheap but not free),
--     and the checkout-ref action uses the in-memory, per-instance limiter
--     (lib/rate-limit.ts). A DB- or Redis-backed limiter covering both is
--     Ticket 62.
--   * Alerting: nothing watches this data yet. Two signals matter — events
--     landing on a non-`applied` outcome (especially `ignored` with
--     reason `duplicate_subscription` or `unknown_price_id`), and events
--     stuck at `received`/`failed` past Paddle's retry window, which means
--     a customer may have paid without being provisioned. Ticket 63
--     (monitoring).
--   * Body cap: the route bounds the webhook body at 64 KB via
--     Content-Length plus the bytes actually read. It does not STREAM the
--     read, so a request with no Content-Length is bounded only by the
--     host's own request limit (~4.5 MB on Vercel today) before our check
--     runs. A streamed, incremental cap is the complete fix.

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

-- No explicit index on paddle_subscription_id: the `unique` constraint on
-- the column above already creates one, and a second would just be write
-- amplification. Dropped explicitly so a re-paste over an earlier draft of
-- this file (which did create one) converges on the same schema.
drop index if exists idx_tenant_subscriptions_paddle_subscription;

alter table tenant_subscriptions enable row level security;

-- Deliberately NO policies — see the RLS note in this file's header for why
-- the seller-SELECT policy was dropped and what replaces it later. Idempotent
-- cleanup in case an earlier draft of this migration was ever pasted.
drop policy if exists "AE reads own tenant subscription" on tenant_subscriptions;

-- 2. Webhook idempotency ---------------------------------------------------

create table if not exists paddle_webhook_events (
  -- Paddle's own event id AS THE PRIMARY KEY: that is the idempotency
  -- mechanism. The route inserts here BEFORE computing anything, so a
  -- redelivery (normal Paddle behaviour) hits a unique violation — and the
  -- route then READS processing_outcome back to decide what that means. A
  -- terminal outcome ('applied'/'stale'/'ignored'/'duplicate') is a true
  -- duplicate and becomes a no-op; 'received' or 'failed' means the first
  -- attempt never finished, and the retry is REPROCESSED. Assuming every
  -- redelivery is a duplicate would turn any crash mid-processing into a
  -- permanent "customer paid, tenant never provisioned".
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
  consumed_at timestamptz,
  -- The subscription this reference resolved for the FIRST time. Set on
  -- first use; from then on the reference only resolves for that same
  -- subscription (lib/billing/subscription-repository.ts). Without it, a
  -- replayed reference could attach a SECOND subscription to the tenant
  -- that issued the first one. Nullable: null means "not used yet".
  paddle_subscription_id text
);

-- Additive for a re-paste over an earlier draft of this file (the column was
-- introduced after the first version was written; 0014 has not been applied
-- anywhere, but a partially-applied paste must still converge).
alter table billing_checkout_refs
  add column if not exists paddle_subscription_id text;

create index if not exists idx_billing_checkout_refs_tenant
  on billing_checkout_refs (tenant_id);
create index if not exists idx_billing_checkout_refs_expires_at
  on billing_checkout_refs (expires_at);

alter table billing_checkout_refs enable row level security;

-- Deliberately NO policies — same default-deny shape as above. Issued and
-- read only through the service-role client.

-- 4. The ordering guard, enforced by the database --------------------------
--
-- Two webhook deliveries for one subscription can be in flight at the same
-- time (Paddle retries, and events arrive out of order). If each process
-- reads the row, decides in application code that its event is newer, and
-- then writes, the LAST writer wins — which is exactly how an older event
-- overwrites a newer one and silently downgrades a paying tenant.
--
-- The same is true of "does this tenant already have a different live
-- subscription?": the application asks it before writing, but two FIRST
-- events (subscription S1 and S2 for one tenant) can both read "no row yet"
-- and both pass that check — after which the later occurred_at would win
-- and flip the tenant onto the subscription Paddle is NOT billing.
--
-- So this function re-asks BOTH questions inside the single statement that
-- writes. The loser of a race is rejected by the database itself rather
-- than by a check it already passed. It returns which verdict was reached:
--   'written'               the row now reflects this event
--   'stale'                 the stored event is newer; nothing written
--   'subscription_conflict' a different, non-canceled subscription owns
--                           this tenant's row; nothing written
-- The webhook records the last two as `stale` and `ignored` respectively —
-- never as `applied`.
--
-- STRICTLY older is rejected (`<=` in the WHERE means "write when the
-- incoming event is at least as new"): Paddle emits several events with an
-- identical occurred_at (subscription.created and subscription.activated
-- for one checkout), and dropping the second would lose the activation.
-- True duplicates are caught by paddle_webhook_events.event_id, not here.
--
-- `security invoker` (NOT definer): this function must carry no privilege of
-- its own. Only the service-role client calls it, and it is the service
-- role's own rights that let it write — so a future caller who is not
-- service-role gains nothing by finding this function.
--
-- Dropped first, not `create or replace`d: an earlier draft of this file
-- returned boolean, and Postgres refuses to replace a function whose return
-- type changes. `drop … if exists` is a no-op on a fresh database and makes
-- a re-paste over that draft converge. The argument list (which is what
-- identifies the function) is unchanged.
drop function if exists apply_tenant_subscription_event(
  uuid, text, text, text, text, text, timestamptz, jsonb, timestamptz, timestamptz, text, text
);

create function apply_tenant_subscription_event(
  p_tenant_id uuid,
  p_paddle_customer_id text,
  p_paddle_subscription_id text,
  p_tier_id text,
  p_billing_cycle text,
  p_status text,
  p_current_period_ends_at timestamptz,
  p_scheduled_change jsonb,
  p_past_due_since timestamptz,
  p_last_event_occurred_at timestamptz,
  p_manual_entitlement_tier text,
  p_manual_entitlement_note text
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_written boolean;
  v_stored_subscription_id text;
  v_stored_status text;
begin
  insert into tenant_subscriptions (
    tenant_id, paddle_customer_id, paddle_subscription_id, tier_id, billing_cycle, status,
    current_period_ends_at, scheduled_change, past_due_since, last_event_occurred_at,
    manual_entitlement_tier, manual_entitlement_note, updated_at
  )
  values (
    p_tenant_id, p_paddle_customer_id, p_paddle_subscription_id, p_tier_id, p_billing_cycle, p_status,
    p_current_period_ends_at, p_scheduled_change, p_past_due_since, p_last_event_occurred_at,
    p_manual_entitlement_tier, p_manual_entitlement_note, now()
  )
  on conflict (tenant_id) do update
    set paddle_customer_id       = excluded.paddle_customer_id,
        paddle_subscription_id   = excluded.paddle_subscription_id,
        tier_id                  = excluded.tier_id,
        billing_cycle            = excluded.billing_cycle,
        status                   = excluded.status,
        current_period_ends_at   = excluded.current_period_ends_at,
        scheduled_change         = excluded.scheduled_change,
        past_due_since           = excluded.past_due_since,
        last_event_occurred_at   = excluded.last_event_occurred_at,
        manual_entitlement_tier  = excluded.manual_entitlement_tier,
        manual_entitlement_note  = excluded.manual_entitlement_note,
        updated_at               = now()
    where (
            -- Ordering guard: never let an older event overwrite a newer one.
            tenant_subscriptions.last_event_occurred_at is null
            or tenant_subscriptions.last_event_occurred_at <= excluded.last_event_occurred_at
          )
      and (
            -- Identity guard: only this tenant's OWN subscription may write
            -- here — or a row that has no Paddle subscription yet, or one
            -- whose subscription is terminal and may be replaced.
            tenant_subscriptions.paddle_subscription_id is null
            or tenant_subscriptions.paddle_subscription_id = excluded.paddle_subscription_id
            or tenant_subscriptions.status = 'canceled'
          )
  returning true into v_written;

  if coalesce(v_written, false) then
    return 'written';
  end if;

  -- Nothing was written; re-read the row that blocked it to say WHICH guard
  -- refused. Inside the same transaction, so this sees exactly the row the
  -- statement above was evaluated against.
  select paddle_subscription_id, status
    into v_stored_subscription_id, v_stored_status
    from tenant_subscriptions
   where tenant_id = p_tenant_id;

  if v_stored_subscription_id is not null
     and v_stored_subscription_id is distinct from p_paddle_subscription_id
     and v_stored_status is distinct from 'canceled' then
    return 'subscription_conflict';
  end if;

  return 'stale';
end;
$$;

-- Service-role only, explicitly.
--
-- Two separate revokes on purpose: PUBLIC holds EXECUTE on new functions by
-- default in Postgres, AND Supabase additionally grants EXECUTE to `anon`
-- and `authenticated` through its own default privileges — a grant made TO
-- THOSE ROLES, which `revoke … from public` does not touch. Both have to go
-- (and `security invoker` means neither would gain anything even if one
-- were missed).
revoke all on function apply_tenant_subscription_event(
  uuid, text, text, text, text, text, timestamptz, jsonb, timestamptz, timestamptz, text, text
) from public;
revoke all on function apply_tenant_subscription_event(
  uuid, text, text, text, text, text, timestamptz, jsonb, timestamptz, timestamptz, text, text
) from anon, authenticated;
grant execute on function apply_tenant_subscription_event(
  uuid, text, text, text, text, text, timestamptz, jsonb, timestamptz, timestamptz, text, text
) to service_role;

commit;

-- Down / rollback (manual -- uncomment and run only to reverse this migration):
--   begin;
--     drop function if exists apply_tenant_subscription_event(
--       uuid, text, text, text, text, text, timestamptz, jsonb, timestamptz, timestamptz, text, text
--     );
--     drop table if exists billing_checkout_refs;
--     drop table if exists paddle_webhook_events;
--     drop table if exists tenant_subscriptions;
--   commit;
