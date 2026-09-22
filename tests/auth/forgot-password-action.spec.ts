// Sprint 12, Ticket 65 — "Password Reset Flow". Behavioural coverage for
// app/forgot-password/actions.ts's requestReset. The AC this file pins: the
// caller sees the SAME outcome whether the email has an account, has none,
// or the caller is over budget — no account enumeration, no limiter probe.
//
// DB-free: lib/auth/password-reset's requestPasswordReset (the part that
// talks to Supabase and Resend) is mocked, as are next/headers,
// next/navigation and next/server's after(). The real lookup + link is
// pinned live in tests/security/password-reset.spec.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PASSWORD_RESET_RATE_LIMIT, resetRateLimiterForTests } from "@/lib/rate-limit";

const SENT_LOCATION = "/forgot-password?sent=1";

const { requestPasswordReset, requestHeaders, afterCallbacks } = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(async () => ({ sent: true })),
  requestHeaders: { value: new Headers() },
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock("@/lib/auth/password-reset", () => ({ requestPasswordReset }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => requestHeaders.value),
}));

// after() defers work until the response is out. Captured here and run
// explicitly, so a test can prove the redirect does not wait on the send.
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    afterCallbacks.push(callback);
  },
}));

class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`redirect:${location}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new RedirectSignal(location);
  },
}));

const { requestReset } = await import("@/app/forgot-password/actions");

function formWith(email: string | null): FormData {
  const form = new FormData();
  if (email !== null) form.set("email", email);
  return form;
}

async function submit(email: string | null): Promise<string> {
  try {
    await requestReset(formWith(email));
  } catch (error) {
    if (error instanceof RedirectSignal) return error.location;
    throw error;
  }
  throw new Error("action returned without redirecting");
}

async function runDeferredWork(): Promise<void> {
  for (const callback of afterCallbacks.splice(0)) {
    await callback();
  }
}

function callFrom(ip: string): void {
  requestHeaders.value = new Headers({ "x-forwarded-for": ip, origin: "http://localhost:3000" });
}

beforeEach(() => {
  resetRateLimiterForTests();
  requestPasswordReset.mockClear();
  requestPasswordReset.mockResolvedValue({ sent: true });
  afterCallbacks.length = 0;
  callFrom("203.0.113.10");
});

describe("requestReset — same answer every time", () => {
  it("confirms and hands the email to the reset sender", async () => {
    const location = await submit("  Seller@Example.com ");
    await runDeferredWork();

    expect(location).toBe(SENT_LOCATION);
    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(requestPasswordReset).toHaveBeenCalledWith({
      email: "seller@example.com",
      origin: "http://localhost:3000",
    });
  });

  it("confirms before the send runs, so timing does not reveal whether an account exists", async () => {
    const location = await submit("seller@example.com");

    expect(location).toBe(SENT_LOCATION);
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(afterCallbacks).toHaveLength(1);
  });

  it("gives the same confirmation when the sender reports nothing was sent", async () => {
    requestPasswordReset.mockResolvedValue({ sent: false });

    const location = await submit("nobody@example.com");
    await runDeferredWork();

    expect(location).toBe(SENT_LOCATION);
  });

  it("does not surface a sender failure to the caller", async () => {
    requestPasswordReset.mockRejectedValue(new Error("supabase unreachable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const location = await submit("seller@example.com");

    expect(location).toBe(SENT_LOCATION);
    await expect(runDeferredWork()).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe("requestReset — input", () => {
  it.each([null, "", "   ", "not-an-email", "a@b"])("asks for a valid email when given %j", async (email) => {
    const location = await submit(email);
    await runDeferredWork();

    expect(location).toBe("/forgot-password?error=invalid_email");
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe("requestReset — rate limits", () => {
  it("stops sending for one email once its budget is spent, with the same confirmation", async () => {
    for (let attempt = 0; attempt < PASSWORD_RESET_RATE_LIMIT.limit; attempt += 1) {
      callFrom(`203.0.113.${attempt + 20}`);
      await submit("target@example.com");
    }
    await runDeferredWork();
    requestPasswordReset.mockClear();

    callFrom("203.0.113.99");
    const location = await submit("target@example.com");
    await runDeferredWork();

    expect(location).toBe(SENT_LOCATION);
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("treats differently-cased spellings as the same email", async () => {
    for (let attempt = 0; attempt < PASSWORD_RESET_RATE_LIMIT.limit; attempt += 1) {
      callFrom(`203.0.113.${attempt + 20}`);
      await submit("target@example.com");
    }
    await runDeferredWork();
    requestPasswordReset.mockClear();

    callFrom("203.0.113.98");
    await submit("TARGET@example.com");
    await runDeferredWork();

    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("stops sending for one caller address once its budget is spent, with the same confirmation", async () => {
    for (let attempt = 0; attempt < PASSWORD_RESET_RATE_LIMIT.limit; attempt += 1) {
      await submit(`victim-${attempt}@example.com`);
    }
    await runDeferredWork();
    requestPasswordReset.mockClear();

    const location = await submit("one-more@example.com");
    await runDeferredWork();

    expect(location).toBe(SENT_LOCATION);
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("keeps one caller's spent budget from blocking another caller", async () => {
    for (let attempt = 0; attempt < PASSWORD_RESET_RATE_LIMIT.limit; attempt += 1) {
      await submit(`victim-${attempt}@example.com`);
    }
    await runDeferredWork();
    requestPasswordReset.mockClear();

    callFrom("198.51.100.7");
    await submit("someone-else@example.com");
    await runDeferredWork();

    expect(requestPasswordReset).toHaveBeenCalledTimes(1);
  });
});
