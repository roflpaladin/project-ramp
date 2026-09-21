// Sprint 12, Ticket 65 — "Password Reset Flow". Pure unit coverage for
// lib/auth/app-origin.ts: the base address a password-reset link is built
// on. The link carries a one-time token to a third party's inbox, so in
// production it must come from deploy configuration only — never from a
// request header a caller can forge. No database, no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAppOrigin } from "@/lib/auth/app-origin";

const PRODUCTION_ORIGIN = "https://www.getbrava.tech";

function headersOf(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VERCEL_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveAppOrigin", () => {
  it("prefers the configured app address and strips any path or trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.getbrava.tech/");

    const origin = resolveAppOrigin(headersOf({ origin: "https://evil.example" }));

    expect(origin).toBe(PRODUCTION_ORIGIN);
  });

  it("ignores forged request headers in production when no address is configured", () => {
    vi.stubEnv("NODE_ENV", "production");

    const origin = resolveAppOrigin(
      headersOf({
        origin: "https://evil.example",
        host: "evil.example",
        "x-forwarded-host": "evil.example",
      }),
    );

    expect(origin).toBe(PRODUCTION_ORIGIN);
  });

  it("uses the platform-set preview address on a Vercel preview deployment", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "ramp-git-branch-team.vercel.app");

    const origin = resolveAppOrigin(headersOf({ origin: "https://evil.example" }));

    expect(origin).toBe("https://ramp-git-branch-team.vercel.app");
  });

  it("falls back to the production address when the configured value is not http(s)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "javascript:alert(1)");

    expect(resolveAppOrigin(headersOf({}))).toBe(PRODUCTION_ORIGIN);
  });

  it("derives the address from the request in local development", () => {
    vi.stubEnv("NODE_ENV", "development");

    const origin = resolveAppOrigin(headersOf({ origin: "http://localhost:3000" }));

    expect(origin).toBe("http://localhost:3000");
  });

  it("falls back to host in local development when the origin header is absent", () => {
    vi.stubEnv("NODE_ENV", "development");

    const origin = resolveAppOrigin(headersOf({ host: "localhost:3000" }));

    expect(origin).toBe("http://localhost:3000");
  });
});
