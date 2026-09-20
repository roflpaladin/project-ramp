// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Service-role CRUD
// over the three tables in 0014_billing.sql. Data access only: not one
// billing rule lives here (they are in subscription-reducer.ts and
// entitlement.ts, both pure), so this module can stay a boring, mockable
// boundary — tests/billing/paddle-webhook-route.spec.ts mocks exactly this
// file and nothing else.
//
// Everything goes through the service-role client (lib/supabase/admin.ts),
// the same shape lib/crm-connections/token-store.ts uses over
// crm_connections: all three tables have RLS enabled with ZERO policies, so
// no RLS-scoped client can read or write any of them. (When the seller UI
// needs to show a plan, 0014's header says how: a column-limited view with
// its own tenant-scoped policy — not a select policy on the table.)
//
// Every query is parameterized through supabase-js (.eq/.insert/.update/
// .rpc — the one write that needs a conditional lives in a Postgres
// function, 0014's apply_tenant_subscription_event, called with named
// arguments) —
// no SQL string is built anywhere in this file. A real query error always
// throws with context rather than being folded into the "no row" case; the
// caller must be able to tell "this tenant has no subscription" apart from
// "we couldn't find out right now" (the same distinction token-store.ts
// documents).

import { randomBytes } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingEventOutcome, SubscriptionState } from "./subscription-reducer";
import type { PaddleScheduledChange, PaddleSubscriptionStatus } from "./paddle-event";
import type { BillingCycle } from "./plans";

const SUBSCRIPTIONS_TABLE = "tenant_subscriptions";
const EVENTS_TABLE = "paddle_webhook_events";
const CHECKOUT_REFS_TABLE = "billing_checkout_refs";

const UNIQUE_VIOLATION_CODE = "23505";

/**
 * How long a server-issued checkout reference stays usable. Long enough to
 * cover a real checkout (find a card, 3-D Secure, retry a declined payment)
 * and far shorter than the lifetime of anything it could be replayed
 * against — after the first event, the tenant is resolved from the stored
 * paddle_subscription_id instead, so this window only has to cover the
 * FIRST event of a brand-new subscription.
 */
export const CHECKOUT_REF_TTL_MINUTES = 60;

/** 32 random bytes, URL-safe — opaque, unguessable, and carries no tenant information. */
const CHECKOUT_REF_BYTES = 32;

interface SubscriptionRow {
  readonly tenant_id: string;
  readonly paddle_customer_id: string | null;
  readonly paddle_subscription_id: string;
  readonly tier_id: string;
  readonly billing_cycle: string | null;
  readonly status: string;
  readonly current_period_ends_at: string | null;
  readonly scheduled_change: PaddleScheduledChange | null;
  readonly past_due_since: string | null;
  readonly last_event_occurred_at: string | null;
  readonly manual_entitlement_tier: string | null;
  readonly manual_entitlement_note: string | null;
}

const SUBSCRIPTION_COLUMNS =
  "tenant_id, paddle_customer_id, paddle_subscription_id, tier_id, billing_cycle, status, " +
  "current_period_ends_at, scheduled_change, past_due_since, last_event_occurred_at, " +
  "manual_entitlement_tier, manual_entitlement_note";

function toState(row: SubscriptionRow): SubscriptionState {
  return Object.freeze({
    tenantId: row.tenant_id,
    paddleCustomerId: row.paddle_customer_id,
    paddleSubscriptionId: row.paddle_subscription_id,
    tierId: row.tier_id,
    billingCycle: (row.billing_cycle as BillingCycle | null) ?? null,
    status: row.status as PaddleSubscriptionStatus,
    currentPeriodEndsAt: row.current_period_ends_at,
    scheduledChange: row.scheduled_change,
    pastDueSince: row.past_due_since,
    lastEventOccurredAt: row.last_event_occurred_at,
    manualEntitlementTier: row.manual_entitlement_tier,
    manualEntitlementNote: row.manual_entitlement_note,
  });
}

export async function findByTenantId(tenantId: string): Promise<SubscriptionState | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(SUBSCRIPTIONS_TABLE)
    .select(SUBSCRIPTION_COLUMNS)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read the tenant subscription: ${error.message}`);
  return data ? toState(data as unknown as SubscriptionRow) : null;
}

export async function findByPaddleSubscriptionId(subscriptionId: string): Promise<SubscriptionState | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(SUBSCRIPTIONS_TABLE)
    .select(SUBSCRIPTION_COLUMNS)
    .eq("paddle_subscription_id", subscriptionId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read the subscription by Paddle id: ${error.message}`);
  return data ? toState(data as unknown as SubscriptionRow) : null;
}

