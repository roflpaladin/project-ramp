// T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Component-level
// DOM assertions for app/legal/legal-page-layout.tsx and the three routes
// that use it (app/terms/page.tsx, app/privacy/page.tsx,
// app/refunds/page.tsx). Runs under the "components" Vitest project
// (happy-dom) — see vitest.config.ts. All three pages are plain,
// data-free synchronous Server Components, rendered directly as JSX (no
// `await` needed, matching app/register/page.tsx's precedent for a
// data-free page rendered synchronously — see landing-page.dom.spec.tsx for
// the same technique).
//
// Coverage per the ticket brief: every legal page renders the shared,
// unmissable "Draft — pending founder review" banner (dot + text, never
// colour-only) ahead of its own content; each page has its own distinct
// title and body copy; the legal entity name is an obvious [PLACEHOLDER],
// never a guessed real name; a static grep proves the shared CSS carries no
// hardcoded hex colour (house convention, see stall-alert.dom.spec.tsx).

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TermsPage from "@/app/terms/page";
import PrivacyPage from "@/app/privacy/page";
import RefundsPage from "@/app/refunds/page";

afterEach(() => {
  cleanup();
});

const PAGES = [
  { name: "Terms", Component: TermsPage, headingMatch: /terms/i },
  { name: "Privacy", Component: PrivacyPage, headingMatch: /privacy/i },
  { name: "Refunds", Component: RefundsPage, headingMatch: /refund/i },
] as const;

describe.each(PAGES)("$name page", ({ Component, headingMatch }) => {
  it("renders the unmissable draft-review banner ahead of the page content, as dot + text", () => {
    render(<Component />);

    const banner = screen.getByTestId("legal-draft-banner");
    expect(banner).toHaveTextContent(/draft/i);
    expect(banner).toHaveTextContent(/pending founder review/i);
    expect(banner.querySelector(".lg-banner-dot")).not.toBeNull();

    const heading = screen.getByRole("heading", { level: 1, name: headingMatch });
    // Banner must precede the title in document order — "unmissable" means
    // seen before the content it qualifies, not buried after it.
    expect(banner.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks the legal entity name as an obvious, unresolved placeholder", () => {
    render(<Component />);
    const matches = screen.getAllByText(/\[PLACEHOLDER[^\]]*\]/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("carries the shared data-surface attribute the legal CSS is scoped to", () => {
    render(<Component />);
    expect(screen.getByTestId("legal-page")).toHaveAttribute("data-surface", "legal");
  });
});

describe("Legal pages — distinct content", () => {
  it("gives each page its own title and body, not copy-pasted placeholder text", () => {
    const { unmount: unmountTerms } = render(<TermsPage />);
    const termsBody = screen.getByTestId("legal-page").textContent ?? "";
    unmountTerms();

    const { unmount: unmountPrivacy } = render(<PrivacyPage />);
    const privacyBody = screen.getByTestId("legal-page").textContent ?? "";
    unmountPrivacy();

    const { unmount: unmountRefunds } = render(<RefundsPage />);
    const refundsBody = screen.getByTestId("legal-page").textContent ?? "";
    unmountRefunds();

    expect(termsBody).not.toBe(privacyBody);
    expect(privacyBody).not.toBe(refundsBody);
    expect(termsBody).not.toBe(refundsBody);
  });

  it("aligns the refunds page with a subscription product (mentions billing cycle/subscription)", () => {
    render(<RefundsPage />);
    expect(screen.getByTestId("legal-page")).toHaveTextContent(/subscription/i);
  });
});

describe("Legal pages — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(new NodeURL("../../app/legal/legal.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
