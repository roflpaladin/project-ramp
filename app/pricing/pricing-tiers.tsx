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
// Checkout identity (Sprint 12, Ticket 59): this component no longer knows
// (or sends) a tenant id. It used to pass `customData: { tenantId }`, which
// a signed-in user could tamper with before the overlay opened — the
// webhook would then have credited whatever tenant the browser named.
// Instead, Subscribe first calls issueCheckoutRefAction() (a server action
// that resolves the seller's own tenant from their session and stores it
// against an opaque id), and the only thing that reaches Paddle is
// `customData: { checkoutRef }`.
//
// Enterprise (kind: "contact") is a second founder amendment: it is
// invoiced directly, never sold through Paddle, so it never contributes a
// price ID to the PricePreview request, never opens Checkout, and its
// "Talk to us" action is always the neutral/secondary button style — never
// Signal, regardless of its (always-false, per lib/billing/plans.ts)
// isRecommended flag. Toggling monthly/yearly must not affect its card at
// all — it renders "Custom" unconditionally.
//
// No double-billing (Sprint 12, Ticket 59 slice 2): app/pricing/page.tsx now
// also resolves the tenant's own entitlement/subscription and passes down
// currentTierId/hasLiveSubscription/isManualTenant — see TierAction's own
// comment for exactly how each state changes a checkout tier's action.
// issueCheckoutRefAction (./checkout-actions.ts) refuses server-side too;
// this component's own gating is a UX nicety, never the actual guard.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { activeDealsAllowanceLabel } from "@/lib/billing/active-deals-label";
import type { PaddleEnvironment } from "@/lib/billing/paddle-env";
import type { CheckoutTier, Tier } from "@/lib/billing/plans";
import { YEARLY_DISCOUNT_NOTE } from "@/lib/billing/plans";
import { issueCheckoutRefAction } from "./checkout-actions";
import { BILLING_SETTINGS_HREF, TierAction } from "./tier-action";
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
  /** T59 slice 2. The tier id of the tenant's own live Paddle subscription
   * (never a manual-only tier), or null when there isn't one. Drives the
   * "Current plan" label — see hasLiveSubscription below for why this can
   * differ from what resolveEntitlement would grant right now (e.g. a
   * PAUSED subscription is still a live Paddle record, but resolveEntitlement
   * already sends it back to the free tier). */
  currentTierId: string | null;
  /** True for active/trialing/past_due/paused (lib/billing/entitlement.ts's
   * LIVE_SUBSCRIPTION_STATUSES) — a tenant must manage an existing Paddle
   * subscription in the portal, never by opening a second checkout. */
  hasLiveSubscription: boolean;
  /** Invoiced directly by the founder (lib/billing/entitlement.ts's "manual"
   * entitlement source) — never sold, never renewed, never changed through
   * Paddle checkout at all. */
  isManualTenant: boolean;
}

// Joined onto window.location.origin at click time — Paddle.js only accepts
// an absolute successUrl.
const CHECKOUT_SUCCESS_PATH = "/welcome";
const CHECKOUT_OPEN_ERROR = "We couldn't open checkout right now. Refresh the page and try again.";

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

export function PricingTiers({
  tiers,
  hasYearlyPricing,
  paddleEnvironment,
  paddleClientToken,
  countryCode,
  signedInEmail,
  currentTierId,
  hasLiveSubscription,
  isManualTenant,
}: PricingTiersProps) {
  const { resolvedTheme } = useTheme();
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("month");
  const [priceDetailsByTier, setPriceDetailsByTier] = useState<Readonly<Record<string, TierPriceDetails>>>({});
  const [hasPriceError, setHasPriceError] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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
    async (tier: CheckoutTier) => {
      const priceId = priceIdFor(tier, billingCycle);
      if (!paddle || !priceId) return;

      // The overlay only ever opens against a reference this server issued
      // for THIS seller's tenant — if we can't get one, there is nothing
      // safe to open, so the checkout simply doesn't start.
      const issued = await issueCheckoutRefAction();
      if (!issued.ok) {
        setCheckoutError(issued.error);
        return;
      }
      setCheckoutError(null);

      // Paddle.js validates its input synchronously and THROWS on anything it
      // dislikes — including a relative successUrl, which it requires to be
      // absolute. Caught so a refusal reads as a message, never a dead button.
      try {
        paddle.Checkout.open({
          items: [{ priceId, quantity: 1 }],
          settings: {
            displayMode: "overlay",
            variant: "one-page",
            successUrl: `${window.location.origin}${CHECKOUT_SUCCESS_PATH}`,
            theme: resolvedTheme === "dark" ? "dark" : "light",
          },
          customer: signedInEmail ? { email: signedInEmail } : undefined,
          customData: { checkoutRef: issued.checkoutRef },
        });
      } catch {
        setCheckoutError(CHECKOUT_OPEN_ERROR);
      }
    },
    [paddle, billingCycle, resolvedTheme, signedInEmail],
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

      {checkoutError ? (
        <p className="pr-price-error" role="status">
          {checkoutError}
        </p>
      ) : null}

      {isManualTenant ? (
        <p className="pr-info-note" role="status">
          You&apos;re on an invoiced plan — manage it in{" "}
          <Link href={BILLING_SETTINGS_HREF}>billing settings</Link>.
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
              <p className="pr-tier-cap">{activeDealsAllowanceLabel(tier.maxActiveDeals)}</p>

              <ul className="pr-tier-features">
                {tier.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <TierAction
                tier={tier}
                isReady={isReady}
                signedInEmail={signedInEmail}
                isCurrentTier={tier.id === currentTierId}
                hasLiveSubscription={hasLiveSubscription}
                isManualTenant={isManualTenant}
                onSubscribe={() => {
                  if (tier.kind === "checkout") void handleSubscribe(tier);
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
