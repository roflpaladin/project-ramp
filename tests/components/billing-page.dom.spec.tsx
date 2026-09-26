// Sprint 12, Ticket 59 (slice 2 — seller-facing billing surface).
// Component-level DOM assertions for app/settings/billing/page.tsx. Runs
// under the "components" Vitest project (happy-dom) — an async Server
// Component rendered directly via `render(await BillingSettingsPage(...))`,
// matching tests/components/pricing-page.dom.spec.tsx's own precedent for
// an async page. requireSeller, subscription-repository and next/navigation
// are mocked wholesale (house style — see hubspot-connection-card.dom.spec.tsx's
// note on the pattern). DB-free, no real Paddle call anywhere in this file.
//
// Coverage: every state from the ticket's status table (dot + text label,
// never colour-only), the portal button present only for a real Paddle
// customer and absent for free/manual, exactly one Signal per state, and
// the manual/invoiced card's own distinct copy.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";

const { mockRequireSeller } = vi.hoisted(() => ({ mockRequireSeller: vi.fn() }));
vi.mock("@/lib/plans/require-seller", () => ({ requireSeller: mockRequireSeller }));

const { mockFindByTenantId } = vi.hoisted(() => ({ mockFindByTenantId: vi.fn() }));
vi.mock("@/lib/billing/subscription-repository", () => ({ findByTenantId: mockFindByTenantId }));

// T60: the "N of M active deals" line. Mocked here rather than left to the
// real module, which would reach for a service-role Supabase client.
const { mockCountActiveDealsForTenant } = vi.hoisted(() => ({ mockCountActiveDealsForTenant: vi.fn() }));
vi.mock("@/lib/plans/active-deal-count", () => ({ countActiveDealsForTenant: mockCountActiveDealsForTenant }));

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const { default: BillingSettingsPage } = await import("@/app/settings/billing/page");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function signedInSeller(overrides: Record<string, unknown> = {}) {
  return { client: {}, userId: "user-1", email: "seller@example.com", tenantId: TENANT_ID, ...overrides };
}

function subscription(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    tenantId: TENANT_ID,
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

function renderPage(searchParams: { error?: string | string[] } = {}) {
  return BillingSettingsPage({ searchParams: Promise.resolve(searchParams) });
}

beforeEach(() => {
  mockCountActiveDealsForTenant.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
  mockRequireSeller.mockReset();
  mockFindByTenantId.mockReset();
  mockCountActiveDealsForTenant.mockReset();
  mockRedirect.mockClear();
});

describe("BillingSettingsPage — signed out", () => {
  it("redirects to /admin/login, same as the sibling settings pages", async () => {
    mockRequireSeller.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/admin/login");
  });
});

describe("BillingSettingsPage — free tenant (never subscribed)", () => {
  it("shows the Free status dot+label, and 'See plans' as the page's only Signal, no portal button", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(null);

    const { container } = render(await renderPage());

    expect(screen.getAllByText("Free")).toHaveLength(2); // plan name + status label
    expect(screen.getByTestId("billing-status")).toHaveAttribute("data-tone", "wait");
    expect(screen.getByText(/up to 1 active deal/i)).toBeInTheDocument();

    const seePlans = screen.getByRole("link", { name: /see plans/i });
    expect(seePlans).toHaveAttribute("href", "/pricing");
    expect(seePlans).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /manage billing/i })).not.toBeInTheDocument();
  });
});

describe("BillingSettingsPage — active subscription", () => {
  it("shows Active/done, billing cycle, next renewal date, and 'Manage billing' as the only Signal", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ status: "active" }));

    const { container } = render(await renderPage());

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByTestId("billing-status")).toHaveAttribute("data-tone", "done");
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Billed monthly")).toBeInTheDocument();
    expect(screen.getByText(/renews oct 20, 2026/i)).toBeInTheDocument();

    const manageBilling = screen.getByRole("button", { name: /manage billing/i });
    expect(manageBilling).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /see plans/i })).not.toBeInTheDocument();
  });
});

