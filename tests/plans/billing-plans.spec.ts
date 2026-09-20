// Sprint 12, Ticket 67 (slice 1 — Paddle onboarding step 1, "build your
// pricing page"). Unit coverage for lib/billing/plans.ts, the single config
// module the /pricing page (and, later, checkout and the paywall) read
// pricing numbers from.
//
// Founder scope amendments folded in mid-ticket, in order:
//   1. Prices now come from Paddle (PricePreview), not env-configured
//      dollar amounts — this module holds tier config plus each checkout
//      tier's Paddle price IDs (PADDLE_PRICE_<TIER_ID>_<CYCLE> env vars).
//   2. Three confirmed tiers (Starter/Pro/Advanced) replace the PRD's
//      per-deal metered model; each carries a confirmed maxActiveDeals cap.
//   3. A fourth tier, Enterprise, is NOT sold through Paddle checkout — it's
//      invoiced directly by the founder. Tier is now a discriminated union
//      on `kind`: "checkout" (has priceId, goes through Paddle) vs
//      "contact" (no priceId, has a mailto contactHref instead). Enterprise
//      must never participate in the Paddle price-ID publishable gate, the
//      monthly/yearly consistency check, or a PricePreview request.
// FREE_TIER_ACTIVE_DEALS and the never-throws, env-injectable shape
// (mirroring lib/plans/stall-threshold.ts) carry over unchanged throughout.

import { describe, expect, it, vi } from "vitest";

import {
  CHECKOUT_TIER_IDS,
  FREE_TIER_ACTIVE_DEALS,
  getPricingModel,
  maxActiveDealsForTier,
  TIER_IDS,
  YEARLY_DISCOUNT_NOTE,
} from "@/lib/billing/plans";

const VALID_PADDLE_ENV = {
  NEXT_PUBLIC_PADDLE_ENV: "sandbox",
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_abc123",
};

function priceEnvVar(tierId: string, cycle: "MONTH" | "YEAR"): string {
  return `PADDLE_PRICE_${tierId.toUpperCase()}_${cycle}`;
}

function envWithAllMonthPrices(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const monthPrices = Object.fromEntries(
    CHECKOUT_TIER_IDS.map((id) => [priceEnvVar(id, "MONTH"), `pri_${id}_month`]),
  );
  return { ...process.env, ...VALID_PADDLE_ENV, ...monthPrices, ...overrides } as NodeJS.ProcessEnv;
}

function envWithAllYearPrices(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const yearPrices = Object.fromEntries(CHECKOUT_TIER_IDS.map((id) => [priceEnvVar(id, "YEAR"), `pri_${id}_year`]));
  return { ...base, ...yearPrices };
}

