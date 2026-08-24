// T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Component-level
// DOM assertions for app/waitlist-form.tsx. Runs under the "components"
// Vitest project (happy-dom) — see vitest.config.ts.
//
// The real /api/waitlist route is being built in parallel by the backend
// agent (out of this file's scope entirely) — `fetch` itself is mocked at
// the global level here, mirroring the house style of mocking a "use
// server" action wholesale in onboarding-flow.dom.spec.tsx /
// invite-panel.dom.spec.tsx. This file only exercises WaitlistForm's own
// rendering/state-transition logic against a fetch Response shape, never a
// real network call.
//
// Coverage per the ticket brief: idle renders a labelled email input and
// the form's sole Signal submit button; submitting disables the input and
// swaps the button's label for a spinner at the button's own width with no
// layout shift; any 2xx response replaces the form with a dot+text success
// confirmation (never colour-only) and leaves no way to tell from the UI
// whether the email already existed; a 429 renders a recoverable "too many
// attempts" dot+text alert and leaves the form resubmittable; any other
// non-2xx or a thrown network error renders a recoverable generic dot+text
// alert and leaves the form resubmittable; a static grep proves the scoped
// CSS carries no hardcoded hex colour (house convention, see
// stall-alert.dom.spec.tsx).

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as WaitlistFormModule from "@/app/waitlist-form";
import { WaitlistForm } from "@/app/waitlist-form";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/**
 * Same pattern as onboarding-flow.dom.spec.tsx / invite-panel.dom.spec.tsx:
 * a permanently-unresolved promise would otherwise leave an act() warning
 * and a dangling timer across tests. WaitlistForm uses plain useState (not
 * useActionState), so nothing here is entangled across tests the way the
 * Server Action tests are — this is just to freeze mid-flight for the
 * pending-presentation assertion.
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  cleanup();
  mockFetch.mockReset();
  vi.unstubAllGlobals();
});

async function submitWaitlist(email: string): Promise<void> {
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
}

describe("module boundary — single entry point", () => {
  it("exports exactly one runtime value: WaitlistForm", () => {
    expect(Object.keys(WaitlistFormModule)).toEqual(["WaitlistForm"]);
  });
});

describe("WaitlistForm — idle", () => {
  it("renders a labelled email input and exactly one Signal submit button, no status", () => {
    const { container } = render(<WaitlistForm headlineVariant="control" />);

    const input = screen.getByLabelText("Work email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toBeRequired();

    const submit = screen.getByRole("button", { name: "Join the waitlist" });
    expect(submit).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("WaitlistForm — submitting presentation", () => {
  it("disables the input and swaps the button's label for a spinner at the button's own width, with no layout shift", async () => {
    const deferred = createDeferred<Response>();
    mockFetch.mockReturnValueOnce(deferred.promise);
    render(<WaitlistForm headlineVariant="control" />);

    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ae@acme.example" } });
    const submit = screen.getByRole("button", { name: "Join the waitlist" });
    fireEvent.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(submit).toHaveAccessibleName("Joining waitlist");
    expect(submit.querySelector(".lp-spinner")).not.toBeNull();
    // The label stays in the DOM (opacity only) rather than being removed —
    // that's what keeps the button at its own width instead of reflowing.
    expect(submit).toHaveTextContent("Join the waitlist");
    expect(screen.getByLabelText("Work email")).toBeDisabled();

    deferred.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Join the waitlist" })).not.toBeInTheDocument());
  });
});

describe("WaitlistForm — success", () => {
  it("replaces the form with a dot+text confirmation on any 2xx response", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    render(<WaitlistForm headlineVariant="control" />);

    await submitWaitlist("buyer@acme.example");

    const status = await screen.findByRole("status");
    expect(status.querySelector(".lp-status-dot")).not.toBeNull();
    expect(status).toHaveTextContent(/on the list/i);
    expect(status).toHaveAttribute("data-tone", "done");

    // No way to enumerate whether the email already existed — the same
    // confirmation renders regardless, and the form/input are fully gone.
    expect(screen.queryByLabelText("Work email")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join the waitlist" })).not.toBeInTheDocument();
  });

  it("also treats a bare 201/204-style 2xx as success (defensive envelope handling)", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(<WaitlistForm headlineVariant="control" />);

    await submitWaitlist("buyer@acme.example");

    expect(await screen.findByRole("status")).toHaveTextContent(/on the list/i);
  });
});

describe("WaitlistForm — 429 (recoverable)", () => {
  it("renders a 'too many attempts' dot+text alert and leaves the form resubmittable", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }));
    render(<WaitlistForm headlineVariant="control" />);

    await submitWaitlist("buyer@acme.example");

    const alert = await screen.findByRole("alert");
    expect(alert.querySelector(".lp-status-dot")).not.toBeNull();
    expect(alert).toHaveTextContent(/too many attempts/i);
    expect(alert).toHaveAttribute("data-tone", "risk");

    const input = screen.getByLabelText("Work email") as HTMLInputElement;
    expect(input).not.toBeDisabled();
    expect(input.value).toBe("buyer@acme.example");
    expect(screen.getByRole("button", { name: "Join the waitlist" })).not.toBeDisabled();
  });
});

describe("WaitlistForm — other server error (recoverable)", () => {
  it("renders a generic recoverable alert on a non-2xx, non-429 response, never a raw status/body", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    render(<WaitlistForm headlineVariant="control" />);

    await submitWaitlist("buyer@acme.example");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Try again.");
    expect(alert).not.toHaveTextContent(/500/);
    expect(alert).not.toHaveTextContent("boom");

    expect(screen.getByLabelText("Work email")).not.toBeDisabled();
  });
});

describe("WaitlistForm — network failure (recoverable)", () => {
  it("renders the same generic recoverable alert when fetch itself throws", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<WaitlistForm headlineVariant="control" />);

    await submitWaitlist("buyer@acme.example");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Try again.");

    expect(screen.getByRole("button", { name: "Join the waitlist" })).not.toBeDisabled();
  });
});

describe("WaitlistForm — retry after an error", () => {
  it("clears the alert and allows a second submission to succeed", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    render(<WaitlistForm headlineVariant="control" />);

    await submitWaitlist("buyer@acme.example");
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByRole("status")).toHaveTextContent(/on the list/i);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("WaitlistForm — request contract", () => {
  it("POSTs { email, source } as JSON to /api/waitlist, source tagged with the control variant", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    render(<WaitlistForm headlineVariant="control" />);

    await submitWaitlist("buyer@acme.example");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/waitlist",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "buyer@acme.example", source: "headline:control" }),
      }),
    );
  });

  // T48: source must reflect whichever variant the page actually assigned
  // this visit, not just whatever the other tests in this file default to.
  it("tags source with the assigned variant when it's the candidate headline", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    render(<WaitlistForm headlineVariant="with-not-at" />);

    await submitWaitlist("buyer@acme.example");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/waitlist",
      expect.objectContaining({
        body: JSON.stringify({ email: "buyer@acme.example", source: "headline:with-not-at" }),
      }),
    );
  });
});

describe("WaitlistForm — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(new NodeURL("../../app/landing.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
