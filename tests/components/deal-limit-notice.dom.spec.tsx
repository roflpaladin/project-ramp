// Sprint 12, Ticket 60 — the upgrade wall
// (app/admin/workspaces/[id]/deal-limit-notice.tsx). Runs under the
// "components" Vitest project (happy-dom) — see vitest.config.ts. DB-free:
// this component is pure presentation, it calls nothing.
//
// Covers: one Signal and never two, the right destination per reason, copy
// that reads differently for "at your limit" than for "payment failed", the
// infrastructure-failure case offering no CTA at all, status as dot + text
// rather than colour alone, the Geist Mono count line, and a static grep of
// this component's own stylesheet for hardcoded hex (design system MUST:
// tokens only, both themes) — the same grep idiom
// activation-checklist.dom.spec.tsx uses.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DealLimitNotice } from "@/app/admin/workspaces/[id]/deal-limit-notice";

afterEach(() => {
  cleanup();
});

interface RenderOptions {
  readonly reason: "limit" | "past-due" | "unknown";
  readonly activeCount?: number | null;
  readonly maxActiveDeals?: number | null;
  readonly canUseSignal?: boolean;
}

function renderNotice({ reason, activeCount = 1, maxActiveDeals = 1, canUseSignal = true }: RenderOptions) {
  return render(
    <DealLimitNotice
      reason={reason}
      activeCount={activeCount}
      maxActiveDeals={maxActiveDeals}
      canUseSignal={canUseSignal}
    />,
  );
}

function signalMarkedElements(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[data-signal="true"]'));
}

describe("DealLimitNotice — at your limit", () => {
  it("names the state as dot + text, explains it in plain words, and offers one Signal to /pricing", () => {
    // Arrange / Act
    const { container } = renderNotice({ reason: "limit", activeCount: 3, maxActiveDeals: 3 });

    // Assert
    const notice = screen.getByTestId("deal-limit-notice");
    expect(notice).toHaveAttribute("data-reason", "limit");
    expect(notice.querySelector("[data-status-dot]")).not.toBeNull();
    expect(screen.getByText("At your deal limit")).toBeInTheDocument();
    expect(screen.getByText(/using all the active deals your plan includes/i)).toBeInTheDocument();

    const cta = screen.getByRole("link", { name: "See plans" });
    expect(cta).toHaveAttribute("href", "/pricing");
    expect(cta).toHaveAttribute("data-signal", "true");
    expect(signalMarkedElements(container)).toHaveLength(1);
  });

  it("renders the count in Geist Mono, pluralised by the cap", () => {
    renderNotice({ reason: "limit", activeCount: 3, maxActiveDeals: 3 });

    expect(screen.getByText("3 of 3 active deals")).toBeInTheDocument();
    cleanup();

    renderNotice({ reason: "limit", activeCount: 1, maxActiveDeals: 1 });
    expect(screen.getByText("1 of 1 active deal")).toBeInTheDocument();
  });

  it("omits the count line entirely when there is no count to show", () => {
    renderNotice({ reason: "limit", activeCount: null, maxActiveDeals: 3 });

    expect(screen.queryByTestId("deal-limit-count")).not.toBeInTheDocument();
  });

  it("renders the state dot in Slate, never a loud colour — being at a cap is a state, not an error", () => {
    renderNotice({ reason: "limit" });

    expect(screen.getByTestId("deal-limit-notice")).toHaveAttribute("data-tone", "wait");
  });
});

describe("DealLimitNotice — payment failed", () => {
  it("reads differently from the limit copy and sends the seller to billing, not to pricing", () => {
    renderNotice({ reason: "past-due", activeCount: 0, maxActiveDeals: 3 });

    expect(screen.getByText("Payment failed")).toBeInTheDocument();
    expect(screen.getByText(/last payment did not go through/i)).toBeInTheDocument();
    expect(screen.queryByText(/using all the active deals your plan includes/i)).not.toBeInTheDocument();

    const cta = screen.getByRole("link", { name: "Update payment details" });
    expect(cta).toHaveAttribute("href", "/settings/billing");
    expect(screen.queryByRole("link", { name: "See plans" })).not.toBeInTheDocument();
  });

  it("reassures that existing deals and buyers are untouched", () => {
    renderNotice({ reason: "past-due" });

    expect(screen.getByText(/existing deals and buyers keep working/i)).toBeInTheDocument();
  });

  it("renders the state dot as risk — a failed payment is a real problem, unlike a full plan", () => {
    renderNotice({ reason: "past-due" });

    expect(screen.getByTestId("deal-limit-notice")).toHaveAttribute("data-tone", "risk");
  });
});

describe("DealLimitNotice — the billing check itself failed", () => {
  it("says so honestly and offers NO call to action — we have nothing to sell for our own outage", () => {
    const { container } = renderNotice({ reason: "unknown", activeCount: null, maxActiveDeals: null });

    expect(screen.getByText(/could not check your plan just now/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(signalMarkedElements(container)).toHaveLength(0);
  });

  it("never tells the seller they are at a limit we could not read", () => {
    renderNotice({ reason: "unknown" });

    expect(screen.queryByText(/at your deal limit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/upgrade/i)).not.toBeInTheDocument();
  });
});

describe("DealLimitNotice — the page's Signal budget", () => {
  it("renders the CTA as a plain link, still linked, when the page's Signal is already spoken for", () => {
    const { container } = renderNotice({ reason: "limit", canUseSignal: false });

    const cta = screen.getByRole("link", { name: "See plans" });
    expect(cta).toHaveAttribute("href", "/pricing");
    expect(cta).not.toHaveAttribute("data-signal");
    expect(signalMarkedElements(container)).toHaveLength(0);
  });

  it("never marks the state dot itself as the Signal element", () => {
    const { container } = renderNotice({ reason: "limit" });

    expect(container.querySelector("[data-status-dot]")).not.toHaveAttribute("data-signal");
  });
});

describe("DealLimitNotice — announced when it appears after an action", () => {
  it("is a polite live region, so a stale-page refusal is read out rather than only seen", () => {
    renderNotice({ reason: "limit" });

    expect(screen.getByTestId("deal-limit-notice")).toHaveAttribute("role", "status");
  });
});

describe("DealLimitNotice — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(
      new NodeURL("../../app/admin/workspaces/[id]/deal-limit-notice.css", import.meta.url),
    );
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
