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

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(screen.getByRole("button", { name: "CSV import" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "From your website" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "From your CRM" })).toBeInTheDocument();
  });

  it("renders the three placeholder paths as genuinely inert (real disabled semantics, not a focus trap)", () => {
    render(<OnboardingFlow />);

    const csvButton = screen.getByRole("button", { name: "CSV import" });
    const websiteButton = screen.getByRole("button", { name: "From your website" });
    const crmButton = screen.getByRole("button", { name: "From your CRM" });

    for (const button of [csvButton, websiteButton, crmButton]) {
      expect(button).toBeDisabled();
    }

    // Honest copy naming what arrives, no "coming soon", no apology, no emoji.
    expect(screen.getAllByText(/Follows CRM import\./)).toHaveLength(2);
    expect(screen.getByText(/Sync deal data directly from your CRM\. Arrives next\./)).toBeInTheDocument();

    fireEvent.click(csvButton);
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

describe("OnboardingFlow — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(new NodeURL("../../app/admin/onboarding/onboarding.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
