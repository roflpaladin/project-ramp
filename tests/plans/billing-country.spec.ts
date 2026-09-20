// Sprint 12, Ticket 67 (slice 1, founder scope amendment). Unit coverage
// for lib/billing/country.ts — the one seam that normalises Vercel's
// x-vercel-ip-country header (including its "XX" unknown/reserved sentinel)
// into either a real 2-letter code or null before it can reach
// Paddle.PricePreview. Pure function, no env/network involved.

import { describe, expect, it } from "vitest";

import { resolveVercelCountryCode } from "@/lib/billing/country";

describe("resolveVercelCountryCode", () => {
  it("uppercases and returns a well-formed 2-letter code", () => {
    expect(resolveVercelCountryCode("de")).toBe("DE");
    expect(resolveVercelCountryCode("US")).toBe("US");
  });

  it("returns null when the header is absent", () => {
    expect(resolveVercelCountryCode(undefined)).toBeNull();
    expect(resolveVercelCountryCode(null)).toBeNull();
  });

  it("returns null when the header is blank", () => {
    expect(resolveVercelCountryCode("")).toBeNull();
    expect(resolveVercelCountryCode("   ")).toBeNull();
  });

  it("returns null for Vercel's XX unknown/reserved sentinel, case-insensitively", () => {
    expect(resolveVercelCountryCode("XX")).toBeNull();
    expect(resolveVercelCountryCode("xx")).toBeNull();
  });

  it("returns null for a value that isn't a 2-letter code, never throwing", () => {
    expect(resolveVercelCountryCode("USA")).toBeNull();
    expect(resolveVercelCountryCode("1")).toBeNull();
    expect(resolveVercelCountryCode("!!")).toBeNull();
  });
});
