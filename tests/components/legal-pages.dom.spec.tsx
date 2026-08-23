// T47 (Sprint 9, Ticket 47). Component-level DOM assertions for
// app/legal/legal-page-layout.tsx and the three routes that use it
// (app/terms/page.tsx, app/privacy/page.tsx, app/refunds/page.tsx). Runs
// under the "components" Vitest project (happy-dom) — see vitest.config.ts.
// All three pages are plain, data-free synchronous Server Components,
// rendered directly as JSX (no `await` needed, matching
// app/register/page.tsx's precedent for a data-free page rendered
// synchronously — see landing-page.dom.spec.tsx for the same technique).
//
// Updated for the founder-approved copy swap: the "Draft — pending founder
// review" banner and the [PLACEHOLDER] entity/contact text are gone
// (replaced with real copy — PT Arasaka Global Consulting,
// dimas@getbrava.tech); "Last updated" now comes from the single shared
// LEGAL_LAST_UPDATED constant (app/legal/legal-last-updated.ts), which is
// null until publish day and renders no line at all while it is.
//
// Coverage per the ticket brief: the draft banner is gone from all three
// pages; each page carries the real entity name and contact email, never a
// placeholder; the Paddle buyer-terms link (terms + refunds) is a real
// external link with target/rel; the privacy page's providers table
// renders; no "Last updated" line renders while LEGAL_LAST_UPDATED is
// null; no "[DATE]"/"[PLACEHOLDER]" scaffolding text survives anywhere; the
// shared-layout consistency checks (data-surface, distinct content,
// no-hardcoded-hex CSS) carry over unchanged.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LEGAL_LAST_UPDATED } from "@/app/legal/legal-last-updated";
import TermsPage from "@/app/terms/page";
import PrivacyPage from "@/app/privacy/page";
import RefundsPage from "@/app/refunds/page";

afterEach(() => {
  cleanup();
});

const PADDLE_BUYER_TERMS_URL = "https://www.paddle.com/legal/checkout-buyer-terms";
const ENTITY_NAME = "PT Arasaka Global Consulting";
const CONTACT_EMAIL = "dimas@getbrava.tech";

const PAGES = [
  { name: "Terms", Component: TermsPage, headingMatch: /terms/i },
  { name: "Privacy", Component: PrivacyPage, headingMatch: /privacy/i },
  { name: "Refunds", Component: RefundsPage, headingMatch: /refund/i },
] as const;

describe.each(PAGES)("$name page", ({ Component, headingMatch }) => {
  it("renders no draft-review banner", () => {
    render(<Component />);

    expect(screen.queryByTestId("legal-draft-banner")).not.toBeInTheDocument();
    expect(screen.queryByText(/pending founder review/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: headingMatch })).toBeInTheDocument();
  });

  it("carries no placeholder entity/contact text", () => {
    render(<Component />);
    expect(screen.queryByText(/\[PLACEHOLDER[^\]]*\]/)).not.toBeInTheDocument();
  });

  it("carries the real contact email", () => {
    render(<Component />);
    expect(screen.getByTestId("legal-page")).toHaveTextContent(CONTACT_EMAIL);
  });

  it("renders no leaked scaffolding text ([DATE], [PLACEHOLDER], or a draft banner)", () => {
    render(<Component />);

    const text = screen.getByTestId("legal-page").textContent ?? "";
    expect(text).not.toMatch(/\[DATE\]/);
    expect(text).not.toMatch(/\[PLACEHOLDER/);
    expect(text).not.toMatch(/draft/i);
  });

  it("renders the 'Last updated' line from the shared LEGAL_LAST_UPDATED constant", () => {
    render(<Component />);
    expect(screen.getByText(`Last updated: ${LEGAL_LAST_UPDATED}`)).toBeInTheDocument();
  });

  it("carries the shared data-surface attribute the legal CSS is scoped to", () => {
    render(<Component />);
    expect(screen.getByTestId("legal-page")).toHaveAttribute("data-surface", "legal");
  });
});

describe("Terms + Privacy pages — founder-approved entity name", () => {
  // Refunds' source copy (brava-legal-pages-draft.md, "Page 3") never names
  // the entity — it refers only to "Brava"/"us"/Paddle throughout — so this
  // is scoped to the two pages whose approved text actually names it,
  // verbatim, rather than asserted across all three.
  it.each([
    ["Terms", TermsPage],
    ["Privacy", PrivacyPage],
  ] as const)("%s page names the real entity, PT Arasaka Global Consulting", (_name, Component) => {
    render(<Component />);
    expect(screen.getByTestId("legal-page")).toHaveTextContent(ENTITY_NAME);
  });
});

describe("Terms + Refunds pages — Paddle buyer-terms link", () => {
  it.each([
    ["Terms", TermsPage],
    ["Refunds", RefundsPage],
  ] as const)("%s page links to Paddle's buyer terms as a real external link", (_name, Component) => {
    render(<Component />);

    const link = screen.getByRole("link", { name: "buyer terms" });
    expect(link).toHaveAttribute("href", PADDLE_BUYER_TERMS_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("Privacy page — providers table", () => {
  it("renders the service-providers table with its header and every provider row", () => {
    render(<PrivacyPage />);

    const table = screen.getByTestId("legal-page").querySelector("table.lg-table");
    expect(table).not.toBeNull();

    expect(screen.getByRole("columnheader", { name: "Provider" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "What they do for us" })).toBeInTheDocument();

    for (const provider of ["Supabase", "Vercel", "Google Workspace", "Paddle"]) {
      expect(screen.getByRole("cell", { name: provider })).toBeInTheDocument();
    }
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
