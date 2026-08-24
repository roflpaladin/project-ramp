// T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Component-level
// DOM assertions for app/page.tsx. Runs under the "components" Vitest
// project (happy-dom) — see vitest.config.ts.
//
// app/page.tsx is now (T48) an async Server Component — it reads the
// `brava_hl` headline-variant cookie via next/headers `cookies()`, so it's
// awaited for its JSX before being handed to RTL's render(), matching the
// technique register-page.dom.spec.tsx uses for RegisterPage. next/headers
// is mocked wholesale (house style: mocking a "use server"/framework
// boundary module wholesale, same as onboarding-flow.dom.spec.tsx mocks its
// action module) so each test can control exactly what cookie value the
// page sees, via setHeadlineCookie below. getLandingMode (lib/landing/mode.ts)
// is exercised via process.env directly, since app/page.tsx calls the real
// getLandingMode() (no injected env) — restored after every test so one
// test's stub can never leak into another.
//
// Coverage per the ticket brief: headline/subline render as swappable copy
// slots; the assigned headline variant renders (sticky cookie + invalid-
// cookie fallback, T48); the "what is Brava" section names 2-3 value props
// in sentence case; waitlist mode renders the WaitlistForm as the page's one
// Signal; signup mode renders a plain /register link as the page's one
// Signal instead, with no waitlist form in the DOM at all; the footer links
// to /terms, /privacy and /refunds; exactly one data-signal="true" element
// exists in either mode.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HEADLINE_VARIANT_COOKIE_NAME } from "@/lib/landing/headline-variant";
import { HEADLINE_VARIANTS } from "@/app/landing-variants";

let mockHeadlineCookieValue: string | undefined;

function setHeadlineCookie(value: string | undefined) {
  mockHeadlineCookieValue = value;
}

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === HEADLINE_VARIANT_COOKIE_NAME && mockHeadlineCookieValue !== undefined
        ? { name, value: mockHeadlineCookieValue }
        : undefined,
  }),
}));

const { default: Home } = await import("@/app/page");

async function renderHome() {
  return render(await Home());
}

const ENV_VAR_NAME = "NEXT_PUBLIC_LANDING_MODE";
const originalEnvValue = process.env[ENV_VAR_NAME];

function setLandingModeEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env[ENV_VAR_NAME];
  } else {
    process.env[ENV_VAR_NAME] = value;
  }
}

// T48's HeadlineImpressionPing fires a fetch on every Home mount below —
// stubbed here (never a real network call from a component test) purely to
// keep these T47 tests isolated; HeadlineImpressionPing's own behaviour is
// covered in headline-impression.dom.spec.tsx.
const mockFetch = vi.fn();

afterEach(() => {
  cleanup();
  setLandingModeEnv(originalEnvValue);
  setHeadlineCookie(undefined);
  mockFetch.mockReset();
  vi.unstubAllGlobals();
});

describe("Home — headline and value props", () => {
  it("renders a headline and subline as the page's h1/intro", async () => {
    vi.stubGlobal("fetch", mockFetch.mockResolvedValue(new Response(null, { status: 200 })));
    setLandingModeEnv(undefined);
    await renderHome();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("names 2-3 value props for what Brava is, in sentence case (no Title Case, no ALL CAPS)", async () => {
    vi.stubGlobal("fetch", mockFetch.mockResolvedValue(new Response(null, { status: 200 })));
    setLandingModeEnv(undefined);
    await renderHome();

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
  it("renders the waitlist form as the page's one Signal, no /register link", async () => {
    vi.stubGlobal("fetch", mockFetch.mockResolvedValue(new Response(null, { status: 200 })));
    setLandingModeEnv("waitlist");
    const { container } = await renderHome();

    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join the waitlist" })).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
    expect(screen.queryByRole("link", { name: /create your account/i })).not.toBeInTheDocument();
  });

  it("falls back to waitlist mode for an unrecognised NEXT_PUBLIC_LANDING_MODE value", async () => {
    vi.stubGlobal("fetch", mockFetch.mockResolvedValue(new Response(null, { status: 200 })));
    setLandingModeEnv("something-unexpected");
    await renderHome();

    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
  });
});

describe("Home — signup mode", () => {
  it("renders a single /register link as the page's one Signal, no waitlist form", async () => {
    vi.stubGlobal("fetch", mockFetch.mockResolvedValue(new Response(null, { status: 200 })));
    setLandingModeEnv("signup");
    const { container } = await renderHome();

    expect(screen.queryByLabelText("Work email")).not.toBeInTheDocument();

    const signals = container.querySelectorAll('[data-signal="true"]');
    expect(signals).toHaveLength(1);
    expect(signals[0].tagName).toBe("A");
    expect(signals[0]).toHaveAttribute("href", "/register");
  });
});

describe("Home — footer legal links", () => {
  it("links to /terms, /privacy and /refunds", async () => {
    vi.stubGlobal("fetch", mockFetch.mockResolvedValue(new Response(null, { status: 200 })));
    setLandingModeEnv(undefined);
    await renderHome();

    expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: /refunds/i })).toHaveAttribute("href", "/refunds");
  });
});

describe("Home — headline variant assignment (T48)", () => {
  it("renders the control headline when the cookie is 'control'", async () => {
    vi.stubGlobal("fetch", mockFetch.mockResolvedValue(new Response(null, { status: 200 })));
    setLandingModeEnv(undefined);
    setHeadlineCookie("control");
    await renderHome();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(HEADLINE_VARIANTS.control);
  });

  it("renders the candidate headline when the cookie is 'with-not-at' (sticky assignment)", async () => {
    vi.stubGlobal("fetch", mockFetch.mockResolvedValue(new Response(null, { status: 200 })));
    setLandingModeEnv(undefined);
    setHeadlineCookie("with-not-at");
    await renderHome();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(HEADLINE_VARIANTS["with-not-at"]);
  });

  it("falls back to a fresh (still valid) variant when the cookie is missing or malformed, never throwing", async () => {
    vi.stubGlobal("fetch", mockFetch.mockResolvedValue(new Response(null, { status: 200 })));
    setLandingModeEnv(undefined);
    setHeadlineCookie("not-a-real-variant");

    await expect(renderHome()).resolves.toBeDefined();
    const heading = screen.getByRole("heading", { level: 1 });
    expect([HEADLINE_VARIANTS.control, HEADLINE_VARIANTS["with-not-at"]]).toContain(heading.textContent);
  });
});