describe("BillingSettingsPage — trial", () => {
  it("shows Trial/wait", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ status: "trialing" }));

    render(await renderPage());

    expect(screen.getByText("Trial")).toBeInTheDocument();
    expect(screen.getByTestId("billing-status")).toHaveAttribute("data-tone", "wait");
  });
});

describe("BillingSettingsPage — scheduled cancellation", () => {
  it("shows 'Cancels on <date>' and reassures that access continues until then, still with the portal button", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(
      subscription({ status: "active", scheduledChange: { action: "cancel", effectiveAt: "2026-10-20T00:00:00.000Z" } }),
    );

    render(await renderPage());

    expect(screen.getByText(/cancels on oct 20, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/stays active until then/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage billing/i })).toBeInTheDocument();
    // Still active — no separate "Next renewal" line while it's ending instead.
    expect(screen.queryByText(/renews/i)).not.toBeInTheDocument();
  });
});

describe("BillingSettingsPage — payment failed (in grace)", () => {
  it("shows 'Payment failed — fix by <date>' as risk", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ status: "past_due", pastDueSince: new Date().toISOString() }));

    render(await renderPage());

    expect(screen.getByText(/payment failed — fix by/i)).toBeInTheDocument();
    expect(screen.getByTestId("billing-status")).toHaveAttribute("data-tone", "risk");
  });
});

describe("BillingSettingsPage — payment overdue (past grace)", () => {
  it("shows 'Payment overdue — new deals are paused' and reassures that existing deals/buyers keep working", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(
      subscription({ status: "past_due", pastDueSince: "2020-01-01T00:00:00.000Z" }),
    );

    render(await renderPage());

    expect(screen.getByText(/payment overdue — new deals are paused/i)).toBeInTheDocument();
    expect(screen.getByText(/existing deals and buyers keep working/i)).toBeInTheDocument();
    expect(screen.getByTestId("billing-status")).toHaveAttribute("data-tone", "risk");
  });
});

describe("BillingSettingsPage — paused and canceled", () => {
  it("shows Paused/wait, still offering Manage billing (a real Paddle customer exists)", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ status: "paused" }));

    render(await renderPage());

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage billing/i })).toBeInTheDocument();
  });

  it("shows Canceled/wait, WITH BOTH 'See plans' (the one Signal) AND a secondary 'View invoices' action (code review fix, MEDIUM)", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ status: "canceled" }));

    const { container } = render(await renderPage());

    expect(screen.getByText("Canceled")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument(); // resolveEntitlement collapses to free

    const seePlans = screen.getByRole("link", { name: /see plans/i });
    expect(seePlans).toHaveAttribute("href", "/pricing");
    expect(seePlans).toHaveAttribute("data-signal", "true");

    const viewInvoices = screen.getByRole("button", { name: /view invoices/i });
    expect(viewInvoices).not.toHaveAttribute("data-signal");
    expect(screen.queryByRole("button", { name: /manage billing/i })).not.toBeInTheDocument();

    // Still exactly one Signal — "See plans" — even with two actions present.
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });
});