/**
 * What the database decided about one conditional write:
 *   written               — the row now reflects this event.
 *   stale                 — the stored row is already at or ahead of this
 *                           event's occurred_at; nothing was written.
 *   subscription_conflict — the tenant already has a DIFFERENT, non-canceled
 *                           Paddle subscription; nothing was written.
 * Neither refusal is an error — both are normal outcomes of concurrent or
 * out-of-order delivery, and each maps to a different recorded outcome.
 */
export type ApplySubscriptionResult = "written" | "stale" | "subscription_conflict";

const APPLY_RESULTS: readonly string[] = ["written", "stale", "subscription_conflict"];

/**
 * Writes through apply_tenant_subscription_event (0014), NOT a plain
 * upsert. Two webhook deliveries can be in flight at once; each would read
 * the row, decide in application code that it may write, and write — last
 * writer wins. That is how an older event overwrites a newer one, and how
 * two first-events for different subscriptions both "pass" a check-then-
 * write guard and leave the tenant pointing at the wrong subscription.
 *
 * The Postgres function does the insert-or-update AND both guards (is this
 * event newer? is this the same subscription — or a canceled one we may
 * replace?) in ONE statement, so the loser of a race is rejected by the
 * database itself rather than by a check it already passed.
 *
 * Conflict target is tenant_id: the billing unit is the TENANT (founder
 * ruling — one subscription per tenant).
 */
export async function upsertFromState(state: SubscriptionState): Promise<ApplySubscriptionResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_tenant_subscription_event", {
    p_tenant_id: state.tenantId,
    p_paddle_customer_id: state.paddleCustomerId,
    p_paddle_subscription_id: state.paddleSubscriptionId,
    p_tier_id: state.tierId,
    p_billing_cycle: state.billingCycle,
    p_status: state.status,
    p_current_period_ends_at: state.currentPeriodEndsAt,
    p_scheduled_change: state.scheduledChange,
    p_past_due_since: state.pastDueSince,
    p_last_event_occurred_at: state.lastEventOccurredAt,
    p_manual_entitlement_tier: state.manualEntitlementTier,
    p_manual_entitlement_note: state.manualEntitlementNote,
  });

  if (error) throw new Error(`Failed to persist the tenant subscription: ${error.message}`);

  // Validated, not trusted: an old (boolean-returning) version of the
  // function still deployed somewhere must fail loudly — and be retried by
  // Paddle — rather than be silently read as "not written".
  if (typeof data !== "string" || !APPLY_RESULTS.includes(data)) {
    throw new Error(`apply_tenant_subscription_event returned an unexpected result: ${JSON.stringify(data)}`);
  }
  return data as ApplySubscriptionResult;
}

export interface RecordEventInput {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payload: unknown;
}

/**
 * What a redelivery should do:
 *   recorded  — first time we have seen this event_id; process it.
 *   reprocess — we logged it but never finished (outcome still 'received',
 *               or 'failed'): the customer may have paid and never been
 *               provisioned, so Paddle's retry must actually be processed.
 *   duplicate — a previous delivery reached a terminal outcome; no-op.
 */
export type RecordEventResult = "recorded" | "reprocess" | "duplicate";

/** The full vocabulary of paddle_webhook_events.processing_outcome (0014). */
export type EventProcessingOutcome = BillingEventOutcome | "received" | "failed";

/** Outcomes that mean the work is finished — anything else is unfinished work. */
const TERMINAL_OUTCOMES: readonly string[] = ["applied", "stale", "ignored", "duplicate"];

/**
 * The idempotency gate. event_id is the primary key, so a redelivery comes
 * back as a unique violation — normal Paddle behaviour, not an error. What
 * it means depends on how the FIRST attempt ended, which is why the
 * existing row's outcome is read back rather than assumed: treating every
 * redelivery as a duplicate would turn any mid-processing crash into a
 * permanent "customer paid, tenant never provisioned".
 *
 * Called BEFORE the state is computed, so the row always exists to mark.
 */
