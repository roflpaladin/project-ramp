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

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PricingModel } from "@/lib/billing/plans";

const { mockGetPricingModel } = vi.hoisted(() => ({ mockGetPricingModel: vi.fn() }));
vi.mock("@/lib/billing/plans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/plans")>();
  return { ...actual, getPricingModel: mockGetPricingModel };
});

const { mockRequireSeller } = vi.hoisted(() => ({ mockRequireSeller: vi.fn() }));
vi.mock("@/lib/plans/require-seller", () => ({ requireSeller: mockRequireSeller }));

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

afterEach(() => {
  cleanup();
  mockGetPricingModel.mockReset();
  mockRequireSeller.mockReset();
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
    expect(props.tenantId).toBeNull();
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
  it("threads the signed-in seller's email and tenant id through to PricingTiers", async () => {
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
    expect(props.tenantId).toBe("tenant-1");
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
