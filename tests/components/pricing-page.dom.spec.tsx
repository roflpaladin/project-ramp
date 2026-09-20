// Sprint 12, Ticket 67 (slice 1, founder scope amendment — Paddle overlay
// checkout). Component-level DOM assertions for app/pricing/page.tsx, the
// Server Component that gates /pricing behind lib/billing/plans's
// isPublishable and threads the resolved model, the visitor's country, and
// the signed-in seller's identity down to PricingTiers.
//
// app/pricing/pricing-tiers.tsx (PricingTiers) is mocked wholesale here —
// its own Paddle.js interactions are covered in
// tests/components/pricing-tiers.dom.spec.tsx — so this file only exercises
// the page's own logic: the publishable gate (notFound()), metadata, the
// free-tier line, seller-identity threading, and the country-header read.
// lib/plans/require-seller and next/headers are mocked wholesale, matching
// this codebase's house style for framework/auth-boundary modules (see
// tests/components/landing-page.dom.spec.tsx's next/headers mock and
// tests/components/hubspot-connection-card.dom.spec.tsx's note on the
// pattern generally).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PricingModel } from "@/lib/billing/plans";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

const { mockGetPricingModel } = vi.hoisted(() => ({ mockGetPricingModel: vi.fn() }));
vi.mock("@/lib/billing/plans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/plans")>();
  return { ...actual, getPricingModel: mockGetPricingModel };
});

const { mockRequireSeller } = vi.hoisted(() => ({ mockRequireSeller: vi.fn() }));
vi.mock("@/lib/plans/require-seller", () => ({ requireSeller: mockRequireSeller }));

const { mockFindByTenantId } = vi.hoisted(() => ({ mockFindByTenantId: vi.fn() }));
vi.mock("@/lib/billing/subscription-repository", () => ({ findByTenantId: mockFindByTenantId }));

const { mockNotFound } = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mockNotFound }));

const { mockHeadersGet } = vi.hoisted(() => ({ mockHeadersGet: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: mockHeadersGet }),
}));

vi.mock("@/app/pricing/pricing-tiers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PricingTiers: (props: any) => <div data-testid="mock-pricing-tiers" data-props={JSON.stringify(props)} />,
}));

const { default: PricingPage } = await import("@/app/pricing/page");

const PUBLISHABLE_MODEL: PricingModel = {
  freeActiveDeals: 1,
  tiers: [
    {
      kind: "checkout",
      id: "starter",
      name: "Starter",
      description: "For a seller running their first few plans with buyers.",
      features: ["Unlimited buyer plans"],
      isRecommended: false,
      maxActiveDeals: 3,
      priceId: { month: "pri_starter_month", year: null },
    },
    {
      kind: "checkout",
      id: "pro",
      name: "Pro",
      description: "For a seller closing deals every week.",
      features: ["Everything in Starter"],
      isRecommended: true,
      maxActiveDeals: 8,
      priceId: { month: "pri_pro_month", year: null },
    },
    {
      kind: "contact",
      id: "enterprise",
      name: "Enterprise",
      description: "For organizations that need to buy on their own terms.",
      features: ["Unlimited active deals"],
      isRecommended: false,
      maxActiveDeals: null,
      contactHref: "mailto:dimas@getbrava.tech?subject=Brava%20Enterprise",
    },
  ],
  hasYearlyPricing: false,
  paddle: { environment: "sandbox", clientToken: "test_abc123" },
  isPublishable: true,
};

beforeEach(() => {
  // T59 slice 2 — the page now also reads the tenant's subscription. Default
  // to "no subscription" so every pre-existing test (which never sets this
  // up) keeps rendering the same signed-out/no-tenant behaviour it always did.
  mockFindByTenantId.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  mockGetPricingModel.mockReset();
  mockRequireSeller.mockReset();
  mockFindByTenantId.mockReset();
  mockNotFound.mockClear();
  mockHeadersGet.mockReset();
});

