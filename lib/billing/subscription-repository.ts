// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Service-role CRUD
// over the three tables in 0014_billing.sql. Data access only: not one
// billing rule lives here (they are in subscription-reducer.ts and
// entitlement.ts, both pure), so this module can stay a boring, mockable
// boundary — tests/billing/paddle-webhook-route.spec.ts mocks exactly this
// file and nothing else.
//
// Everything goes through the service-role client (lib/supabase/admin.ts),
// the same shape lib/crm-connections/token-store.ts uses over
// crm_connections: tenant_subscriptions exposes only a seller SELECT policy
// for their own tenant, and the other two tables have RLS enabled with zero
// policies, so no RLS-scoped client could write any of this anyway.
//
// Every query is parameterized through supabase-js (.eq/.insert/.upsert) —
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

function toRow(state: SubscriptionState): SubscriptionRow & { readonly updated_at: string } {
  return {
    tenant_id: state.tenantId,
    paddle_customer_id: state.paddleCustomerId,
    paddle_subscription_id: state.paddleSubscriptionId,
    tier_id: state.tierId,
    billing_cycle: state.billingCycle,
    status: state.status,
    current_period_ends_at: state.currentPeriodEndsAt,
    scheduled_change: state.scheduledChange,
    past_due_since: state.pastDueSince,
    last_event_occurred_at: state.lastEventOccurredAt,
    manual_entitlement_tier: state.manualEntitlementTier,
    manual_entitlement_note: state.manualEntitlementNote,
    updated_at: new Date().toISOString(),
  };
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
 * Upserts on tenant_id, not on paddle_subscription_id: the billing unit is
 * the TENANT (founder ruling — one subscription per tenant), so a tenant
 * who cancels and later subscribes again replaces their row rather than
 * accumulating a second one.
 */
export async function upsertFromState(state: SubscriptionState): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from(SUBSCRIPTIONS_TABLE).upsert(toRow(state), { onConflict: "tenant_id" });

  if (error) throw new Error(`Failed to persist the tenant subscription: ${error.message}`);
}

export interface RecordEventInput {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payload: unknown;
}

export type RecordEventResult = "recorded" | "duplicate";

/**
 * The idempotency gate. event_id is the primary key, so a redelivery of an
 * event we already logged comes back as a unique violation — reported as
 * "duplicate" rather than thrown, because a redelivery is normal Paddle
 * behaviour, not an error. Called BEFORE any state is computed, so a
 * duplicate can never be applied twice.
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
  if (error.code === UNIQUE_VIOLATION_CODE) return "duplicate";
  throw new Error(`Failed to record the Paddle webhook event: ${error.message}`);
}

/** Second phase of recordEvent: what we ended up doing with the event. */
export async function markEventOutcome(
  eventId: string,
  outcome: BillingEventOutcome,
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

/**
 * Resolves a checkout reference to the tenant it was issued for, or null
 * when it does not exist or has expired. Stamping consumed_at is a record
 * of first use, NOT a one-shot lock: Paddle can send several events for the
 * same checkout, and a second event carrying the same ref must still
 * resolve to the same tenant. The security property is that the id is
 * unguessable, server-issued, tenant-bound and short-lived — not that it is
 * single-use.
 */
export async function consumeCheckoutRef(refId: string): Promise<CheckoutRefOwner | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(CHECKOUT_REFS_TABLE)
    .select("tenant_id, user_id, expires_at")
    .eq("id", refId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read the checkout reference: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as { tenant_id: string; user_id: string | null; expires_at: string };
  if (Date.parse(row.expires_at) <= Date.now()) return null;

  const { error: stampError } = await admin
    .from(CHECKOUT_REFS_TABLE)
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", refId)
    .is("consumed_at", null);

  if (stampError) throw new Error(`Failed to stamp the checkout reference: ${stampError.message}`);

  return Object.freeze({ tenantId: row.tenant_id, userId: row.user_id });
}
