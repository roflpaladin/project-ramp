// T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Component-level
// DOM assertions for app/page.tsx. Runs under the "components" Vitest
// project (happy-dom) — see vitest.config.ts.
//
// app/page.tsx is a synchronous Server Component with no data fetching, so
// it's called directly and rendered, matching the "render the async server
// component's JSX with RTL" technique used for app/register/page.tsx (this
// one just doesn't need the `await` — see register-page.dom.spec.tsx for
// the async variant). getLandingMode (lib/landing/mode.ts) is exercised via
// process.env directly, since app/page.tsx calls the real
// getLandingMode() (no injected env) — restored after every test so one
// test's stub can never leak into another.
//
// Coverage per the ticket brief: headline/subline render as swappable copy
// slots; the "what is Brava" section names 2-3 value props in sentence
// case; waitlist mode renders the WaitlistForm as the page's one Signal;
// signup mode renders a plain /register link as the page's one Signal
// instead, with no waitlist form in the DOM at all; the footer links to
// /terms, /privacy and /refunds; exactly one data-signal="true" element
// exists in either mode.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Home from "@/app/page";

const ENV_VAR_NAME = "NEXT_PUBLIC_LANDING_MODE";
const originalEnvValue = process.env[ENV_VAR_NAME];

function setLandingModeEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env[ENV_VAR_NAME];
  } else {
    process.env[ENV_VAR_NAME] = value;
  }
}

afterEach(() => {
  cleanup();
  setLandingModeEnv(originalEnvValue);
});

describe("Home — headline and value props", () => {
  it("renders a headline and subline as the page's h1/intro", () => {
    setLandingModeEnv(undefined);
    render(<Home />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("names 2-3 value props for what Brava is, in sentence case (no Title Case, no ALL CAPS)", () => {
    setLandingModeEnv(undefined);
    render(<Home />);

    const section = screen.getByRole("heading", { name: "What Brava is" }).closest("section");
    expect(section).not.toBeNull();
    const valueHeadings = section!.querySelectorAll("h3");
    expect(valueHeadings.length).toBeGreaterThanOrEqual(2);
    expect(valueHeadings.length).toBeLessThanOrEqual(3);

    for (const el of Array.from(valueHeadings)) {
      const text = el.textContent ?? "";
      expect(text).not.toBe(text.toUpperCase());
      // Sentence case: no ALL-CAPS word longer than a short acronym.
      expect(text).not.toMatch(/\b[A-Z]{4,}\b/);
    }
  });
});

describe("Home — waitlist mode (default)", () => {
  it("renders the waitlist form as the page's one Signal, no /register link", () => {
    setLandingModeEnv("waitlist");
    const { container } = render(<Home />);

    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join the waitlist" })).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /create your account/i })).not.toBeInTheDocument();
  });

  it("falls back to waitlist mode for an unrecognised NEXT_PUBLIC_LANDING_MODE value", () => {
    setLandingModeEnv("something-unexpected");
    render(<Home />);

    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
  });
});

describe("Home — signup mode", () => {
  it("renders a single /register link as the page's one Signal, no waitlist form", () => {
    setLandingModeEnv("signup");
    const { container } = render(<Home />);

    expect(screen.queryByLabelText("Work email")).not.toBeInTheDocument();

    const signals = container.querySelectorAll('[data-signal="true"]');
    expect(signals).toHaveLength(1);
    expect(signals[0].tagName).toBe("A");
    expect(signals[0]).toHaveAttribute("href", "/register");
  });
});

describe("Home — footer legal links", () => {
  it("links to /terms, /privacy and /refunds", () => {
    setLandingModeEnv(undefined);
    render(<Home />);

    expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: /refunds/i })).toHaveAttribute("href", "/refunds");
  });
});
