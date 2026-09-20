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
// tier/cycle, one-page overlay settings, /welcome successUrl, the signed-in
// email, and (Sprint 12, Ticket 59) the SERVER-ISSUED checkoutRef as
// customData — never a tenant id; the yearly toggle is hidden when
// hasYearlyPricing is false and re-queries PricePreview with yearly price
// IDs when toggled.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// Sprint 12, Ticket 59 — the server action that issues the checkout
// reference. Mocked wholesale (same house style as @paddle/paddle-js
// above): it is a "use server" module whose real implementation reaches for
// a Supabase session, and its own behaviour is covered server-side. What
// this file proves is that the component sends the returned reference — and
// never a tenant id — to Paddle.
const { mockIssueCheckoutRef } = vi.hoisted(() => ({ mockIssueCheckoutRef: vi.fn() }));

vi.mock("@/app/pricing/checkout-actions", () => ({ issueCheckoutRefAction: mockIssueCheckoutRef }));

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
  subtotal: string;
  tax: string;
  total: string;
  /** Raw (unformatted) tax amount, e.g. "0" or "660" — this is what
   * PricingTiers checks to decide whether to show a tax line, never the
   * formatted "tax" string above (which would always contain a currency
   * symbol, even for zero). */
  rawTax: string;
}

function pricePreviewResponse(entries: PricePreviewEntry[]) {
  return {
    data: {
      details: {
        lineItems: entries.map(({ priceId, subtotal, tax, total, rawTax }) => ({
          price: { id: priceId },
          formattedTotals: { subtotal, tax, total, discount: "$0.00" },
          totals: { subtotal, tax: rawTax, total, discount: "0" },
        })),
      },
    },
  };
}

// No tax: subtotal === total, rawTax "0" — the common case for these specs.
const MONTHLY_PRICES: PricePreviewEntry[] = [
  { priceId: "pri_starter_month", subtotal: "$12.00", tax: "$0.00", total: "$12.00", rawTax: "0" },
  { priceId: "pri_pro_month", subtotal: "$29.00", tax: "$0.00", total: "$29.00", rawTax: "0" },
  { priceId: "pri_advanced_month", subtotal: "$79.00", tax: "$0.00", total: "$79.00", rawTax: "0" },
];

const YEARLY_PRICES: PricePreviewEntry[] = [
  { priceId: "pri_starter_year", subtotal: "$120.00", tax: "$0.00", total: "$120.00", rawTax: "0" },
  { priceId: "pri_pro_year", subtotal: "$290.00", tax: "$0.00", total: "$290.00", rawTax: "0" },
  { priceId: "pri_advanced_year", subtotal: "$790.00", tax: "$0.00", total: "$790.00", rawTax: "0" },
];

// One tier taxed (an 11%-VAT-country scenario), the others not — exercises
// both the "show the tax line" and "no tax line" paths in the same render.
const MIXED_TAX_PRICES: PricePreviewEntry[] = [
  { priceId: "pri_starter_month", subtotal: "$60.00", tax: "$6.60", total: "$66.60", rawTax: "660" },
  { priceId: "pri_pro_month", subtotal: "$29.00", tax: "$0.00", total: "$29.00", rawTax: "0" },
  { priceId: "pri_advanced_month", subtotal: "$79.00", tax: "$0.00", total: "$79.00", rawTax: "0" },
];

const mockPaddleInstance = { PricePreview: mockPricePreview, Checkout: { open: mockCheckoutOpen } };

/** Controllable promise for tests that need to assert an in-between,
 * still-pending state (the HIGH fix below: no stale price/cycle mismatch
 * while a new PricePreview call is in flight). */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockInitializePaddle.mockResolvedValue(mockPaddleInstance);
  mockPricePreview.mockResolvedValue(pricePreviewResponse(MONTHLY_PRICES));
  mockIssueCheckoutRef.mockResolvedValue({ ok: true, checkoutRef: "ref_abc" });
});

