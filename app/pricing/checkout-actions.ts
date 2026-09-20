"use server";

// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Issues the
// server-side checkout reference /pricing hands to Paddle just before the
// overlay opens.
//
// Why this exists: T67 shipped `customData: { tenantId }`, a tenant id the
// BROWSER supplies. A signed-in user could edit it and have a webhook
// credit someone else's tenant with their subscription (or their own tenant
// with someone else's payment). The fix is that the browser never names a
// tenant at all: this action resolves the seller's own tenant from their
// session (requireSeller — T28-9's contract, statically enforced by
// tests/security/server-action-auth.spec.ts), stores it against an opaque
// random id with a short expiry (lib/billing/subscription-repository.ts),
// and returns only that id. The webhook resolves the tenant by looking the
// id up server-side.
//
// Exports exactly one async function plus a type (erased at compile time) —
// a "use server" module may not export a runtime value, the lesson
// app/admin/workspaces/[id]/invite-state.ts records.

import { createCheckoutRef } from "@/lib/billing/subscription-repository";
import { requireSeller } from "@/lib/plans/require-seller";
import { CHECKOUT_REF_RATE_LIMIT, checkRateLimit } from "@/lib/rate-limit";

export type IssueCheckoutRefResult =
  | { readonly ok: true; readonly checkoutRef: string }
  | { readonly ok: false; readonly error: string };

const SIGNED_OUT_MESSAGE = "Sign in again to continue to checkout.";
const NO_TENANT_MESSAGE = "Your account isn't set up for billing yet. Contact us and we'll sort it out.";
const RATE_LIMITED_MESSAGE = "Too many checkout attempts. Try again in a few minutes.";
const GENERIC_ERROR_MESSAGE = "We couldn't start checkout. Try again.";

export async function issueCheckoutRefAction(): Promise<IssueCheckoutRefResult> {
  const seller = await requireSeller();
  if (!seller) return { ok: false, error: SIGNED_OUT_MESSAGE };
  if (!seller.tenantId) return { ok: false, error: NO_TENANT_MESSAGE };

  // Keyed per seller, not per IP: this writes a row per call, and the caller
  // is always authenticated by the time we get here. Same reasoning as
  // ONBOARDING_RATE_LIMIT's per-seller key.
  const { allowed } = checkRateLimit(
    `checkout-ref:${seller.userId}`,
    CHECKOUT_REF_RATE_LIMIT.limit,
    CHECKOUT_REF_RATE_LIMIT.windowMs,
  );
  if (!allowed) return { ok: false, error: RATE_LIMITED_MESSAGE };

  try {
    const ref = await createCheckoutRef({ tenantId: seller.tenantId, userId: seller.userId });
    return { ok: true, checkoutRef: ref.id };
  } catch (error) {
    console.error("[checkout-ref] failed to issue a checkout reference:", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return { ok: false, error: GENERIC_ERROR_MESSAGE };
  }
}
