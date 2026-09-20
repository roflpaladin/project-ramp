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
// page with a human-readable `?error=` message the page renders verbatim
// (see the sibling salesforce/hubspot-actions.ts's own free-text-in-the-
// query-param convention, first used by saveTriggerStage). This also keeps
// the exported action's type exactly `(formData: FormData) => Promise<void>`
// — React's typing for a <form>'s action prop requires a void return, which
// an `{ ok, error }` object return would not satisfy.
//
// The detailed failure reason is logged server-side, following
// lib/billing's existing convention (event id/type/outcome only) — and,
// specifically for this action, NEVER the Paddle API key or the portal URL
// itself (a live, single-use session token).

import { redirect } from "next/navigation";

import { createBillingPortalSession, PaddlePortalError } from "@/lib/billing/paddle-portal";
import { getPaddleApiBaseUrl, getPaddleApiKey } from "@/lib/billing/paddle-server-env";
import { findByTenantId } from "@/lib/billing/subscription-repository";
import { requireSeller } from "@/lib/plans/require-seller";
import { BILLING_PORTAL_RATE_LIMIT, checkRateLimit } from "@/lib/rate-limit";

const BILLING_PAGE_PATH = "/settings/billing";
const SIGNED_OUT_MESSAGE = "Sign in again to continue to billing.";
const NO_BILLING_ACCOUNT_MESSAGE = "There's no billing account to manage yet.";
const RATE_LIMITED_MESSAGE = "Too many attempts. Try again in a few minutes.";
const MISCONFIGURED_MESSAGE = "Billing isn't available right now. Try again shortly.";
const GENERIC_ERROR_MESSAGE = "We couldn't open the billing portal. Try again.";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function redirectWithError(message: string): never {
  redirect(`${BILLING_PAGE_PATH}?error=${encodeURIComponent(message)}`);
}

interface BillableSubscription {
  readonly customerId: string;
  readonly subscriptionId: string;
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
    redirectWithError(GENERIC_ERROR_MESSAGE);
  }

  if (!subscription?.paddleCustomerId || !subscription.paddleSubscriptionId) {
    redirectWithError(NO_BILLING_ACCOUNT_MESSAGE);
  }

  return { customerId: subscription.paddleCustomerId, subscriptionId: subscription.paddleSubscriptionId };
}

export async function openBillingPortalAction(): Promise<void> {
  const seller = await requireSeller();
  if (!seller) redirectWithError(SIGNED_OUT_MESSAGE);
  if (!seller.tenantId) redirectWithError(NO_BILLING_ACCOUNT_MESSAGE);

  const { allowed } = checkRateLimit(
    `billing-portal:${seller.userId}`,
    BILLING_PORTAL_RATE_LIMIT.limit,
    BILLING_PORTAL_RATE_LIMIT.windowMs,
  );
  if (!allowed) redirectWithError(RATE_LIMITED_MESSAGE);

  const { customerId, subscriptionId } = await resolveBillableSubscription(seller.tenantId);

  const apiKey = getPaddleApiKey();
  const apiBaseUrl = getPaddleApiBaseUrl();
  if (!apiKey || !apiBaseUrl) {
    console.error("[billing-portal] Paddle API key or base URL is not configured — refusing to open the portal");
    redirectWithError(MISCONFIGURED_MESSAGE);
  }

  let url: string;
  try {
    url = await createBillingPortalSession({ apiBaseUrl, apiKey, customerId, subscriptionId });
  } catch (error) {
    console.error("[billing-portal] failed to create a Paddle portal session:", {
      message: error instanceof PaddlePortalError ? error.message : errorMessage(error),
    });
    redirectWithError(GENERIC_ERROR_MESSAGE);
  }

  redirect(url);
}
