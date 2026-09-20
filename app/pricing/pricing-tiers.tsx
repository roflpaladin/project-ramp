"use client";

// Sprint 12, Ticket 67 (slice 1, founder scope amendment — Paddle overlay
// checkout). The client half of /pricing: everything that has to run in
// the browser (Paddle.js itself, the monthly/yearly toggle's local state,
// the overlay checkout). app/pricing/page.tsx (a Server Component) resolves
// the tier config, the Paddle client environment/token pair, the visitor's
// country, and the signed-in seller's email/tenant id, then hands all of it
// down here as plain props — this file never reads process.env or cookies
// itself.
//
// Per the founder's brief: prices shown are Paddle's own formattedTotals,
// rendered VERBATIM — no Intl.NumberFormat, no rounding, no re-deriving a
// number from a price ID. This component only ever displays what
// Paddle.PricePreview returned for the price ID actually being charged.
//
// Tax fix (post-review): Paddle prices are tax-exclusive, so
// formattedTotals.total already includes any VAT/sales tax PricePreview
// calculated for the visitor's country — showing it as the headline number
// would silently mark up the founder's advertised price (e.g. $60 rendering
// as $66.60 in an 11%-VAT country). The headline is therefore
// formattedTotals.subtotal (the pre-tax price that matches what's
// advertised), with formattedTotals.tax/.total disclosed on a small
// secondary line — verbatim, still no math — ONLY when tax applies, so the
// number a visitor sees on this page still matches what Paddle's own
// checkout charges them. Whether tax applies is decided from the RAW
// (unformatted) lineItem.totals.tax string, not the formatted one — a
// formatted "$0.00" still contains a currency symbol, so only the raw value
// is safe to compare against "0".
//
// Enterprise (kind: "contact") is a second founder amendment: it is
// invoiced directly, never sold through Paddle, so it never contributes a
// price ID to the PricePreview request, never opens Checkout, and its
// "Talk to us" action is always the neutral/secondary button style — never
// Signal, regardless of its (always-false, per lib/billing/plans.ts)
// isRecommended flag. Toggling monthly/yearly must not affect its card at
// all — it renders "Custom" unconditionally.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import type { PaddleEnvironment } from "@/lib/billing/paddle-env";
import type { CheckoutTier, Tier } from "@/lib/billing/plans";
import { YEARLY_DISCOUNT_NOTE } from "@/lib/billing/plans";
import "./pricing.css";

type BillingCycle = "month" | "year";

export interface PricingTiersProps {
  tiers: readonly Tier[];
  hasYearlyPricing: boolean;
  paddleEnvironment: PaddleEnvironment;
  paddleClientToken: string;
  /** Already resolved (2-letter code or null) by lib/billing/country.ts —
   * this component never sees an "XX"/unknown sentinel. */
  countryCode: string | null;
  signedInEmail: string | null;
  tenantId: string | null;
}

// A fixed, hardcoded literal — never built from request/user input — so
// this can never become an open redirect no matter what /register does
// with it. /register itself does not yet read `next` (a follow-up for
// whoever owns that flow); the link is safe to ship ahead of that.
const REGISTER_RETURN_PATH = "/pricing";
const SIGNED_OUT_SUBSCRIBE_HREF = `/register?next=${encodeURIComponent(REGISTER_RETURN_PATH)}`;

function tierCapLabel(maxActiveDeals: number | null): string {
  return maxActiveDeals === null ? "Unlimited active deals" : `Up to ${maxActiveDeals} active deals`;
}

function priceIdFor(tier: CheckoutTier, cycle: BillingCycle): string | null {
  return cycle === "year" ? tier.priceId.year : tier.priceId.month;
}

function isCheckoutTier(tier: Tier): tier is CheckoutTier {
  return tier.kind === "checkout";
}

/** The three Paddle-formatted strings for one tier's current price, plus
 * whether tax applies (decided from the RAW totals.tax string at fetch
 * time — see the file header comment). All three strings render verbatim,
 * exactly as Paddle returned them; nothing here is computed.
 *
 * `priceId` is the price ID this response was actually fetched for — kept
 * alongside the strings (not just in a separate lookup) so the render below
 * can derive whether a stored entry still matches the CURRENTLY selected
 * billing cycle before ever showing it. See the "stale price" fix in
 * PricingTiers for why that check exists. */