export async function recordEvent(input: RecordEventInput): Promise<RecordEventResult> {
  const admin = createAdminClient();
  const { error } = await admin.from(EVENTS_TABLE).insert({
    event_id: input.eventId,
    event_type: input.eventType,
    occurred_at: input.occurredAt,
    payload: input.payload,
  });

  if (!error) return "recorded";
  if (error.code !== UNIQUE_VIOLATION_CODE) {
    throw new Error(`Failed to record the Paddle webhook event: ${error.message}`);
  }

  const { data, error: readError } = await admin
    .from(EVENTS_TABLE)
    .select("processing_outcome")
    .eq("event_id", input.eventId)
    .maybeSingle();

  if (readError) throw new Error(`Failed to read the existing webhook event: ${readError.message}`);

  // A vanished row (raced deletion, manual cleanup) resolves to "redo the
  // work": provisioning a paid tenant twice is idempotent here, never
  // provisioning them is not.
  const existingOutcome = (data as { processing_outcome?: string } | null)?.processing_outcome ?? null;
  return existingOutcome !== null && TERMINAL_OUTCOMES.includes(existingOutcome) ? "duplicate" : "reprocess";
}

/** Second phase of recordEvent: what we ended up doing with the event. */
export async function markEventOutcome(
  eventId: string,
  outcome: EventProcessingOutcome,
  reason: string | null,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from(EVENTS_TABLE)
    .update({ processing_outcome: outcome, processing_reason: reason })
    .eq("event_id", eventId);

  if (error) throw new Error(`Failed to update the Paddle webhook event outcome: ${error.message}`);
}

export interface CheckoutRef {
  readonly id: string;
  readonly expiresAt: string;
}

export interface CheckoutRefOwner {
  readonly tenantId: string;
  readonly userId: string | null;
}

/**
 * Issued server-side, for the signed-in seller's OWN tenant, immediately
 * before the Paddle overlay opens. The browser only ever learns the opaque
 * id — it never sends us a tenant id, so there is nothing for it to tamper
 * with (this replaces the pre-T59 `customData: { tenantId }`).
 */
export async function createCheckoutRef(input: CheckoutRefOwner): Promise<CheckoutRef> {
  const admin = createAdminClient();
  const id = randomBytes(CHECKOUT_REF_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + CHECKOUT_REF_TTL_MINUTES * 60_000).toISOString();

  const { error } = await admin.from(CHECKOUT_REFS_TABLE).insert({
    id,
    tenant_id: input.tenantId,
    user_id: input.userId,
    expires_at: expiresAt,
  });

  if (error) throw new Error(`Failed to issue a checkout reference: ${error.message}`);
  return Object.freeze({ id, expiresAt });
}

interface CheckoutRefRow {
  readonly tenant_id: string;
  readonly user_id: string | null;
  readonly expires_at: string;
  readonly paddle_subscription_id: string | null;
}

/**
 * Resolves a checkout reference to the tenant it was issued for, and binds
 * it to the Paddle subscription it first resolved for.
 *
 * Returns null — granting nothing — when the reference does not exist, has
 * expired, or is ALREADY BOUND TO A DIFFERENT SUBSCRIPTION. That last case
 * is the one that matters: without it, a replayed reference could attach a
 * second subscription to the tenant that issued the first one.
 *
 * Re-use by the SAME subscription is expected and allowed: Paddle sends
 * several events for one checkout and each must resolve to the same tenant.
 * consumed_at is a record of first use, not a one-shot lock — the security
 * properties are unguessable, server-issued, tenant-bound, short-lived and
 * (now) subscription-bound.
 */
export async function consumeCheckoutRef(
  refId: string,
  paddleSubscriptionId: string,
): Promise<CheckoutRefOwner | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(CHECKOUT_REFS_TABLE)
    .select("tenant_id, user_id, expires_at, paddle_subscription_id")
    .eq("id", refId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read the checkout reference: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as CheckoutRefRow;
  if (Date.parse(row.expires_at) <= Date.now()) return null;

  if (row.paddle_subscription_id !== null && row.paddle_subscription_id !== paddleSubscriptionId) {
    console.error("[checkout-ref] refused a reference already bound to a different subscription");
    return null;
  }

  // Binds the reference on first use. Re-stamping the same subscription is
  // harmless; the guard above is what makes the binding meaningful.
  const { error: stampError } = await admin
    .from(CHECKOUT_REFS_TABLE)
    .update({ consumed_at: new Date().toISOString(), paddle_subscription_id: paddleSubscriptionId })
    .eq("id", refId);

  if (stampError) throw new Error(`Failed to stamp the checkout reference: ${stampError.message}`);

  return Object.freeze({ tenantId: row.tenant_id, userId: row.user_id });
}
