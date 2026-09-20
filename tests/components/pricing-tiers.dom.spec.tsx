// Sprint 12, Ticket 67 (slice 1, founder scope amendment — Paddle overlay
// checkout). Component-level DOM assertions for app/pricing/pricing-tiers.tsx
// (PricingTiers), the client piece of /pricing that talks to Paddle.js.
// Runs under the "components" Vitest project (happy-dom) — see
// vitest.config.ts. @paddle/paddle-js and next-themes are mocked wholesale
// (house style — see tests/components/hubspot-connection-card.dom.spec.tsx's
// note on mocking a framework-boundary module wholesale): this file can't
// verify a real Paddle checkout (no sandbox tokens/price IDs exist yet —
// see the ticket report), only that this component calls Paddle.js exactly
// the way the founder's brief specifies.
//
// Coverage: Paddle initialized with the given environment/token; each
// tier's PricePreview-formatted price renders VERBATIM (no reformatting);
// the visitor's country code is forwarded when present and the address
// field is omitted entirely when absent (no sentinel ever reaches Paddle);
// each tier's active-deal cap renders as the headline difference; exactly
// one Signal-styled Subscribe action exists (the recommended tier); signed-
// out Subscribe is a plain /register link (no Checkout.open call); signed-in
// Subscribe opens the overlay with the exact price ID for the selected
// tier/cycle, one-page overlay settings, /welcome successUrl, and the
// signed-in email + tenant customData; the yearly toggle is hidden when
// hasYearlyPricing is false and re-queries PricePreview with yearly price
// IDs when toggled.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CheckoutTier, ContactTier } from "@/lib/billing/plans";

const { mockInitializePaddle, mockPricePreview, mockCheckoutOpen } = vi.hoisted(() => ({
  mockInitializePaddle: vi.fn(),
  mockPricePreview: vi.fn(),
  mockCheckoutOpen: vi.fn(),
}));

vi.mock("@paddle/paddle-js", () => ({
  initializePaddle: mockInitializePaddle,
}));

const { mockUseTheme } = vi.hoisted(() => ({
  mockUseTheme: vi.fn(() => ({ resolvedTheme: "light" })),
}));

vi.mock("next-themes", () => ({ useTheme: mockUseTheme }));

const { PricingTiers } = await import("@/app/pricing/pricing-tiers");

const STARTER_TIER: CheckoutTier = {
  kind: "checkout",
  id: "starter",
  name: "Starter",
  description: "For a seller running their first few plans with buyers.",
  features: ["Unlimited buyer plans"],
  isRecommended: false,
  maxActiveDeals: 3,
  priceId: { month: "pri_starter_month", year: "pri_starter_year" },
};

const PRO_TIER: CheckoutTier = {
  kind: "checkout",
  id: "pro",
  name: "Pro",
  description: "For a seller closing deals every week.",
  features: ["Everything in Starter"],
  isRecommended: true,
  maxActiveDeals: 8,
  priceId: { month: "pri_pro_month", year: "pri_pro_year" },
};

const ADVANCED_TIER: CheckoutTier = {
  kind: "checkout",
  id: "advanced",
  name: "Advanced",
  description: "For a team running Brava across multiple sellers.",
  features: ["Everything in Pro"],
  isRecommended: false,
  maxActiveDeals: null,
  priceId: { month: "pri_advanced_month", year: "pri_advanced_year" },
};

const ENTERPRISE_TIER: ContactTier = {
  kind: "contact",
  id: "enterprise",
  name: "Enterprise",
  description: "For organizations that need to buy on their own terms.",
  features: ["Unlimited active deals", "Pay by invoice"],
  isRecommended: false,
  maxActiveDeals: null,
  contactHref: "mailto:dimas@getbrava.tech?subject=Brava%20Enterprise",
};

const TIERS = [STARTER_TIER, PRO_TIER, ADVANCED_TIER, ENTERPRISE_TIER];

interface PricePreviewEntry {
  priceId: string;
  total: string;
}

function pricePreviewResponse(entries: PricePreviewEntry[]) {
  return {
    data: {
      details: {
        lineItems: entries.map(({ priceId, total }) => ({
          price: { id: priceId },
          formattedTotals: { total, subtotal: total, tax: "$0.00", discount: "$0.00" },
        })),
      },
    },
  };
}

const MONTHLY_PRICES: PricePreviewEntry[] = [
  { priceId: "pri_starter_month", total: "$12.00" },
  { priceId: "pri_pro_month", total: "$29.00" },
  { priceId: "pri_advanced_month", total: "$79.00" },
];