export interface TierPriceDetails {
  readonly priceId: string;
  readonly subtotal: string;
  readonly tax: string;
  readonly total: string;
  readonly hasTax: boolean;
}

interface TierPriceProps {
  tier: Tier;
  priceDetails: TierPriceDetails | undefined;
  billingCycle: BillingCycle;
}

/** Enterprise (kind: "contact") always shows "Custom" — never a Paddle
 * price, never affected by the monthly/yearly toggle. For a checkout tier,
 * the headline is the pre-tax subtotal (matches the advertised price); the
 * tax-inclusive total is disclosed on its own line, only when tax applies,
 * so it still matches what Paddle's checkout actually charges. */
function TierPrice({ tier, priceDetails, billingCycle }: TierPriceProps) {
  if (tier.kind === "contact") {
    return (
      <p className="pr-tier-price">
        <span className="pr-tier-amount">Custom</span>
      </p>
    );
  }

  return (
    <div className="pr-tier-price-live" aria-live="polite">
      <p className="pr-tier-price">
        {priceDetails ? (
          <span className="pr-tier-amount pr-mono">{priceDetails.subtotal}</span>
        ) : (
          <span className="pr-tier-amount pr-tier-amount--loading">Loading price…</span>
        )}
        <span className="pr-tier-period">/ {billingCycle === "year" ? "year" : "month"}</span>
      </p>
      {priceDetails?.hasTax ? (
        <p className="pr-tier-tax-note">
          + <span className="pr-mono">{priceDetails.tax}</span> tax · <span className="pr-mono">{priceDetails.total}</span>{" "}
          total
        </p>
      ) : null}
    </div>
  );
}

interface TierActionProps {
  tier: Tier;
  isReady: boolean;
  signedInEmail: string | null;
  onSubscribe: () => void;
}

/** Three distinct actions depending on tier kind + auth state: Enterprise
 * always mailto's the founder; a signed-out visitor is routed to register
 * first; a signed-in visitor gets the real Paddle Checkout button. */
