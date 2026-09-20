// Sprint 12, Ticket 67 (slice 1 — Paddle onboarding step 1, "build your
// pricing page"). Component-level DOM assertions for
// components/marketing/marketing-footer-nav.tsx (MarketingFooterNav), the
// shared nav+footer this slice adds for /pricing (see the ticket report for
// why it isn't also wired into the legal pages/landing this pass). Runs
// under the "components" Vitest project (happy-dom).
//
// Coverage: Home/Terms/Privacy/Refunds always render; Pricing renders only
// when lib/billing/plans's getPricingModel() reports isPublishable; Security
// never renders (that page doesn't exist yet — no dead link); when a caller
// (app/pricing/page.tsx, which has already computed the model itself)
// passes the optional isPricingPublishable prop, this component uses THAT
// instead of calling getPricingModel() again — code review flagged the
// double-evaluation (and its duplicated misconfiguration console.error) on
// every /pricing request.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { mockGetPricingModel } = vi.hoisted(() => ({ mockGetPricingModel: vi.fn() }));

vi.mock("@/lib/billing/plans", () => ({
  getPricingModel: mockGetPricingModel,
}));

const { MarketingFooterNav } = await import("@/components/marketing/marketing-footer-nav");

afterEach(() => {
  cleanup();
  mockGetPricingModel.mockReset();
});

describe("MarketingFooterNav — pricing publishable", () => {
  it("links to Home, Pricing, Terms, Privacy and Refunds", () => {
    mockGetPricingModel.mockReturnValue({ isPublishable: true });
    render(<MarketingFooterNav />);

    expect(screen.getByRole("link", { name: /^home$/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /^pricing$/i })).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("link", { name: /^terms$/i })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: /^privacy$/i })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: /^refunds$/i })).toHaveAttribute("href", "/refunds");
  });

  it("never renders a Security link (that page doesn't exist yet)", () => {
    mockGetPricingModel.mockReturnValue({ isPublishable: true });
    render(<MarketingFooterNav />);

    expect(screen.queryByRole("link", { name: /security/i })).not.toBeInTheDocument();
  });
});

describe("MarketingFooterNav — pricing not publishable", () => {
  it("hides the Pricing link, keeping every other link intact", () => {
    mockGetPricingModel.mockReturnValue({ isPublishable: false });
    render(<MarketingFooterNav />);

    expect(screen.queryByRole("link", { name: /^pricing$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^home$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^terms$/i })).toBeInTheDocument();
  });
});

describe("MarketingFooterNav — isPricingPublishable prop supplied", () => {
  it("shows Pricing from a true prop without calling getPricingModel() at all", () => {
    render(<MarketingFooterNav isPricingPublishable />);

    expect(screen.getByRole("link", { name: /^pricing$/i })).toHaveAttribute("href", "/pricing");
    expect(mockGetPricingModel).not.toHaveBeenCalled();
  });

  it("hides Pricing from a false prop without calling getPricingModel() at all", () => {
    render(<MarketingFooterNav isPricingPublishable={false} />);

    expect(screen.queryByRole("link", { name: /^pricing$/i })).not.toBeInTheDocument();
    expect(mockGetPricingModel).not.toHaveBeenCalled();
  });

  it("falls back to calling getPricingModel() only when the prop is omitted", () => {
    mockGetPricingModel.mockReturnValue({ isPublishable: true });
    render(<MarketingFooterNav />);

    expect(screen.getByRole("link", { name: /^pricing$/i })).toBeInTheDocument();
    expect(mockGetPricingModel).toHaveBeenCalledTimes(1);
  });
});
