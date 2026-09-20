// Sprint 12, Ticket 67 (slice 1 — Paddle onboarding step 1, "build your
// pricing page"). The ONE config module pricing numbers come from — the
// /pricing page reads it below, and the checkout and paywall lanes are
// expected to read the same module rather than each growing their own copy.
//
// Founder scope amendments folded in mid-ticket, in order:
//   1. Paddle onboarding requires an overlay-checkout pricing page with
//      country-localized prices, which only Paddle itself can produce (via
//      PricePreview) — so this module holds no dollar price/cap read from
//      our own env vars (an earlier version of this file did; see git
//      history). It holds the tier list (a plain array, not a hard-coded
//      union) plus each checkout tier's Paddle price IDs, resolved from
//      PADDLE_PRICE_<TIER_ID>_<MONTH|YEAR> env vars (server-only — read
//      once here, then threaded down as props, never re-read client-side).
//   2. Three confirmed tiers (Starter/Pro/Advanced) replace the PRD's
//      per-deal metered model, each with a confirmed active-deal cap.
//   3. A fourth tier, Enterprise, is invoiced directly by the founder, NOT
//      sold through Paddle checkout. Tier is a discriminated union on
//      `kind`: "checkout" tiers have a priceId and go through Paddle;
//      "contact" tiers have no priceId at all and instead carry a mailto
//      contactHref. Enterprise sits entirely outside the Paddle price-ID
//      publishable gate and the monthly/yearly consistency check below.
// FREE_TIER_ACTIVE_DEALS and the never-throws, env-injectable shape
// (mirroring lib/plans/stall-threshold.ts) carry over unchanged: a missing
// or invalid env var must never resolve to a placeholder that could render
// publicly — callers gate on `isPublishable` (app/pricing/page.tsx 404s
// while it's false).

import { getPaddleClientConfig, type PaddleClientConfig } from "./paddle-env";

export const FREE_TIER_ACTIVE_DEALS = 1;

/** Founder-approved static claim shown next to the yearly toggle. Yearly
 * pricing itself (confirmed: 10x monthly, i.e. 2 months free) lives in
 * Paddle's own prices — this is UI copy only, never used in any
 * calculation, and the page never re-derives or displays "10x"/a computed
 * saving of its own; only Paddle's formattedTotals render as a price. */
export const YEARLY_DISCOUNT_NOTE = "2 months free";

// No existing shared export for this address — app/terms/page.tsx and
// app/refunds/page.tsx both inline "dimas@getbrava.tech" as a JSX literal
// rather than a constant, so there's nothing to import here.
const ENTERPRISE_CONTACT_EMAIL = "dimas@getbrava.tech";
const ENTERPRISE_CONTACT_SUBJECT = "Brava Enterprise";

export interface TierPriceIds {
  readonly month: string | null;
  readonly year: string | null;
}

interface TierCommon {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly features: readonly string[];
  readonly isRecommended: boolean;
  /** null = unlimited. The headline difference the /pricing cards lead
   * with — see TIER_DEFINITIONS below. */
  readonly maxActiveDeals: number | null;
}

/** Sold through the Paddle overlay checkout (app/pricing/pricing-tiers.tsx). */
export interface CheckoutTier extends TierCommon {
  readonly kind: "checkout";
  readonly priceId: TierPriceIds;
}

/** Invoiced directly by the founder — never a Paddle checkout, never a
 * PricePreview request, never gates /pricing's publishable check. */
export interface ContactTier extends TierCommon {
  readonly kind: "contact";
  readonly contactHref: string;
}

export type Tier = CheckoutTier | ContactTier;

export interface PricingModel {
  readonly freeActiveDeals: number;
  readonly tiers: readonly Tier[];
  /** True only when EVERY *checkout* tier has a yearly price ID (see the
   * all-or-none check below) — the /pricing monthly/yearly toggle is all
   * checkout tiers or nothing, never a mix. Enterprise (contact) never
   * participates in this check. */
  readonly hasYearlyPricing: boolean;
  readonly paddle: PaddleClientConfig | null;
  readonly isPublishable: boolean;
}

// ---- founder-editable tier copy -----------------------------------------
// Edit name/description/features/isRecommended/maxActiveDeals freely. `id`
// drives the PADDLE_PRICE_<ID>_MONTH / _YEAR env var names below (see
// .env.example) for every "checkout" tier and must stay a stable, unique,
// UPPER_SNAKE-able slug once real price IDs are wired up in Paddle —
// renaming it later means updating those env vars too. Exactly one tier
// should carry `isRecommended: true` (the tier that gets the page's one
// Signal-styled Subscribe button, per the design guideline's "one Signal per
// decision scope" rule) — tests/components/pricing-tiers.dom.spec.tsx pins
// that invariant, and Enterprise's `contact` kind is additionally hard-
// blocked from ever rendering as Signal regardless of this flag (see
// pricing-tiers.tsx).
//
// maxActiveDeals (null = unlimited): Free 1 (FREE_TIER_ACTIVE_DEALS) /
// Starter 3 / Pro 8 / Advanced unlimited / Enterprise unlimited — all
// confirmed by the founder.
//
// Enterprise's copy is deliberately narrow: it only claims things this
// product can back today (unlimited active deals, invoice/annual-contract
// billing, help with security and vendor reviews, onboarding directly with
// the founder). Do NOT add SSO, SLA, SOC 2, audit logs, dedicated support,
// custom integrations, or anything else not actually built — if the
// founder wants to claim one of those, build it (or get it truthfully
// promise-able) first, then edit this array.
type TierDefinition =
  | (TierCommon & { readonly kind: "checkout" })
  | (TierCommon & { readonly kind: "contact"; readonly contactHref: string });

