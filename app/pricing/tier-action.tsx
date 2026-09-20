"use client";

// Sprint 12, Ticket 59 (slice 2 — no double-billing). Extracted out of
// pricing-tiers.tsx (which was growing past this repo's ~400-line file
// guideline) purely for file cohesion — no behaviour changed by the split.
// Importer: app/pricing/pricing-tiers.tsx (PricingTiers), which is also the
// only place that constructs TierActionProps; not a duplicate of anything.
//
// A checkout tier's action has FIVE possible shapes (Enterprise/"contact"
// tiers are unaffected and always mailto the founder):
//   1. Invoiced tenant: no Subscribe affordance survives at all — the
//      page's own explanatory line (in PricingTiers) points them to
//      /settings/billing instead.
//   2. Live subscription, THIS is that subscription's tier: a non-
//      interactive "Current plan" label — never a second checkout.
//   3. Live subscription, a DIFFERENT tier: "Change plan in billing" links
//      to /settings/billing (Paddle's portal handles upgrade/downgrade, not
//      a second Checkout.open call) — Signal only follows the recommended
//      tier here, and only when it isn't already the current plan (an inert
//      label is never Signal-styled, so this page can render ZERO Signal
//      elements while a tenant is already on the recommended tier).
//   4. Signed out: a plain /register link.
//   5. Otherwise: the real Paddle Checkout button.

import Link from "next/link";
import type { Tier } from "@/lib/billing/plans";

export const BILLING_SETTINGS_HREF = "/settings/billing";

// A fixed, hardcoded literal — never built from request/user input — so
// this can never become an open redirect no matter what /register does
// with it. /register itself does not yet read `next` (a follow-up for
// whoever owns that flow); the link is safe to ship ahead of that.
const REGISTER_RETURN_PATH = "/pricing";
const SIGNED_OUT_SUBSCRIBE_HREF = `/register?next=${encodeURIComponent(REGISTER_RETURN_PATH)}`;

export interface TierActionProps {
  tier: Tier;
  isReady: boolean;
  signedInEmail: string | null;
  /** This tier IS the tenant's own live subscription's tier. */
  isCurrentTier: boolean;
  hasLiveSubscription: boolean;
  isManualTenant: boolean;
  onSubscribe: () => void;
}

export function TierAction({
  tier,
  isReady,
  signedInEmail,
  isCurrentTier,
  hasLiveSubscription,
  isManualTenant,
  onSubscribe,
}: TierActionProps) {
  if (tier.kind === "contact") {
    return (
      <a href={tier.contactHref} className="pr-btn pr-btn-secondary">
        Talk to us
      </a>
    );
  }

  if (isManualTenant) return null;

  if (hasLiveSubscription) {
    if (isCurrentTier) {
      return <span className="pr-tier-current">Current plan</span>;
    }
    const isSignalTier = tier.isRecommended;
    return (
      <Link
        href={BILLING_SETTINGS_HREF}
        className={`pr-btn ${isSignalTier ? "pr-btn-primary" : "pr-btn-secondary"}`}
        data-signal={isSignalTier ? "true" : undefined}
      >
        Change plan in billing
      </Link>
    );
  }

  const isSignalTier = tier.isRecommended;
  const btnClassName = `pr-btn ${isSignalTier ? "pr-btn-primary" : "pr-btn-secondary"}`;

  if (!signedInEmail) {
    return (
      <Link href={SIGNED_OUT_SUBSCRIBE_HREF} className={btnClassName} data-signal={isSignalTier ? "true" : undefined}>
        Sign up to subscribe
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={btnClassName}
      data-signal={isSignalTier ? "true" : undefined}
      disabled={!isReady}
      onClick={onSubscribe}
    >
      Subscribe
    </button>
  );
}
