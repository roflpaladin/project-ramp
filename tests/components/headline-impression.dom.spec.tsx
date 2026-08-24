// T48 (Sprint 9, Ticket 48 — headline variant instrumentation).
// Component-level DOM assertions for app/headline-impression.tsx. Runs
// under the "components" Vitest project (happy-dom) — see vitest.config.ts.
//
// The real /api/landing-events route is being built in parallel by the
// backend agent (out of this file's scope entirely) — `fetch` itself is
// mocked at the global level, mirroring waitlist-form.dom.spec.tsx's house
// style. sessionStorage is happy-dom's real implementation (not mocked),
// so the dedupe guard is exercised for real; `sessionStorage.clear()` in
// beforeEach keeps each test's session state isolated from the last.
//
// Coverage per the ticket brief: exactly one impression POST per session
// (a second mount in the same session must not double-fire); a rejected
// fetch never throws or otherwise breaks rendering.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { HeadlineImpressionPing } from "@/app/headline-impression";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  mockFetch.mockReset();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("HeadlineImpressionPing — fires once per session", () => {
  it("POSTs the assigned variant exactly once on mount", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    render(<HeadlineImpressionPing variant="with-not-at" />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/landing-events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ event: "impression", variant: "with-not-at" }),
      }),
    );
  });

  it("does not fire a second impression for a second mount in the same session", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const first = render(<HeadlineImpressionPing variant="control" />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<HeadlineImpressionPing variant="control" />);
    // Give any (incorrect) second call a chance to happen before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("renders nothing", () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { container } = render(<HeadlineImpressionPing variant="control" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("HeadlineImpressionPing — failure is swallowed", () => {
  it("never throws when the ping's fetch rejects (network failure)", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    expect(() => render(<HeadlineImpressionPing variant="control" />)).not.toThrow();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });

  it("never throws when the ping resolves with a failure status (400/429)", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 429 }));

    expect(() => render(<HeadlineImpressionPing variant="control" />)).not.toThrow();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });
});
