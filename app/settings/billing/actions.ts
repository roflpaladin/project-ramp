"use server";

// Sprint 12, Ticket 59 (slice 2 — seller-facing billing surface). Opens
// Paddle's hosted customer portal for the SIGNED-IN SELLER'S OWN tenant.
// Takes no arguments at all — the customer/subscription id are resolved
// server-side from the seller's session via
// lib/billing/subscription-repository.ts's findByTenantId, exactly like
// app/pricing/checkout-actions.ts's issueCheckoutRefAction: a caller can
// never name (or tamper with) whose billing account this opens.
//
// Bound directly to a plain <form action={openBillingPortalAction}> (see
// app/settings/billing/page.tsx) — same shape as every other form-bound
// action in this codebase (app/settings/integrations/actions.ts's
// saveTriggerStage, hubspot-actions.ts's disconnectHubSpot): EVERY path
// ends in redirect(), success to Paddle's own URL, failure back to this
// page with `?error=<code>` — a CLOSED SET (billing-errors.ts), never free
// text (code review fix, HIGH: a free-text query param would let anyone
// craft a phishing message and have it rendered inside this trusted page).
// This shape also keeps the exported action's type exactly
// `(formData: FormData) => Promise<void>` — React's typing for a <form>'s
// action prop requires a void return, which an `{ ok, error }` object
// return would not satisfy.
//
// The detailed failure reason is logged server-side, following
// lib/billing's existing convention (event id/type/outcome only) — and,
// specifically for this action, NEVER the Paddle API key or the portal URL
// itself (a live, single-use session token).

import { redirect } from "next/navigation";

import { hasLiveSubscription } from "@/lib/billing/entitlement";
import { createBillingPortalSession, PaddlePortalError } from "@/lib/billing/paddle-portal";
import { getPaddleApiBaseUrl, getPaddleApiKey } from "@/lib/billing/paddle-server-env";
import { findByTenantId } from "@/lib/billing/subscription-repository";
import { requireSeller } from "@/lib/plans/require-seller";
import { BILLING_PORTAL_RATE_LIMIT, checkRateLimit } from "@/lib/rate-limit";
import type { BillingErrorCode } from "./billing-errors";

const BILLING_PAGE_PATH = "/settings/billing";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function redirectWithError(code: BillingErrorCode): never {
  redirect(`${BILLING_PAGE_PATH}?error=${code}`);
}

interface BillableSubscription {
  readonly customerId: string;
  /**
   * The Paddle subscription id to scope the portal session to, or `null` to
   * open the general/invoices view with no subscription-management links.
   * `null` for a CANCELED subscription on purpose (code review fix, MEDIUM):
   * there is nothing left to "manage" on a dead subscription, but the
   * tenant still has a real Paddle customer id and should be able to see
   * past invoices — sending `subscription_ids` for a canceled subscription
   * would scope the portal to that dead subscription instead of the
   * customer's general view.
   */
  readonly subscriptionId: string | null;
}

/** Free or manual/invoiced tenants have no Paddle customer at all — there is
 * nothing for Paddle's portal to show them, so this redirects (never
 * returns null) rather than making every caller re-check. */
async function resolveBillableSubscription(tenantId: string): Promise<BillableSubscription> {
  let subscription: Awaited<ReturnType<typeof findByTenantId>>;
  try {
    subscription = await findByTenantId(tenantId);
  } catch (error) {
    console.error("[billing-portal] failed to read the tenant subscription:", { message: errorMessage(error) });
    redirectWithError("generic");
  }

  if (!subscription?.paddleCustomerId) {
    redirectWithError("no_account");
  }

  return {
    customerId: subscription.paddleCustomerId,
    subscriptionId: hasLiveSubscription(subscription) ? subscription.paddleSubscriptionId : null,
  };
}

export async function openBillingPortalAction(): Promise<void> {
  const seller = await requireSeller();
  if (!seller) redirectWithError("signed_out");
  if (!seller.tenantId) redirectWithError("no_account");

  const { allowed } = checkRateLimit(
    `billing-portal:${seller.userId}`,
    BILLING_PORTAL_RATE_LIMIT.limit,
    BILLING_PORTAL_RATE_LIMIT.windowMs,
  );
  if (!allowed) redirectWithError("rate_limited");

  const { customerId, subscriptionId } = await resolveBillableSubscription(seller.tenantId);

  const apiKey = getPaddleApiKey();
  const apiBaseUrl = getPaddleApiBaseUrl();
  if (!apiKey || !apiBaseUrl) {
    console.error("[billing-portal] Paddle API key or base URL is not configured — refusing to open the portal");
    redirectWithError("misconfigured");
  }

  let url: string;
  try {
    url = await createBillingPortalSession({ apiBaseUrl, apiKey, customerId, subscriptionId });
  } catch (error) {
    console.error("[billing-portal] failed to create a Paddle portal session:", {
      message: error instanceof PaddlePortalError ? error.message : errorMessage(error),
    });
    redirectWithError("generic");
  }

  redirect(url);
}
