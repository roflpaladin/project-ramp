// Sprint 12, Ticket 62 — "Self-Serve Hardening Pass". Pure unit coverage for
// lib/client-ip.ts: the ONE place a rate-limit key's caller address comes
// from, replacing six hand-copied `x-forwarded-for` first-entry idioms.
//
// What the Sprint 12 panel got right and wrong, pinned here as tests:
//   - On Vercel, x-forwarded-for is overwritten by the platform ("to prevent
//     IP spoofing" — vercel.com/docs/headers/request-headers), so a client
//     cannot forge it there. x-vercel-forwarded-for carries the same value
//     and additionally survives a proxy placed in front of Vercel, so it is
//     the header to prefer.
//   - OFF Vercel (local dev, any other host) every forwarding header is just
//     something the client typed. It is still used — a limiter needs SOME
//     key — but never in preference to the platform header.
// DB-free, no network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UNKNOWN_CLIENT_IP, clientIp } from "@/lib/client-ip";

function headersOf(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

beforeEach(() => {
  vi.stubEnv("VERCEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIp — on Vercel", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
  });

  it("uses the platform-set x-vercel-forwarded-for", () => {
    const ip = clientIp(headersOf({ "x-vercel-forwarded-for": "203.0.113.7" }));

    expect(ip).toBe("203.0.113.7");
  });

  it("prefers the platform header over a client-supplied x-forwarded-for", () => {
    const ip = clientIp(
      headersOf({ "x-forwarded-for": "198.51.100.99", "x-vercel-forwarded-for": "203.0.113.7" }),
    );

    expect(ip).toBe("203.0.113.7");
  });

  it("does NOT fall back to x-forwarded-for when the platform header is absent", () => {
    // If Vercel's header is missing something is wrong with the request path;
    // trusting a forgeable header at that moment is exactly backwards.
    const ip = clientIp(headersOf({ "x-forwarded-for": "198.51.100.99", "x-real-ip": "198.51.100.98" }));

    expect(ip).toBe(UNKNOWN_CLIENT_IP);
  });

  it("takes the first entry when the platform header carries a list", () => {
    const ip = clientIp(headersOf({ "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1" }));

    expect(ip).toBe("203.0.113.7");
  });
});

describe("clientIp — off Vercel", () => {
  it("uses the first x-forwarded-for entry", () => {
    const ip = clientIp(headersOf({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));

    expect(ip).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(headersOf({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
  });

  it("ignores x-vercel-forwarded-for, which off Vercel is just a client-typed header", () => {
    const ip = clientIp(headersOf({ "x-vercel-forwarded-for": "198.51.100.99", "x-forwarded-for": "203.0.113.7" }));

    expect(ip).toBe("203.0.113.7");
  });
});

describe("clientIp — hostile or missing values", () => {
  it.each([
    ["no headers at all", {}],
    ["an empty header", { "x-forwarded-for": "" }],
    ["an empty first entry", { "x-forwarded-for": ", 203.0.113.7" }],
    ["whitespace only", { "x-forwarded-for": "   " }],
    ["not an IP address", { "x-forwarded-for": "not-an-ip" }],
    ["an injection attempt", { "x-forwarded-for": "203.0.113.7:evil-suffix" }],
  ])("returns the shared unknown bucket for %s", (_label, entries) => {
    expect(clientIp(headersOf(entries))).toBe(UNKNOWN_CLIENT_IP);
  });

  it("caps pathological length before it can become a storage key", () => {
    const ip = clientIp(headersOf({ "x-forwarded-for": "1".repeat(5000) }));

    expect(ip).toBe(UNKNOWN_CLIENT_IP);
  });

  it("accepts and lower-cases an IPv6 address", () => {
    expect(clientIp(headersOf({ "x-forwarded-for": "2001:DB8::1" }))).toBe("2001:db8::1");
  });
});