describe("BillingSettingsPage — manual/invoiced tenant", () => {
  it("shows the invoiced message, a contact mailto, and NO portal button", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(
      subscription({ manualEntitlementTier: "enterprise", manualEntitlementNote: "Invoiced annually" }),
    );

    const { container } = render(await renderPage());

    expect(screen.getByText(/invoiced plan — managed by our team/i)).toBeInTheDocument();
    const contactLink = screen.getByRole("link", { name: /contact us/i });
    expect(contactLink.getAttribute("href")).toMatch(/^mailto:/);
    expect(screen.queryByRole("button", { name: /manage billing/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("billing-status")).not.toBeInTheDocument();
    // No Signal at all in this state — see page.tsx's own comment.
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });
});

describe("BillingSettingsPage — surface a portal error from the redirect-back query param (closed set of codes)", () => {
  it("renders the fixed message for a known error code", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ status: "active" }));

    render(await renderPage({ error: "generic" }));

    expect(screen.getByTestId("billing-error")).toHaveTextContent(/couldn't open the billing portal/i);
  });

  it("never reflects an attacker-supplied ?error= value verbatim — falls back to the generic message (code review fix, HIGH)", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ status: "active" }));

    const phishingText = "Your card was declined — call 1-800-555-0100 to verify your identity";
    render(await renderPage({ error: phishingText }));

    expect(screen.queryByText(phishingText)).not.toBeInTheDocument();
    expect(screen.getByTestId("billing-error")).toHaveTextContent(/couldn't open the billing portal/i);
  });

  it("shows nothing when there is no error param at all", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ status: "active" }));

    render(await renderPage());

    expect(screen.queryByTestId("billing-error")).not.toBeInTheDocument();
  });

  it("handles a duplicated ?error= query param (array value) without crashing", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ status: "active" }));

    render(await renderPage({ error: ["signed_out", "no_account"] }));

    expect(screen.getByTestId("billing-error")).toHaveTextContent(/couldn't open the billing portal/i);
  });
});

describe("BillingSettingsPage — tenant-less account (provisioning never completed)", () => {
  it("never calls findByTenantId and renders as Free", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller({ tenantId: null }));

    render(await renderPage());

    expect(mockFindByTenantId).not.toHaveBeenCalled();
    expect(screen.getAllByText("Free")).toHaveLength(2); // plan name + status label
  });

  it("shows no usage line at all when there is no tenant to count against", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller({ tenantId: null }));

    render(await renderPage());

    expect(mockCountActiveDealsForTenant).not.toHaveBeenCalled();
    expect(screen.queryByTestId("billing-deals-used")).not.toBeInTheDocument();
  });
});

describe("BillingSettingsPage — how many active deals are in use (T60)", () => {
  it("says 'N of M active deals' for a capped plan", async () => {
    // Arrange
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ tierId: "starter", status: "active" }));
    mockCountActiveDealsForTenant.mockResolvedValue(2);

    // Act
    render(await renderPage());

    // Assert
    expect(screen.getByTestId("billing-deals-used")).toHaveTextContent("2 of 3 active deals");
  });

  it("singularises the noun when the cap is one", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(null);
    mockCountActiveDealsForTenant.mockResolvedValue(1);

    render(await renderPage());

    expect(screen.getByTestId("billing-deals-used")).toHaveTextContent("1 of 1 active deal");
  });

  it("says 'unlimited' rather than inventing a cap for an uncapped plan", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ tierId: "advanced", status: "active" }));
    mockCountActiveDealsForTenant.mockResolvedValue(12);

    render(await renderPage());

    expect(screen.getByTestId("billing-deals-used")).toHaveTextContent("12 active deals — unlimited");
  });

  it("renders the numbers in Geist Mono, like every other figure on this page", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(null);
    mockCountActiveDealsForTenant.mockResolvedValue(0);

    render(await renderPage());

    expect(screen.getByTestId("billing-deals-used")).toHaveClass("bl-mono");
  });

  it("omits the line, rather than breaking the page, when the count cannot be read", async () => {
    mockRequireSeller.mockResolvedValue(signedInSeller());
    mockFindByTenantId.mockResolvedValue(subscription({ status: "active" }));
    mockCountActiveDealsForTenant.mockRejectedValue(new Error("supabase down"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    render(await renderPage());

    expect(screen.queryByTestId("billing-deals-used")).not.toBeInTheDocument();
    // The rest of the card is untouched…
    expect(screen.getByRole("button", { name: /manage billing/i })).toBeInTheDocument();
    // …and the failure is logged, never swallowed.
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