function TierAction({ tier, isReady, signedInEmail, onSubscribe }: TierActionProps) {
  const isSignalTier = tier.kind === "checkout" && tier.isRecommended;
  const btnClassName = `pr-btn ${isSignalTier ? "pr-btn-primary" : "pr-btn-secondary"}`;

  if (tier.kind === "contact") {
    return (
      <a href={tier.contactHref} className={btnClassName}>
        Talk to us
      </a>
    );
  }

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

export function PricingTiers({
  tiers,
  hasYearlyPricing,
  paddleEnvironment,
  paddleClientToken,
  countryCode,
  signedInEmail,
  tenantId,
}: PricingTiersProps) {
  const { resolvedTheme } = useTheme();
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("month");
  const [priceDetailsByTier, setPriceDetailsByTier] = useState<Readonly<Record<string, TierPriceDetails>>>({});
  const [hasPriceError, setHasPriceError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    initializePaddle({ environment: paddleEnvironment, token: paddleClientToken })
      .then((instance) => {
        if (isMounted && instance) setPaddle(instance);
      })
      .catch(() => {
        if (isMounted) setHasPriceError(true);
      });

    return () => {
      isMounted = false;
    };
    // paddleEnvironment/paddleClientToken are validated server-side and
    // never change without a full page reload — deliberately not expected
    // to re-run, but included so a stale closure can never linger.
  }, [paddleEnvironment, paddleClientToken]);

  // Enterprise (and any other future "contact" tier) never contributes a
  // price ID here — it must never appear in a PricePreview request.
  const priceItems = useMemo(
    () =>
      tiers
        .filter(isCheckoutTier)
        .map((tier) => ({ tierId: tier.id, priceId: priceIdFor(tier, billingCycle) }))
        .filter((item): item is { tierId: string; priceId: string } => item.priceId !== null),
    [tiers, billingCycle],
  );

  useEffect(() => {
    if (!paddle || priceItems.length === 0) return;
    let isCancelled = false;

    paddle
      .PricePreview({
        items: priceItems.map(({ priceId }) => ({ priceId, quantity: 1 })),
        ...(countryCode ? { address: { countryCode } } : {}),
      })
      .then((response) => {
        if (isCancelled) return;
        const next: Record<string, TierPriceDetails> = {};
        for (const lineItem of response.data.details.lineItems) {
          const match = priceItems.find((item) => item.priceId === lineItem.price.id);
          if (match) {
            next[match.tierId] = {
              priceId: match.priceId,
              subtotal: lineItem.formattedTotals.subtotal,
              tax: lineItem.formattedTotals.tax,
              total: lineItem.formattedTotals.total,
              // Raw, unformatted comparison — see the file header comment on
              // why formattedTotals.tax ("$0.00") can't be compared to "0".
              hasTax: lineItem.totals.tax !== "0",
            };
          }
        }
        setPriceDetailsByTier(next);
        setHasPriceError(false);
      })
      .catch(() => {
        if (!isCancelled) setHasPriceError(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [paddle, priceItems, countryCode]);

  const handleSubscribe = useCallback(
    (tier: CheckoutTier) => {
      const priceId = priceIdFor(tier, billingCycle);
      if (!paddle || !priceId) return;

      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          successUrl: "/welcome",
          theme: resolvedTheme === "dark" ? "dark" : "light",
        },
        customer: signedInEmail ? { email: signedInEmail } : undefined,
        customData: tenantId ? { tenantId } : undefined,
      });
    },
    [paddle, billingCycle, resolvedTheme, signedInEmail, tenantId],
  );

  return (
    <section aria-labelledby="pr-plans-heading" className="pr-plans">
      <div className="pr-plans-head">
        <h2 id="pr-plans-heading" className="pr-section-title">
          Plans
        </h2>
        {hasYearlyPricing ? (
          <div className="pr-cycle-toggle-group">
            <div className="pr-cycle-toggle" role="group" aria-label="Billing cycle">
              <button
                type="button"
                className="pr-cycle-btn"
                aria-pressed={billingCycle === "month"}
                onClick={() => setBillingCycle("month")}
              >
                Monthly
              </button>
              <button
                type="button"
                className="pr-cycle-btn"
                aria-pressed={billingCycle === "year"}
                onClick={() => setBillingCycle("year")}
              >
                Yearly
              </button>
            </div>
            <p className="pr-cycle-note">{YEARLY_DISCOUNT_NOTE}</p>
          </div>
        ) : null}
      </div>

      {hasPriceError ? (
        <p className="pr-price-error" role="status">
          We couldn&apos;t load live pricing right now. Refresh the page to try again.
        </p>
      ) : null}

      <ul className="pr-tier-grid">
        {tiers.map((tier) => {
          const priceId = tier.kind === "checkout" ? priceIdFor(tier, billingCycle) : null;
          const storedDetails = priceDetailsByTier[tier.id];
          // Derived, not stored: a stored entry only counts as "the current
          // price" when it was fetched for the price ID the CURRENTLY
          // selected billing cycle actually charges. Without this check, a
          // toggle from monthly to yearly would keep showing last cycle's
          // (now mislabeled) price/tax numbers — and leave Subscribe
          // enabled — for however long the new PricePreview call takes to
          // resolve. Deriving it here (rather than clearing state at the
          // start of the effect) also means an out-of-order response for a
          // cycle that's no longer selected can never flash onto screen,
          // even before its own isCancelled guard below runs.
          const priceDetails =
            storedDetails && storedDetails.priceId === priceId ? storedDetails : undefined;
          const isReady = tier.kind === "checkout" && paddle !== null && priceId !== null && priceDetails !== undefined;

          const isRecommended = tier.kind === "checkout" && tier.isRecommended;

          return (
            <li
              key={tier.id}
              className="pr-tier-card"
              data-recommended={isRecommended ? "true" : undefined}
              data-testid={`pr-tier-${tier.id}`}
            >
              {isRecommended ? <p className="pr-tier-badge">Recommended</p> : null}
              <h3 className="pr-tier-name">{tier.name}</h3>
              <p className="pr-tier-description">{tier.description}</p>

              <TierPrice tier={tier} priceDetails={priceDetails} billingCycle={billingCycle} />
              <p className="pr-tier-cap">{tierCapLabel(tier.maxActiveDeals)}</p>

              <ul className="pr-tier-features">
                {tier.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <TierAction
                tier={tier}
                isReady={isReady}
                signedInEmail={signedInEmail}
                onSubscribe={() => tier.kind === "checkout" && handleSubscribe(tier)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