function mockCountryHeader(value: string | null) {
  mockHeadersGet.mockImplementation((name: string) => (name === "x-vercel-ip-country" ? value : null));
}

describe("PricingPage — publishable gate", () => {
  it("calls notFound() and never reaches PricingTiers when pricing is not publishable", async () => {
    mockGetPricingModel.mockReturnValue({ ...PUBLISHABLE_MODEL, isPublishable: false, paddle: null });
    mockRequireSeller.mockResolvedValue(null);
    mockCountryHeader(null);

    await expect(PricingPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });
});

describe("PricingPage — publishable, signed-out visitor", () => {
  it("renders the free-tier line and passes tiers/paddle config/country to PricingTiers", async () => {
    mockGetPricingModel.mockReturnValue(PUBLISHABLE_MODEL);
    mockRequireSeller.mockResolvedValue(null);
    mockCountryHeader("DE");

    render(await PricingPage());

    expect(screen.getByTestId("pricing-page")).toHaveTextContent(/1 free active deal/i);

    const props = JSON.parse(screen.getByTestId("mock-pricing-tiers").getAttribute("data-props") ?? "{}");
    expect(props.tiers).toHaveLength(3);
    expect(props.hasYearlyPricing).toBe(false);
    expect(props.paddleEnvironment).toBe("sandbox");
    expect(props.paddleClientToken).toBe("test_abc123");
    expect(props.countryCode).toBe("DE");
    expect(props.signedInEmail).toBeNull();
    // Sprint 12, Ticket 59: the tenant id is no longer a prop at all — the
    // browser must never hold (or be able to tamper with) one. See
    // app/pricing/checkout-actions.ts.
    expect(props.tenantId).toBeUndefined();
  });

  it("omits the country code when the x-vercel-ip-country header is absent", async () => {
    mockGetPricingModel.mockReturnValue(PUBLISHABLE_MODEL);
    mockRequireSeller.mockResolvedValue(null);
    mockCountryHeader(null);

    render(await PricingPage());

    const props = JSON.parse(screen.getByTestId("mock-pricing-tiers").getAttribute("data-props") ?? "{}");
    expect(props.countryCode).toBeNull();
  });
});

describe("PricingPage — publishable, signed-in seller", () => {
  it("threads the signed-in seller's email — and no tenant id — through to PricingTiers", async () => {
    mockGetPricingModel.mockReturnValue(PUBLISHABLE_MODEL);
    mockRequireSeller.mockResolvedValue({
      client: {},
      userId: "user-1",
      email: "seller@example.com",
      tenantId: "tenant-1",
    });
    mockCountryHeader(null);

    render(await PricingPage());

    const props = JSON.parse(screen.getByTestId("mock-pricing-tiers").getAttribute("data-props") ?? "{}");
    expect(props.signedInEmail).toBe("seller@example.com");
    expect(props.tenantId).toBeUndefined();
  });
});

// T59 slice 2 — no double-billing: the page resolves the tenant's own
// subscription and passes down currentTierId/hasLiveSubscription/
// isManualTenant so PricingTiers can never open a second checkout.
describe("PricingPage — no double-billing (current plan / manual tenant)", () => {
  const SIGNED_IN_SELLER = { client: {}, userId: "user-1", email: "seller@example.com", tenantId: "tenant-1" };

  function liveSubscription(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
    return {
      tenantId: "tenant-1",
      paddleCustomerId: "ctm_1",
      paddleSubscriptionId: "sub_1",
      tierId: "pro",
      billingCycle: "month",
      status: "active",
      currentPeriodEndsAt: "2026-10-20T00:00:00.000Z",
      scheduledChange: null,
      pastDueSince: null,
      lastEventOccurredAt: "2026-09-20T10:00:00.000Z",
      manualEntitlementTier: null,
      manualEntitlementNote: null,
      ...overrides,
    };
  }

  it("passes null/false/false when the tenant has never subscribed", async () => {
    mockGetPricingModel.mockReturnValue(PUBLISHABLE_MODEL);
    mockRequireSeller.mockResolvedValue(SIGNED_IN_SELLER);
    mockFindByTenantId.mockResolvedValue(null);
    mockCountryHeader(null);

    render(await PricingPage());

    const props = JSON.parse(screen.getByTestId("mock-pricing-tiers").getAttribute("data-props") ?? "{}");
    expect(props.currentTierId).toBeNull();
    expect(props.hasLiveSubscription).toBe(false);
    expect(props.isManualTenant).toBe(false);
  });

  it("passes the subscribed tier id and hasLiveSubscription=true for an active subscription", async () => {
    mockGetPricingModel.mockReturnValue(PUBLISHABLE_MODEL);
    mockRequireSeller.mockResolvedValue(SIGNED_IN_SELLER);
    mockFindByTenantId.mockResolvedValue(liveSubscription({ tierId: "pro", status: "active" }));
    mockCountryHeader(null);

    render(await PricingPage());

    const props = JSON.parse(screen.getByTestId("mock-pricing-tiers").getAttribute("data-props") ?? "{}");
    expect(props.currentTierId).toBe("pro");
    expect(props.hasLiveSubscription).toBe(true);
  });

  it("still reports hasLiveSubscription=true for a PAUSED subscription (a live Paddle record, even though entitlement itself is free)", async () => {
    mockGetPricingModel.mockReturnValue(PUBLISHABLE_MODEL);
    mockRequireSeller.mockResolvedValue(SIGNED_IN_SELLER);
    mockFindByTenantId.mockResolvedValue(liveSubscription({ tierId: "pro", status: "paused" }));
    mockCountryHeader(null);

    render(await PricingPage());

    const props = JSON.parse(screen.getByTestId("mock-pricing-tiers").getAttribute("data-props") ?? "{}");
    expect(props.currentTierId).toBe("pro");
    expect(props.hasLiveSubscription).toBe(true);
  });

  it("reports hasLiveSubscription=false for a canceled subscription — a new checkout is allowed again", async () => {
    mockGetPricingModel.mockReturnValue(PUBLISHABLE_MODEL);
    mockRequireSeller.mockResolvedValue(SIGNED_IN_SELLER);
    mockFindByTenantId.mockResolvedValue(liveSubscription({ status: "canceled" }));
    mockCountryHeader(null);

    render(await PricingPage());

    const props = JSON.parse(screen.getByTestId("mock-pricing-tiers").getAttribute("data-props") ?? "{}");
    expect(props.currentTierId).toBeNull();
    expect(props.hasLiveSubscription).toBe(false);
  });

  it("passes isManualTenant=true for an invoiced tenant", async () => {
    mockGetPricingModel.mockReturnValue(PUBLISHABLE_MODEL);
    mockRequireSeller.mockResolvedValue(SIGNED_IN_SELLER);
    mockFindByTenantId.mockResolvedValue(liveSubscription({ manualEntitlementTier: "enterprise" }));
    mockCountryHeader(null);

    render(await PricingPage());

    const props = JSON.parse(screen.getByTestId("mock-pricing-tiers").getAttribute("data-props") ?? "{}");
    expect(props.isManualTenant).toBe(true);
  });
});

describe("PricingPage — footer nav", () => {
  it("renders Home/Pricing/Terms/Privacy/Refunds and never Security", async () => {
    mockGetPricingModel.mockReturnValue(PUBLISHABLE_MODEL);
    mockRequireSeller.mockResolvedValue(null);
    mockCountryHeader(null);

    render(await PricingPage());

    expect(screen.getByRole("link", { name: /^pricing$/i })).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("link", { name: /^terms$/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /security/i })).not.toBeInTheDocument();
  });
});

describe("PricingPage — metadata", () => {
  it("names Brava and never references getbrava.io", async () => {
    const { metadata } = await import("@/app/pricing/page");
    const text = `${metadata.title} ${metadata.description}`;

    expect(text).toMatch(/brava/i);
    expect(text).not.toMatch(/getbrava\.io/i);
  });
});