afterEach(() => {
  cleanup();
  mockInitializePaddle.mockReset();
  mockPricePreview.mockReset();
  mockCheckoutOpen.mockReset();
  mockIssueCheckoutRef.mockReset();
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
      currentTierId={null}
      hasLiveSubscription={false}
      isManualTenant={false}
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

describe("PricingTiers — tax disclosure", () => {
  it("renders the subtotal, not the tax-inclusive total, as the headline price", async () => {
    mockPricePreview.mockResolvedValueOnce(pricePreviewResponse(MIXED_TAX_PRICES));
    renderTiers();

    const starterCard = await screen.findByTestId("pr-tier-starter");
    await waitFor(() => {
      expect(starterCard.querySelector(".pr-tier-amount")).toHaveTextContent("$60.00");
    });
  });

  it("shows a tax disclosure line with Paddle's exact tax and total strings when tax is non-zero", async () => {
    mockPricePreview.mockResolvedValueOnce(pricePreviewResponse(MIXED_TAX_PRICES));
    renderTiers();

    const starterCard = await screen.findByTestId("pr-tier-starter");
    await waitFor(() => expect(within(starterCard).getByText("$6.60")).toBeInTheDocument());

    expect(within(starterCard).getByText("$66.60")).toBeInTheDocument();
    expect(starterCard.textContent).toMatch(/\+\s*\$6\.60\s*tax\s*·\s*\$66\.60\s*total/);
  });

  it("shows no tax disclosure line when the raw tax is exactly \"0\"", async () => {
    mockPricePreview.mockResolvedValueOnce(pricePreviewResponse(MIXED_TAX_PRICES));
    renderTiers();

    const proCard = await screen.findByTestId("pr-tier-pro");
    await waitFor(() => {
      expect(proCard.querySelector(".pr-tier-amount")).toHaveTextContent("$29.00");
    });

    expect(within(proCard).queryByText(/tax/i)).not.toBeInTheDocument();
  });

  it("never shows a tax line while the price hasn't loaded yet", () => {
    renderTiers();
    expect(within(screen.getByTestId("pr-tier-starter")).queryByText(/tax/i)).not.toBeInTheDocument();
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
  it("opens Paddle Checkout with the exact price ID, overlay settings, successUrl, email and the server-issued checkout ref", async () => {
    renderTiers({ signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    const button = within(screen.getByTestId("pr-tier-pro")).getByRole("button", { name: /subscribe/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockCheckoutOpen).toHaveBeenCalledWith({
        items: [{ priceId: "pri_pro_month", quantity: 1 }],
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          // Paddle.js rejects a relative successUrl outright ("Specify
          // http(s)://example.com") — found against the real sandbox, which
          // a mocked Paddle can't reproduce. Must be absolute.
          successUrl: `${window.location.origin}/welcome`,
          theme: "light",
        },
        customer: { email: "seller@example.com" },
        customData: { checkoutRef: "ref_abc" },
      });
    });
  });

  it("shows an inline message instead of failing silently when Paddle refuses to open checkout", async () => {
    mockCheckoutOpen.mockImplementationOnce(() => {
      throw new Error("[PADDLE BILLING] Checkout input failed validation");
    });
    renderTiers({ signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    fireEvent.click(within(screen.getByTestId("pr-tier-pro")).getByRole("button", { name: /subscribe/i }));

    expect(await screen.findByText(/couldn.t open checkout/i)).toBeInTheDocument();
  });

  it("never sends a tenant id to Paddle (T59 — the browser no longer holds one)", async () => {
    renderTiers({ signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    fireEvent.click(within(screen.getByTestId("pr-tier-pro")).getByRole("button", { name: /subscribe/i }));

    await waitFor(() => expect(mockCheckoutOpen).toHaveBeenCalled());
    expect(JSON.stringify(mockCheckoutOpen.mock.calls[0][0])).not.toContain("tenant");
  });

  it("does not open checkout at all when the server refuses to issue a reference", async () => {
    mockIssueCheckoutRef.mockResolvedValue({ ok: false, error: "Sign in again to continue to checkout." });
    renderTiers({ signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    fireEvent.click(within(screen.getByTestId("pr-tier-pro")).getByRole("button", { name: /subscribe/i }));

    expect(await screen.findByText(/sign in again to continue to checkout/i)).toBeInTheDocument();
    expect(mockCheckoutOpen).not.toHaveBeenCalled();
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

  it("shows the loading state and disables Subscribe while the new cycle's price is still pending — never the stale price under the new cycle label", async () => {
    const yearlyDeferred = createDeferred<ReturnType<typeof pricePreviewResponse>>();
    mockPricePreview
      .mockResolvedValueOnce(pricePreviewResponse(MONTHLY_PRICES))
      .mockImplementationOnce(() => yearlyDeferred.promise);

    renderTiers({ hasYearlyPricing: true, signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    fireEvent.click(screen.getByRole("button", { name: "Yearly" }));

    const proCard = screen.getByTestId("pr-tier-pro");
    await waitFor(() => {
      expect(within(proCard).queryByText("$29.00")).not.toBeInTheDocument();
    });
    expect(within(proCard).getByText(/loading price/i)).toBeInTheDocument();
    expect(within(proCard).getByRole("button", { name: /subscribe/i })).toBeDisabled();

    await act(async () => {
      yearlyDeferred.resolve(pricePreviewResponse(YEARLY_PRICES));
    });

    expect(within(proCard).getByText("$290.00")).toBeInTheDocument();
    expect(within(proCard).getByRole("button", { name: /subscribe/i })).not.toBeDisabled();
  });

  it("never lets a late (out-of-order) monthly response overwrite the yearly display after toggling", async () => {
    const monthlyDeferred = createDeferred<ReturnType<typeof pricePreviewResponse>>();
    mockPricePreview
      .mockImplementationOnce(() => monthlyDeferred.promise)
      .mockResolvedValueOnce(pricePreviewResponse(YEARLY_PRICES));

    renderTiers({ hasYearlyPricing: true });

    // Let Paddle finish initializing and the (deliberately never-resolving
    // yet) initial monthly request actually start before toggling — the
    // point of this test is a request that's already in flight when the
    // visitor switches cycles, not one that never got sent.
    await waitFor(() => expect(mockPricePreview).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
    await screen.findByText("$290.00");

    // The stale monthly response finally arrives, after the yearly one.
    await act(async () => {
      monthlyDeferred.resolve(pricePreviewResponse(MONTHLY_PRICES));
    });

    const proCard = screen.getByTestId("pr-tier-pro");
    expect(within(proCard).getByText("$290.00")).toBeInTheDocument();
    expect(within(proCard).queryByText("$29.00")).not.toBeInTheDocument();
  });
});

describe("PricingTiers — price wrapper announces updates to screen readers", () => {
  it("marks the checkout-tier price wrapper aria-live=\"polite\"", async () => {
    renderTiers();
    const proCard = await screen.findByTestId("pr-tier-pro");

    await waitFor(() => expect(within(proCard).getByText("$29.00")).toBeInTheDocument());

    const liveRegion = proCard.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion).toContainElement(within(proCard).getByText("$29.00"));
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

// T59 slice 2 — no double-billing: a tenant with a live Paddle subscription
// must never see a second Subscribe button.
describe("PricingTiers — no double-billing (live subscription)", () => {
  it("shows a non-interactive 'Current plan' label on the tenant's own tier, never a button or link", async () => {
    renderTiers({ currentTierId: "pro", hasLiveSubscription: true, signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    const proCard = screen.getByTestId("pr-tier-pro");
    expect(within(proCard).getByText(/current plan/i)).toBeInTheDocument();
    expect(within(proCard).queryByRole("button")).not.toBeInTheDocument();
    expect(within(proCard).queryByRole("link")).not.toBeInTheDocument();
  });

  it("turns every OTHER checkout tier's action into a 'Change plan in billing' link to /settings/billing", async () => {
    renderTiers({ currentTierId: "pro", hasLiveSubscription: true, signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    for (const tierId of ["starter", "advanced"]) {
      const link = within(screen.getByTestId(`pr-tier-${tierId}`)).getByRole("link", { name: /change plan in billing/i });
      expect(link).toHaveAttribute("href", "/settings/billing");
    }
    expect(screen.queryByRole("button", { name: /subscribe/i })).not.toBeInTheDocument();
  });

  it("never calls Checkout.open for a tier that is already the current plan or any other tier while subscribed", async () => {
    renderTiers({ currentTierId: "pro", hasLiveSubscription: true, signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    fireEvent.click(within(screen.getByTestId("pr-tier-starter")).getByRole("link", { name: /change plan in billing/i }));
    expect(mockCheckoutOpen).not.toHaveBeenCalled();
    expect(mockIssueCheckoutRef).not.toHaveBeenCalled();
  });

  it("keeps exactly one Signal — on the recommended tier's 'Change plan in billing' link — when the current plan is a DIFFERENT tier", async () => {
    const { container } = renderTiers({ currentTierId: "starter", hasLiveSubscription: true, signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    const signals = container.querySelectorAll('[data-signal="true"]');
    expect(signals).toHaveLength(1);
    expect(within(screen.getByTestId("pr-tier-pro")).getByRole("link", { name: /change plan in billing/i })).toHaveAttribute(
      "data-signal",
      "true",
    );
  });

  it("renders zero Signal elements when the tenant is already on the recommended tier (an inert label is never Signal)", async () => {
    const { container } = renderTiers({ currentTierId: "pro", hasLiveSubscription: true, signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });

  it("leaves the Enterprise (contact) tier's 'Talk to us' action unaffected", async () => {
    renderTiers({ currentTierId: "pro", hasLiveSubscription: true, signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    expect(within(screen.getByTestId("pr-tier-enterprise")).getByRole("link", { name: /talk to us/i })).toBeInTheDocument();
  });
});

describe("PricingTiers — no double-billing (manual/invoiced tenant)", () => {
  it("shows no Subscribe/Change-plan action on any checkout tier", async () => {
    renderTiers({ isManualTenant: true, signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    for (const tierId of ["starter", "pro", "advanced"]) {
      const card = screen.getByTestId(`pr-tier-${tierId}`);
      expect(within(card).queryByRole("button")).not.toBeInTheDocument();
      expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    }
  });

  it("points the tenant to /settings/billing with a single explanatory line", async () => {
    renderTiers({ isManualTenant: true });
    await screen.findByText("$29.00");

    expect(screen.getByRole("link", { name: /billing settings/i })).toHaveAttribute("href", "/settings/billing");
  });

  it("still renders Enterprise's 'Talk to us' mailto, and contributes no Signal at all", async () => {
    const { container } = renderTiers({ isManualTenant: true, signedInEmail: "seller@example.com" });
    await screen.findByText("$29.00");

    expect(within(screen.getByTestId("pr-tier-enterprise")).getByRole("link", { name: /talk to us/i })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });
});
