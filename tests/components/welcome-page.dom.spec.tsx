// Sprint 12, Ticket 67 (slice 1, founder scope amendment — Paddle overlay
// checkout). Component-level DOM assertions for app/welcome/page.tsx, the
// successUrl Paddle Checkout redirects to after a Subscribe overlay
// completes (see pricing-tiers.tsx's settings.successUrl). Runs under the
// "components" Vitest project (happy-dom) — a plain, data-free Server
// Component rendered directly as JSX (no `await` needed, matching
// app/register/page.tsx's precedent — see landing-page.dom.spec.tsx's note
// on the same technique for an async page instead).
//
// Coverage: the page never claims the plan is already active (activation is
// confirmed by the backend later, not by this page) and links back to
// /admin.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WelcomePage from "@/app/welcome/page";

afterEach(() => {
  cleanup();
});

describe("WelcomePage", () => {
  it("does not claim the subscription is already active", () => {
    render(<WelcomePage />);

    const text = screen.getByTestId("welcome-page").textContent ?? "";
    expect(text).not.toMatch(/your plan is now active/i);
    expect(text).not.toMatch(/subscription activated/i);
  });

  it("links back to the seller's workspace", () => {
    render(<WelcomePage />);

    expect(screen.getByRole("link", { name: /workspace/i })).toHaveAttribute("href", "/admin");
  });

  it("also links to the new billing settings page, as a secondary (non-Signal) action", () => {
    render(<WelcomePage />);

    const planLink = screen.getByRole("link", { name: /view your plan/i });
    expect(planLink).toHaveAttribute("href", "/settings/billing");
    expect(planLink).not.toHaveAttribute("data-signal");
  });

  it("keeps exactly one Signal-styled action ('Go to your workspace')", () => {
    const { container } = render(<WelcomePage />);

    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
    expect(screen.getByRole("link", { name: /go to your workspace/i })).toHaveAttribute("data-signal", "true");
  });

  it("carries the shared data-surface attribute its CSS is scoped to", () => {
    render(<WelcomePage />);
    expect(screen.getByTestId("welcome-page")).toHaveAttribute("data-surface", "welcome");
  });
});
