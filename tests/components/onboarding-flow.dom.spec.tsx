// T41 (Sprint 8, Ticket 41 — guided first-run onboarding, "onboarding IS the
// demo"). Component-level DOM assertions for
// app/admin/onboarding/onboarding-flow.tsx. Runs under the "components"
// Vitest project (happy-dom) — see vitest.config.ts.
//
// onboarding-actions.ts is a "use server" module (Server Actions can't run
// inside happy-dom — there is no Next.js server runtime backing
// cookies()/headers()/Supabase there), so it is mocked wholesale, mirroring
// tests/components/invite-panel.dom.spec.tsx's house style; this file only
// exercises OnboardingFlow's own rendering/state-transition logic, never the
// real action bodies. onboarding-state.ts is NOT mocked — it has no
// server-only dependency (deliberately kept out of the "use server" module
// for exactly this reason, see its own header comment), so the real
// INITIAL_ONBOARDING_STATE/OnboardingActionState are imported and used
// as-is.
//
// Coverage per the ticket brief: the "choose" step renders all five
// population paths with exactly one Signal element and three genuinely
// inert (real `disabled`) placeholders; the sample-deal pending presentation
// disables the button, swaps in a spinner at the button's own width with no
// layout shift, and swaps the accessible name; a sample-deal error renders a
// recoverable dot+text alert and leaves the card actionable for retry;
// "Set up manually" and "Back" move the step machine forward and back with
// no route change; the manual step's two labelled fields render a
// validation error with aria-invalid on the offending field and preserve
// typed values; exactly one `data-signal="true"` element exists at every
// step/state; a static grep proves onboarding.css carries no hardcoded hex
// colour (house convention, see stall-alert.dom.spec.tsx).
//
// T46 addendum (Sprint 9, Ticket 46 — scrape-meta population wiring): the
// manual step's domain field wires to the EXISTING Sprint 2 scrape-meta
// endpoint (app/api/scrape-meta/route.ts) via lib/use-scrape-meta-prefill.ts
// on blur — `global.fetch` is stubbed for this block only (never a real
// network call). Coverage: a successful fetch prefills company name only
// when the seller hasn't typed one; a non-empty company name is never
// silently overwritten, instead offering an explicit tertiary "use this"
// affordance that carries no `data-signal`; a non-OK response and a
// rejected/timed-out fetch both degrade to the same quiet meta-tone line
// with no `role="alert"` and no retry; and submit behaves identically
// whether or not the scrape ever ran.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  INITIAL_ONBOARDING_STATE,
  INVALID_DOMAIN_MESSAGE,
  MISSING_NAME_MESSAGE,
  type OnboardingActionState,
} from "@/app/admin/onboarding/onboarding-state";

const { mockStartWithSampleDeal, mockCreateFirstWorkspace } = vi.hoisted(() => ({
  mockStartWithSampleDeal: vi.fn(),
  mockCreateFirstWorkspace: vi.fn(),
}));

vi.mock("@/app/admin/onboarding/onboarding-actions", () => ({
  startWithSampleDeal: mockStartWithSampleDeal,
  createFirstWorkspace: mockCreateFirstWorkspace,
}));

import * as OnboardingFlowModule from "@/app/admin/onboarding/onboarding-flow";
import { OnboardingFlow } from "@/app/admin/onboarding/onboarding-flow";

afterEach(() => {
  cleanup();
  mockStartWithSampleDeal.mockReset();
  mockCreateFirstWorkspace.mockReset();
});