describe("getPricingModel", () => {
  it("is publishable when the Paddle env pair and every checkout tier's monthly price ID are present", () => {
    const model = getPricingModel(envWithAllMonthPrices());

    expect(model.isPublishable).toBe(true);
    expect(model.freeActiveDeals).toBe(FREE_TIER_ACTIVE_DEALS);
    expect(model.tiers).toHaveLength(TIER_IDS.length);
    expect(model.paddle).toEqual({ environment: "sandbox", clientToken: "test_abc123" });
  });

  it("resolves each checkout tier's monthly price ID from its own PADDLE_PRICE_<TIER>_MONTH env var", () => {
    const model = getPricingModel(envWithAllMonthPrices());

    for (const tier of model.tiers) {
      if (tier.kind === "checkout") {
        expect(tier.priceId.month).toBe(`pri_${tier.id}_month`);
      }
    }
  });

  it("carries founder-editable tier copy (name, description, at least one feature) for every tier", () => {
    const model = getPricingModel(envWithAllMonthPrices());

    for (const tier of model.tiers) {
      expect(tier.name.length).toBeGreaterThan(0);
      expect(tier.description.length).toBeGreaterThan(0);
      expect(tier.features.length).toBeGreaterThan(0);
    }
  });

  it("marks exactly one tier as recommended", () => {
    const model = getPricingModel(envWithAllMonthPrices());
    expect(model.tiers.filter((tier) => tier.isRecommended)).toHaveLength(1);
  });

  it("carries each tier's maxActiveDeals through to the resolved model", () => {
    const model = getPricingModel(envWithAllMonthPrices());

    for (const tier of model.tiers) {
      expect(tier.maxActiveDeals).toBe(maxActiveDealsForTier(tier.id));
    }
  });

  it("is not publishable when the Paddle env/token pair is missing, even if every price ID is set", () => {
    const model = getPricingModel(
      envWithAllMonthPrices({ NEXT_PUBLIC_PADDLE_ENV: undefined, NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: undefined }),
    );

    expect(model.isPublishable).toBe(false);
    expect(model.paddle).toBeNull();
  });

  it("is not publishable when any single checkout tier is missing its monthly price ID", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const [firstTierId] = CHECKOUT_TIER_IDS;
    const model = getPricingModel(envWithAllMonthPrices({ [priceEnvVar(firstTierId, "MONTH")]: undefined }));

    expect(model.isPublishable).toBe(false);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("has no yearly pricing when no yearly env vars are set", () => {
    const model = getPricingModel(envWithAllMonthPrices());

    expect(model.hasYearlyPricing).toBe(false);
    for (const tier of model.tiers) {
      if (tier.kind === "checkout") expect(tier.priceId.year).toBeNull();
    }
  });

  it("has yearly pricing when every checkout tier's yearly price ID is set", () => {
    const model = getPricingModel(envWithAllYearPrices(envWithAllMonthPrices()));

    expect(model.hasYearlyPricing).toBe(true);
    for (const tier of model.tiers) {
      if (tier.kind === "checkout") expect(tier.priceId.year).toBe(`pri_${tier.id}_year`);
    }
    expect(model.isPublishable).toBe(true);
  });

  it("is not publishable and logs when only SOME checkout tiers have a yearly price ID (inconsistent config)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const [firstTierId] = CHECKOUT_TIER_IDS;
    const base = envWithAllMonthPrices();
    const partiallyYearly = { ...base, [priceEnvVar(firstTierId, "YEAR")]: `pri_${firstTierId}_year` };

    const model = getPricingModel(partiallyYearly);

    expect(model.isPublishable).toBe(false);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("never throws for any combination of missing/malformed env vars", () => {
    expect(() => getPricingModel({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("returns a frozen (immutable) model whose tiers and features are also frozen", () => {
    const model = getPricingModel(envWithAllMonthPrices());

    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.tiers)).toBe(true);
    expect(Object.isFrozen(model.tiers[0])).toBe(true);
    expect(Object.isFrozen(model.tiers[0].features)).toBe(true);
    expect(() => {
      (model as { isPublishable: boolean }).isPublishable = false;
    }).toThrow();
  });

  it("defaults to reading process.env when no env object is injected", () => {
    const injected = envWithAllMonthPrices();
    const originalEntries = Object.entries(injected).map(([key, value]) => [key, process.env[key]] as const);

    for (const [key, value] of Object.entries(injected)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    expect(getPricingModel().isPublishable).toBe(true);

    for (const [key, original] of originalEntries) {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });
});

// Founder ruling: Enterprise is invoiced directly, never sold through
// Paddle checkout — it must sit entirely outside the Paddle price-ID
// publishable gate, and never require or expose a Paddle price ID.
describe("getPricingModel — Enterprise (contact) tier", () => {
  it("is present, kind: 'contact', with no priceId field at all", () => {
    const model = getPricingModel(envWithAllMonthPrices());
    const enterprise = model.tiers.find((tier) => tier.id === "enterprise");

    expect(enterprise).toBeDefined();
    expect(enterprise?.kind).toBe("contact");
    expect(enterprise).not.toHaveProperty("priceId");
  });

  it("has a mailto contactHref addressed to the founder with an Enterprise subject", () => {
    const model = getPricingModel(envWithAllMonthPrices());
    const enterprise = model.tiers.find((tier) => tier.id === "enterprise");

    expect(enterprise?.kind === "contact" && enterprise.contactHref).toBe(
      "mailto:dimas@getbrava.tech?subject=Brava%20Enterprise",
    );
  });

  it("has unlimited (null) maxActiveDeals", () => {
    expect(maxActiveDealsForTier("enterprise")).toBeNull();
  });

  it("is never the recommended tier", () => {
    const model = getPricingModel(envWithAllMonthPrices());
    const enterprise = model.tiers.find((tier) => tier.id === "enterprise");

    expect(enterprise?.isRecommended).toBe(false);
  });

  it("does not block /pricing from being publishable — it needs no price ID", () => {
    // envWithAllMonthPrices only sets price envs for CHECKOUT_TIER_IDS,
    // which deliberately excludes "enterprise" — if this model is
    // publishable, Enterprise's absence from the price-ID env vars didn't
    // block it.
    const model = getPricingModel(envWithAllMonthPrices());
    expect(model.isPublishable).toBe(true);
    expect(CHECKOUT_TIER_IDS).not.toContain("enterprise");
  });

  it("is excluded from the yearly price consistency check", () => {
    // Every checkout tier has a yearly price; Enterprise (contact) has none
    // and must not be treated as "missing" for the all-or-none check.
    const model = getPricingModel(envWithAllYearPrices(envWithAllMonthPrices()));
    expect(model.hasYearlyPricing).toBe(true);
    expect(model.isPublishable).toBe(true);
  });
});

describe("maxActiveDealsForTier", () => {
  it("returns the confirmed cap for Starter (3)", () => {
    expect(maxActiveDealsForTier("starter")).toBe(3);
  });

  it("returns the confirmed cap for Pro (8)", () => {
    expect(maxActiveDealsForTier("pro")).toBe(8);
  });

  it("returns null (unlimited) for the Advanced tier", () => {
    expect(maxActiveDealsForTier("advanced")).toBeNull();
  });

  it("returns null (unlimited) for the Enterprise tier", () => {
    expect(maxActiveDealsForTier("enterprise")).toBeNull();
  });

  it("returns undefined for an unknown tier id, never throwing", () => {
    expect(maxActiveDealsForTier("nonexistent-tier")).toBeUndefined();
  });
});

describe("YEARLY_DISCOUNT_NOTE", () => {
  it("is the founder-approved static yearly-savings claim", () => {
    expect(YEARLY_DISCOUNT_NOTE).toBe("2 months free");
  });
});