const TIER_DEFINITIONS: readonly TierDefinition[] = [
  {
    kind: "checkout",
    id: "starter",
    name: "Starter",
    description: "For a seller running their first few plans with buyers.",
    features: ["Unlimited buyer plans", "Buyer portal access", "Email support"],
    isRecommended: false,
    maxActiveDeals: 3,
  },
  {
    kind: "checkout",
    id: "pro",
    name: "Pro",
    description: "For a seller closing deals every week.",
    features: ["Everything in Starter", "CRM sync (HubSpot, Salesforce)", "Priority support"],
    isRecommended: true,
    maxActiveDeals: 8,
  },
  {
    kind: "checkout",
    id: "advanced",
    name: "Advanced",
    description: "For a team running Brava across multiple sellers.",
    features: ["Everything in Pro", "Team workspaces", "Dedicated onboarding"],
    isRecommended: false,
    maxActiveDeals: null,
  },
  {
    kind: "contact",
    id: "enterprise",
    name: "Enterprise",
    description: "For organizations that need to buy on their own terms.",
    features: [
      "Unlimited active deals",
      "Pay by invoice, on an annual contract",
      "Help with your security and vendor review",
      "Onboarding directly with our founder",
    ],
    isRecommended: false,
    maxActiveDeals: null,
    contactHref: `mailto:${ENTERPRISE_CONTACT_EMAIL}?subject=${encodeURIComponent(ENTERPRISE_CONTACT_SUBJECT)}`,
  },
];

/** All tier ids, in definition order. */
export const TIER_IDS: readonly string[] = TIER_DEFINITIONS.map((def) => def.id);

/** Only the ids of tiers actually sold through Paddle checkout — the ones
 * that need a PADDLE_PRICE_<ID>_<CYCLE> env var. Excludes "enterprise". */
export const CHECKOUT_TIER_IDS: readonly string[] = TIER_DEFINITIONS.filter((def) => def.kind === "checkout").map(
  (def) => def.id,
);

/**
 * Pure config lookup (no env involved) for a tier's active-deal cap —
 * exported for the backend paywall lane to import directly rather than
 * re-deriving it from a full getPricingModel() read. `undefined` for an
 * unrecognised tier id (distinct from `null`, which means "unlimited").
 * Works for every tier kind, including "contact" tiers like Enterprise.
 */
export function maxActiveDealsForTier(tierId: string): number | null | undefined {
  return TIER_DEFINITIONS.find((def) => def.id === tierId)?.maxActiveDeals;
}

type BillingCycle = "month" | "year";

function priceEnvVarName(tierId: string, cycle: BillingCycle): string {
  return `PADDLE_PRICE_${tierId.toUpperCase()}_${cycle.toUpperCase()}`;
}

function readPriceId(env: NodeJS.ProcessEnv, tierId: string, cycle: BillingCycle): string | null {
  const raw = env[priceEnvVarName(tierId, cycle)];
  return raw && raw.trim() !== "" ? raw : null;
}

function resolveTier(def: TierDefinition, env: NodeJS.ProcessEnv): Tier {
  const common = { ...def, features: Object.freeze([...def.features]) };

  if (def.kind === "contact") {
    return Object.freeze(common) as ContactTier;
  }

  return Object.freeze({
    ...common,
    priceId: Object.freeze({
      month: readPriceId(env, def.id, "month"),
      year: readPriceId(env, def.id, "year"),
    }),
  }) as CheckoutTier;
}

/**
 * Reads the Paddle client environment/token pair plus every checkout
 * tier's Paddle price IDs from the given env (defaults to process.env) and
 * returns an immutable pricing model. `isPublishable` is false whenever the
 * Paddle client config is missing/invalid, any checkout tier lacks its
 * monthly price ID, or yearly price IDs are configured for only some
 * checkout tiers (a genuine misconfiguration, not a supported partial
 * state). Enterprise (a "contact" tier) never affects this gate — it needs
 * no Paddle price ID at all.
 */
export function getPricingModel(env: NodeJS.ProcessEnv = process.env): PricingModel {
  const paddle = getPaddleClientConfig(env);
  const tiers = TIER_DEFINITIONS.map((def) => resolveTier(def, env));
  const checkoutTiers = tiers.filter((tier): tier is CheckoutTier => tier.kind === "checkout");

  const everyCheckoutTierHasMonthPrice = checkoutTiers.every((tier) => tier.priceId.month !== null);
  if (!everyCheckoutTierHasMonthPrice) {
    console.error(
      "[billing-plans] one or more checkout tiers is missing its PADDLE_PRICE_<TIER>_MONTH env var — " +
        "pricing stays unpublishable",
    );
  }

  const tiersWithYearPrice = checkoutTiers.filter((tier) => tier.priceId.year !== null).length;
  const yearlyConfigIsConsistent = tiersWithYearPrice === 0 || tiersWithYearPrice === checkoutTiers.length;
  if (!yearlyConfigIsConsistent) {
    console.error(
      "[billing-plans] inconsistent yearly Paddle price configuration — some checkout tiers have a " +
        "PADDLE_PRICE_<TIER>_YEAR env var and some don't; set all of them or none",
    );
  }

  return Object.freeze({
    freeActiveDeals: FREE_TIER_ACTIVE_DEALS,
    tiers: Object.freeze(tiers),
    hasYearlyPricing: yearlyConfigIsConsistent && tiersWithYearPrice === checkoutTiers.length && checkoutTiers.length > 0,
    paddle,
    isPublishable: paddle !== null && everyCheckoutTierHasMonthPrice && yearlyConfigIsConsistent,
  });
}