function errorState(message: string): OnboardingActionState {
  return { error: message };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/**
 * React 19 entangles concurrent form-action transitions on a single shared
 * queue (so submissions resolve in order) — a promise a test leaves
 * permanently unresolved therefore blocks every OTHER test's action in this
 * file too, not just its own. The pending-presentation test below needs to
 * freeze mid-flight to assert the spinner, so it uses this instead of a bare
 * `new Promise(() => {})`, resolving it before the test ends. Copied from
 * tests/components/invite-panel.dom.spec.tsx's documented workaround.
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("module boundary — single entry point", () => {
  it("exports exactly one runtime value: OnboardingFlow", () => {
    expect(Object.keys(OnboardingFlowModule)).toEqual(["OnboardingFlow"]);
  });
});

describe("OnboardingFlow — choose step", () => {
  it("renders all five population paths with exactly one Signal element", () => {
    const { container } = render(<OnboardingFlow />);

    expect(screen.getByRole("heading", { name: "Set up your first deal" })).toBeInTheDocument();

    const sampleButton = screen.getByRole("button", { name: "Start with a sample deal" });
    expect(sampleButton).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    expect(screen.getByRole("button", { name: "Set up manually" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CSV import" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "From your website" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "From your CRM" })).toBeInTheDocument();
  });

  it("renders the CSV import card as a real, secondary link to /admin/import (T45 Phase 2b — no longer a placeholder)", () => {
    const { container } = render(<OnboardingFlow />);

    const csvLink = screen.getByRole("link", { name: "CSV import" });
    expect(csvLink).toHaveAttribute("href", "/admin/import");
    expect(csvLink).not.toHaveAttribute("data-signal");
    // Secondary weight, same as "Set up manually" — never a second Signal.
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    expect(screen.getByText(/Bring deal details in from a spreadsheet\./)).toBeInTheDocument();
  });

  it("renders the two remaining placeholder paths as genuinely inert (real disabled semantics, not a focus trap)", () => {
    render(<OnboardingFlow />);

    const websiteButton = screen.getByRole("button", { name: "From your website" });
    const crmButton = screen.getByRole("button", { name: "From your CRM" });

    for (const button of [websiteButton, crmButton]) {
      expect(button).toBeDisabled();
    }

    // Honest copy naming what arrives, no "coming soon", no apology, no emoji.
    expect(screen.getAllByText(/Follows CRM import\./)).toHaveLength(1);
    expect(screen.getByText(/Sync deal data directly from your CRM\. Arrives next\./)).toBeInTheDocument();

    fireEvent.click(websiteButton);
    expect(mockStartWithSampleDeal).not.toHaveBeenCalled();
    expect(mockCreateFirstWorkspace).not.toHaveBeenCalled();
  });

  it("orients with one sentence naming what this step does", () => {
    render(<OnboardingFlow />);
    expect(screen.getByText(/Bring in your own deal, or explore Ramp with a ready-made sample/)).toBeInTheDocument();
  });

  it("renders no status/alert before any submission", () => {
    render(<OnboardingFlow />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("OnboardingFlow — sample-deal pending presentation", () => {
  it("disables the button and swaps its label for a spinner at the button's own width, with no layout shift", async () => {
    const deferred = createDeferred<OnboardingActionState>();
    mockStartWithSampleDeal.mockReturnValueOnce(deferred.promise);
    render(<OnboardingFlow />);

    const sampleButton = screen.getByRole("button", { name: "Start with a sample deal" });
    fireEvent.click(sampleButton);

    await waitFor(() => expect(sampleButton).toBeDisabled());
    expect(sampleButton).toHaveAttribute("aria-busy", "true");
    expect(sampleButton).toHaveAccessibleName("Setting up your sample deal");
    expect(sampleButton.querySelector(".ob-spinner")).not.toBeNull();

    // The label stays in the DOM (opacity only) rather than being removed —
    // that's what keeps the button at its own width instead of reflowing.
    expect(sampleButton).toHaveTextContent("Start with a sample deal");

    // Settle before the test ends: an unresolved action would otherwise
    // entangle and block every later test's own action (see createDeferred).
    deferred.resolve(INITIAL_ONBOARDING_STATE);
    await waitFor(() => expect(sampleButton).not.toBeDisabled());
  });
});

describe("OnboardingFlow — sample-deal error (recoverable)", () => {
  it("renders a dot+text alert with the server's own message and keeps the card actionable for retry", async () => {
    mockStartWithSampleDeal.mockResolvedValueOnce(
      errorState("Your account is missing its workspace home. Sign out and back in, then try again."),
    );
    const { container } = render(<OnboardingFlow />);

    fireEvent.click(screen.getByRole("button", { name: "Start with a sample deal" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Your account is missing its workspace home. Sign out and back in, then try again.",
    );
    expect(alert.querySelector(".ob-status-dot")).not.toBeNull();
    expect(alert).toHaveAttribute("data-tone", "risk");

    const sampleButton = screen.getByRole("button", { name: "Start with a sample deal" });
    expect(sampleButton).not.toBeDisabled();
    expect(sampleButton).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });
});

describe("OnboardingFlow — step navigation", () => {
  it("moves from choose to manual on 'Set up manually', and back again on 'Back', with no route change", () => {
    render(<OnboardingFlow />);

    fireEvent.click(screen.getByRole("button", { name: "Set up manually" }));

    expect(screen.getByRole("heading", { name: "Create your first workspace" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
    expect(screen.getByLabelText("Their website domain")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Set up your first deal" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("heading", { name: "Set up your first deal" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create your first workspace" })).not.toBeInTheDocument();
  });
});

describe("OnboardingFlow — manual step fields", () => {
  it("renders labelled fields above the inputs, never placeholder-as-label, with the domain placeholder as a hint", () => {
    render(<OnboardingFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Set up manually" }));

    const companyName = screen.getByLabelText("Company name");
    const domain = screen.getByLabelText("Their website domain");

    expect(companyName).toBeRequired();
    expect(domain).toBeRequired();
    expect(domain).toHaveAttribute("placeholder", "acme.com");
  });

  it("gives 'Create workspace' the step's sole Signal, and no Signal on 'Back'", () => {
    const { container } = render(<OnboardingFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Set up manually" }));

    const submit = screen.getByRole("button", { name: "Create workspace" });
    expect(submit).toHaveAttribute("data-signal", "true");
    expect(screen.getByRole("button", { name: "Back" })).not.toHaveAttribute("data-signal");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });
});

describe("OnboardingFlow — manual step validation error", () => {
  // Both fields carry a native `required` attribute, which blocks the
  // submit event entirely for a truly empty value before it ever reaches
  // createFirstWorkspace — exactly the same browser-native concern
  // documented in tests/components/invite-panel.dom.spec.tsx's error test.
  // These exercise the SERVER-side failure path instead: syntactically
  // non-empty values that still fail the server's own validation (a
  // whitespace-only name; a domain string with no dot), which is what
  // MISSING_NAME_MESSAGE / INVALID_DOMAIN_MESSAGE in onboarding-actions.ts
  // actually guard against.
  it("marks the company-name field invalid and preserves typed values on a name error", async () => {
    mockCreateFirstWorkspace.mockResolvedValueOnce(errorState(MISSING_NAME_MESSAGE));
    render(<OnboardingFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Set up manually" }));

    const companyName = screen.getByLabelText("Company name") as HTMLInputElement;
    const domain = screen.getByLabelText("Their website domain") as HTMLInputElement;
    fireEvent.change(companyName, { target: { value: "   " } });
    fireEvent.change(domain, { target: { value: "acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(MISSING_NAME_MESSAGE);
    expect(alert.querySelector(".ob-status-dot")).not.toBeNull();

    expect(companyName).toHaveAttribute("aria-invalid", "true");
    expect(domain).not.toHaveAttribute("aria-invalid");
    // Values survive the round trip — the form stays resubmittable.
    expect(domain.value).toBe("acme.com");
  });

  it("marks the domain field invalid on a domain error, and leaves the form resubmittable", async () => {
    mockCreateFirstWorkspace.mockResolvedValueOnce(errorState(INVALID_DOMAIN_MESSAGE));
    render(<OnboardingFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Set up manually" }));

    const companyName = screen.getByLabelText("Company name") as HTMLInputElement;
    const domain = screen.getByLabelText("Their website domain") as HTMLInputElement;
    fireEvent.change(companyName, { target: { value: "Acme Inc" } });
    fireEvent.change(domain, { target: { value: "not a domain" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(INVALID_DOMAIN_MESSAGE);

    expect(domain).toHaveAttribute("aria-invalid", "true");
    expect(companyName).not.toHaveAttribute("aria-invalid");
    expect(companyName.value).toBe("Acme Inc");

    const submit = screen.getByRole("button", { name: "Create workspace" });
    expect(submit).not.toBeDisabled();
  });

  it("clears a previous submission's error and aria-invalid when leaving the step and coming back (T41 review regression)", async () => {
    // Review finding (HIGH): with the action state hoisted into the parent,
    // a stale "Company name is required." alert and aria-invalid survived
    // Back-then-forward navigation onto a freshly blank remounted form. Each
    // step now owns its useActionState, so unmounting discards the error
    // together with the field state — this pins that.
    mockCreateFirstWorkspace.mockResolvedValueOnce(errorState(MISSING_NAME_MESSAGE));
    render(<OnboardingFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Set up manually" }));

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Their website domain"), { target: { value: "acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Set up manually" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const freshCompanyName = screen.getByLabelText("Company name") as HTMLInputElement;
    expect(freshCompanyName).not.toHaveAttribute("aria-invalid");
    expect(freshCompanyName.value).toBe("");
  });
});

describe("OnboardingFlow — manual step scrape-meta prefill (T46)", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    mockFetch.mockReset();
    vi.unstubAllGlobals();
  });

  function okResponse(body: unknown) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }

  function goToManualStep() {
    const rendered = render(<OnboardingFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Set up manually" }));
    return rendered;
  }

  it("renders the suggestion/hint live region on first render, empty, before any blur (accessibility review finding)", () => {
    const { container } = goToManualStep();

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: /use ".*" as the company name/i })).not.toBeInTheDocument();
  });

  it("prefills company name on a successful fetch when the seller hasn't typed one yet", async () => {
    mockFetch.mockReturnValueOnce(okResponse({ title: "Acme Inc", desc: null, favicon: null }));
    goToManualStep();

    const domain = screen.getByLabelText("Their website domain");
    fireEvent.change(domain, { target: { value: "acme.com" } });
    fireEvent.blur(domain);

    await screen.findByDisplayValue("Acme Inc");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/scrape-meta",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://acme.com" }),
      }),
    );
  });

  it("never silently overwrites a company name the seller already typed — offers an explicit 'use this' affordance instead", async () => {
    mockFetch.mockReturnValueOnce(okResponse({ title: "Acme Inc", desc: null, favicon: null }));
    const { container } = goToManualStep();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "My own name" } });

    const domain = screen.getByLabelText("Their website domain");
    fireEvent.change(domain, { target: { value: "acme.com" } });
    fireEvent.blur(domain);

    const useSuggestion = await screen.findByRole("button", { name: 'Use "Acme Inc" as the company name' });
    expect((screen.getByLabelText("Company name") as HTMLInputElement).value).toBe("My own name");
    expect(useSuggestion).not.toHaveAttribute("data-signal");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    fireEvent.click(useSuggestion);
    expect((screen.getByLabelText("Company name") as HTMLInputElement).value).toBe("Acme Inc");
  });

  it("clears a pending suggestion once the seller edits the company name themselves (review finding, MEDIUM)", async () => {
    // A non-empty company name at scrape-response time is what produces the
    // "use this" suggestion instead of a silent prefill (see the test above).
    mockFetch.mockReturnValueOnce(okResponse({ title: "Acme Inc", desc: null, favicon: null }));
    goToManualStep();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "My own name" } });

    const domain = screen.getByLabelText("Their website domain");
    fireEvent.change(domain, { target: { value: "acme.com" } });
    fireEvent.blur(domain);

    await screen.findByRole("button", { name: 'Use "Acme Inc" as the company name' });

    // The seller keeps typing their own name instead of using the offered
    // suggestion — the suggestion must disappear so it can never overwrite
    // whatever they type next.
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Something else" } });

    expect(screen.queryByRole("button", { name: /use ".*" as the company name/i })).not.toBeInTheDocument();
    expect((screen.getByLabelText("Company name") as HTMLInputElement).value).toBe("Something else");
  });

  it("degrades quietly on a non-OK response — no alert tone, no blocking, manual entry still works", async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "nope" }) }));
    goToManualStep();

    const domain = screen.getByLabelText("Their website domain");
    fireEvent.change(domain, { target: { value: "acme.com" } });
    fireEvent.blur(domain);

    await screen.findByText("Couldn't fetch details — enter them manually.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const companyName = screen.getByLabelText("Company name") as HTMLInputElement;
    expect(companyName).not.toBeDisabled();
    fireEvent.change(companyName, { target: { value: "Typed by hand" } });
    expect(companyName.value).toBe("Typed by hand");
  });

  it("degrades quietly on a network error/timeout — no alert, no retry loop", async () => {
    // Created lazily inside mockImplementationOnce (not mockReturnValueOnce)
    // so the rejected promise isn't constructed — and left unhandled — until
    // the component actually calls fetch() and immediately attaches .catch.
    mockFetch.mockImplementationOnce(() => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")));
    goToManualStep();

    const domain = screen.getByLabelText("Their website domain");
    fireEvent.change(domain, { target: { value: "acme.com" } });
    fireEvent.blur(domain);

    await screen.findByText("Couldn't fetch details — enter them manually.");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("submits identically whether or not the scrape ever ran", async () => {
    mockCreateFirstWorkspace.mockResolvedValueOnce(INITIAL_ONBOARDING_STATE);
    goToManualStep();

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme Inc" } });
    fireEvent.change(screen.getByLabelText("Their website domain"), { target: { value: "acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => expect(mockCreateFirstWorkspace).toHaveBeenCalled());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("only applies the latest domain's suggestion when an earlier request resolves after a later one (race guard)", async () => {
    // Deferred, not mockReturnValueOnce(okResponse(...)) — this test needs to
    // control exactly WHEN each fetch settles, resolving domain A's response
    // after domain B's despite A being requested first.
    const deferredA = createDeferred<{ title: string }>();
    const deferredB = createDeferred<{ title: string }>();
    mockFetch.mockReturnValueOnce(deferredA.promise.then((body) => ({ ok: true, json: () => Promise.resolve(body) })));
    mockFetch.mockReturnValueOnce(deferredB.promise.then((body) => ({ ok: true, json: () => Promise.resolve(body) })));
    goToManualStep();

    const domain = screen.getByLabelText("Their website domain");
    fireEvent.change(domain, { target: { value: "acme.com" } });
    fireEvent.blur(domain);

    // Before A's fetch resolves, the seller changes their mind and blurs a
    // second domain.
    fireEvent.change(domain, { target: { value: "beta.com" } });
    fireEvent.blur(domain);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // B settles first, then the stale A response lands after it.
    deferredB.resolve({ title: "Beta Co" });
    await screen.findByDisplayValue("Beta Co");

    deferredA.resolve({ title: "Acme Inc" });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    // A's stale title must never land, before or after B's.
    expect(screen.queryByDisplayValue("Acme Inc")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Company name") as HTMLInputElement).value).toBe("Beta Co");
  });

  it("does not throw when the component unmounts while a scrape request is still in flight", async () => {
    const deferred = createDeferred<{ title: string }>();
    mockFetch.mockReturnValueOnce(deferred.promise.then((body) => ({ ok: true, json: () => Promise.resolve(body) })));
    const { unmount } = goToManualStep();

    const domain = screen.getByLabelText("Their website domain");
    fireEvent.change(domain, { target: { value: "acme.com" } });
    fireEvent.blur(domain);

    expect(() => unmount()).not.toThrow();

    // Resolving after unmount must not throw — a stale setState call on an
    // already-unmounted fiber is a silent no-op in React 19, never an error.
    expect(() => deferred.resolve({ title: "Acme Inc" })).not.toThrow();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });
});

describe("OnboardingFlow — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(new NodeURL("../../app/admin/onboarding/onboarding.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
