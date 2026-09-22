// Sprint 12, Ticket 65 — "Password Reset Flow" (security review HIGH-1).
// Pure unit coverage for lib/auth/recovery-cooldown.ts: the durable,
// instance-independent per-account brake on reset emails. Generating the
// recovery link ourselves (admin.generateLink) skips GoTrue's own send
// throttle, and lib/rate-limit.ts is in-memory per serverless instance — so
// without this, nothing durable stops one inbox being flooded or the Resend
// quota (shared with buyer access-code emails) being burned.
//
// DB-free: global fetch is stubbed. The real GoTrue behaviour this relies on
// (generateLink stamps recovery_sent_at; the admin users endpoint filters by
// email) is pinned live in tests/security/password-reset.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RECOVERY_COOLDOWN_SECONDS, isWithinRecoveryCooldown } from "@/lib/auth/recovery-cooldown";

const EMAIL = "seller@example.com";
const NOW = new Date("2026-09-21T20:00:00Z");
const MS_PER_SECOND = 1000;

interface AdminUser {
  readonly email: string;
  readonly recovery_sent_at?: string | null;
}

function secondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * MS_PER_SECOND).toISOString();
}

function respondWith(users: AdminUser[], status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ users }), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isWithinRecoveryCooldown", () => {
  it("is true when a reset was sent to the account moments ago", async () => {
    respondWith([{ email: EMAIL, recovery_sent_at: secondsAgo(5) }]);

    expect(await isWithinRecoveryCooldown(EMAIL)).toBe(true);
  });

  it("is false once the cooldown has passed", async () => {
    respondWith([{ email: EMAIL, recovery_sent_at: secondsAgo(RECOVERY_COOLDOWN_SECONDS + 1) }]);

    expect(await isWithinRecoveryCooldown(EMAIL)).toBe(false);
  });

  it("is false for an account that never had a reset sent", async () => {
    respondWith([{ email: EMAIL, recovery_sent_at: null }]);

    expect(await isWithinRecoveryCooldown(EMAIL)).toBe(false);
  });

  it("is false when no account has that email", async () => {
    respondWith([]);

    expect(await isWithinRecoveryCooldown(EMAIL)).toBe(false);
  });

  it("ignores a different account whose email merely contains the one asked for", async () => {
    // The endpoint's `filter` is a substring match, so an exact comparison
    // must happen here.
    respondWith([{ email: `jim${EMAIL}`, recovery_sent_at: secondsAgo(5) }]);

    expect(await isWithinRecoveryCooldown(EMAIL)).toBe(false);
  });

  it("asks the admin users endpoint for that email, authenticated with the service role", async () => {
    const fetchMock = respondWith([]);

    await isWithinRecoveryCooldown(EMAIL);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requested = new URL(url);
    expect(requested.origin).toBe("https://example.supabase.co");
    expect(requested.pathname).toBe("/auth/v1/admin/users");
    expect(requested.searchParams.get("filter")).toBe(EMAIL);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer service-role-test-key");
  });

  it("is false (the reset still goes ahead) when the lookup fails, and never logs the email", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    respondWith([], 500);

    expect(await isWithinRecoveryCooldown(EMAIL)).toBe(false);
    expect(errorSpy.mock.calls.flat().map(String).join(" ")).not.toContain(EMAIL);
  });

  it("is false when the lookup throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    expect(await isWithinRecoveryCooldown(EMAIL)).toBe(false);
  });
});