const YEARLY_PRICES: PricePreviewEntry[] = [
  { priceId: "pri_starter_year", total: "$120.00" },
  { priceId: "pri_pro_year", total: "$290.00" },
  { priceId: "pri_advanced_year", total: "$790.00" },
];

const mockPaddleInstance = { PricePreview: mockPricePreview, Checkout: { open: mockCheckoutOpen } };

beforeEach(() => {
  mockInitializePaddle.mockResolvedValue(mockPaddleInstance);
  mockPricePreview.mockResolvedValue(pricePreviewResponse(MONTHLY_PRICES));
});

afterEach(() => {
  cleanup();
  mockInitializePaddle.mockReset();
  mockPricePreview.mockReset();
  mockCheckoutOpen.mockReset();
});

function renderTiers(overrides: Partial<React.ComponentProps<typeof PricingTiers>> = {}) {
  return render(
    <PricingTiers
      tiers={TIERS}
      hasYearlyPricing={false}
      paddleEnvironment="sandbox"
      paddleClientToken="test_abc123"
      countryCode={null}
      signedInEmail={null}
      tenantId={null}
      {...overrides}
    />,
  );
}

describe("PricingTiers — Paddle initialization and price preview", () => {
  it("initializes Paddle with the given environment and client token", async () => {
    renderTiers({ paddleEnvironment: "sandbox", paddleClientToken: "test_xyz" });

    await waitFor(() => {
      expect(mockInitializePaddle).toHaveBeenCalledWith({ environment: "sandbox", token: "test_xyz" });
    });
  });

  it("renders each tier's Paddle-formatted price verbatim, without reformatting", async () => {
    renderTiers();

    expect(await screen.findByText("$12.00")).toBeInTheDocument();
    expect(await screen.findByText("$29.00")).toBeInTheDocument();
    expect(await screen.findByText("$79.00")).toBeInTheDocument();
  });

  it("shows a loading placeholder before Paddle resolves a price", () => {
    renderTiers();
    expect(within(screen.getByTestId("pr-tier-starter")).getByText(/loading price/i)).toBeInTheDocument();
  });

  it("requests PricePreview with the visitor's country code when present", async () => {
    renderTiers({ countryCode: "DE" });

    await waitFor(() => {
      expect(mockPricePreview).toHaveBeenCalledWith(expect.objectContaining({ address: { countryCode: "DE" } }));
    });
  });

  it("omits the address field entirely when the country code is null (no sentinel ever reaches Paddle)", async () => {
    renderTiers({ countryCode: null });

    await waitFor(() => expect(mockPricePreview).toHaveBeenCalled());
    const [callArgs] = mockPricePreview.mock.calls[0];
    expect(callArgs).not.toHaveProperty("address");
  });
});

describe("PricingTiers — active-deal caps", () => {
  it("shows each tier's active-deal cap as the headline difference", async () => {
    renderTiers();

    expect(within(screen.getByTestId("pr-tier-starter")).getByText(/up to 3 active deals/i)).toBeInTheDocument();
    expect(within(screen.getByTestId("pr-tier-pro")).getByText(/up to 8 active deals/i)).toBeInTheDocument();
    expect(within(screen.getByTestId("pr-tier-advanced")).getByText(/unlimited active deals/i)).toBeInTheDocument();
  });
});

describe("PricingTiers — one Signal per decision scope", () => {
  it("renders exactly one Signal-styled Subscribe action, on the recommended tier", async () => {
    const { container } = renderTiers({ signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    const signals = container.querySelectorAll('[data-signal="true"]');
    expect(signals).toHaveLength(1);
    expect(within(screen.getByTestId("pr-tier-pro")).getByRole("button", { name: /subscribe/i })).toHaveAttribute(
      "data-signal",
      "true",
    );
  });
});

describe("PricingTiers — signed-out visitor", () => {
  it("renders Subscribe as a link to /register with an internal-only return path, never opening Checkout", async () => {
    renderTiers({ signedInEmail: null });
    await screen.findByText("$29.00");

    const link = within(screen.getByTestId("pr-tier-pro")).getByRole("link", { name: /sign up to subscribe/i });
    expect(link).toHaveAttribute("href", "/register?next=%2Fpricing");

    fireEvent.click(link);
    expect(mockCheckoutOpen).not.toHaveBeenCalled();
  });
});

describe("PricingTiers — signed-in visitor", () => {
  it("opens Paddle Checkout with the exact price ID, overlay settings, successUrl, email and tenant customData", async () => {
    renderTiers({ signedInEmail: "seller@example.com", tenantId: "tenant-1" });
    await screen.findByText("$29.00");

    const button = within(screen.getByTestId("pr-tier-pro")).getByRole("button", { name: /subscribe/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    expect(mockCheckoutOpen).toHaveBeenCalledWith({
      items: [{ priceId: "pri_pro_month", quantity: 1 }],
      settings: {
        displayMode: "overlay",
        variant: "one-page",
        successUrl: "/welcome",
        theme: "light",
      },
      customer: { email: "seller@example.com" },
      customData: { tenantId: "tenant-1" },
    });
  });

  it("disables Subscribe until a price has actually loaded", () => {
    renderTiers({ signedInEmail: "seller@example.com" });
    const button = within(screen.getByTestId("pr-tier-pro")).getByRole("button", { name: /subscribe/i });
    expect(button).toBeDisabled();
  });
});

describe("PricingTiers — monthly/yearly toggle", () => {
  it("hides the toggle entirely when hasYearlyPricing is false", async () => {
    renderTiers({ hasYearlyPricing: false });
    await screen.findByText("$29.00");

    expect(screen.queryByRole("group", { name: /billing cycle/i })).not.toBeInTheDocument();
  });

  it("shows the founder-approved yearly-savings note alongside the toggle", async () => {
    renderTiers({ hasYearlyPricing: true });
    await screen.findByText("$29.00");

    expect(screen.getByText("2 months free")).toBeInTheDocument();
  });

  it("re-queries PricePreview with yearly price IDs and renders the new totals when toggled", async () => {
    mockPricePreview
      .mockResolvedValueOnce(pricePreviewResponse(MONTHLY_PRICES))
      .mockResolvedValueOnce(pricePreviewResponse(YEARLY_PRICES));

    renderTiers({ hasYearlyPricing: true });
    await screen.findByText("$29.00");

    fireEvent.click(screen.getByRole("button", { name: "Yearly" }));

    expect(await screen.findByText("$290.00")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockPricePreview).toHaveBeenLastCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([{ priceId: "pri_pro_year", quantity: 1 }]),
        }),
      );
    });
  });

  it("never affects the Enterprise card, which stays 'Custom' through a toggle", async () => {
    mockPricePreview
      .mockResolvedValueOnce(pricePreviewResponse(MONTHLY_PRICES))
      .mockResolvedValueOnce(pricePreviewResponse(YEARLY_PRICES));

    renderTiers({ hasYearlyPricing: true });
    await screen.findByText("$29.00");
    expect(within(screen.getByTestId("pr-tier-enterprise")).getByText("Custom")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
    await screen.findByText("$290.00");

    expect(within(screen.getByTestId("pr-tier-enterprise")).getByText("Custom")).toBeInTheDocument();
  });
});

describe("PricingTiers — Enterprise (contact) tier", () => {
  it("shows 'Custom' instead of a Paddle price", async () => {
    renderTiers();
    await screen.findByText("$29.00");

    expect(within(screen.getByTestId("pr-tier-enterprise")).getByText("Custom")).toBeInTheDocument();
  });

  it("never appears in the PricePreview request", async () => {
    renderTiers();

    await waitFor(() => expect(mockPricePreview).toHaveBeenCalled());
    const [{ items }] = mockPricePreview.mock.calls[0];
    const requestedPriceIds: string[] = items.map((item: { priceId: string }) => item.priceId);

    expect(requestedPriceIds.some((id) => id.includes("enterprise"))).toBe(false);
    expect(requestedPriceIds).toEqual(["pri_starter_month", "pri_pro_month", "pri_advanced_month"]);
  });

  it("renders 'Talk to us' as a mailto link, never a Checkout-triggering button, even when signed in", async () => {
    renderTiers({ signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    const link = within(screen.getByTestId("pr-tier-enterprise")).getByRole("link", { name: /talk to us/i });
    expect(link).toHaveAttribute("href", "mailto:dimas@getbrava.tech?subject=Brava%20Enterprise");
    expect(link).not.toHaveAttribute("data-signal");

    fireEvent.click(link);
    expect(mockCheckoutOpen).not.toHaveBeenCalled();
  });

  it("is never Signal-styled even though it renders alongside the recommended Pro tier", async () => {
    const { container } = renderTiers();
    await screen.findByText("$29.00");

    const enterpriseCard = screen.getByTestId("pr-tier-enterprise");
    expect(enterpriseCard.querySelector('[data-signal="true"]')).toBeNull();
    // Exactly one Signal element total, on Pro (the recommended tier) — see
    // the "one Signal per decision scope" describe block above for the
    // dedicated assertion; this just confirms Enterprise contributes none.
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });
});
