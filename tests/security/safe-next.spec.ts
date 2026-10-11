// Sprint 12, Ticket 67 — open-redirect guard for post-auth `?next=` returns.
// Pure unit coverage for lib/navigation/safe-next.ts.

import { describe, expect, it } from "vitest";
import { MAX_NEXT_LENGTH, parseSafeNext } from "@/lib/navigation/safe-next";

describe("parseSafeNext — accepted", () => {
  it.each([
    "/pricing",
    "/pricing/",
    "/pricing?plan=starter",
    "/settings/billing",
    "/settings/billing?x=1&y=2",
    "/admin",
    "/admin/onboarding",
    "/admin/workspaces/new",
    "/admin/@evil.com",
    "/admin?//evil.com",
    "/admin//evil.com",
    "/admin/.",
    "/pricing/./",
  ])("keeps %s", (value) => {
    expect(parseSafeNext(value)).toBe(value);
  });
});

describe("parseSafeNext — length boundary", () => {
  const prefix = "/pricing?x=";
  it("accepts exactly MAX_NEXT_LENGTH", () => {
    const value = prefix + "a".repeat(MAX_NEXT_LENGTH - prefix.length);
    expect(value).toHaveLength(MAX_NEXT_LENGTH);
    expect(parseSafeNext(value)).toBe(value);
  });

  it("rejects MAX_NEXT_LENGTH + 1", () => {
    expect(parseSafeNext(prefix + "a".repeat(MAX_NEXT_LENGTH - prefix.length + 1))).toBeNull();
  });
});

describe("parseSafeNext — rejected", () => {
  it.each([
    ["empty", ""],
    ["no leading slash", "pricing"],
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/pricing"],
    ["slash-backslash", "/\\evil.com"],
    ["backslash mid-path", "/pricing\\..\\evil"],
    ["absolute https", "https://evil.com"],
    ["absolute http in path", "http://evil.com/pricing"],
    ["javascript scheme", "javascript:alert(1)"],
    ["uppercase javascript scheme", "JaVaScRiPt:alert(1)"],
    ["data scheme", "data:text/html,x"],
    ["encoded double slash", "%2F%2Fevil.com"],
    ["encoded slash after allowed prefix", "/pricing%2F%2Fevil.com"],
    ["encoded backslash", "/%5Cevil.com"],
    ["encoded backslash lowercase", "/pricing%5cevil"],
    ["tab", "/pri\tcing"],
    ["newline", "/pricing\nLocation: x"],
    ["carriage return", "/pricing\r"],
    ["null byte", "/pricing\u0000"],
    ["space", "/pricing x"],
    ["leading whitespace", " /pricing"],
    ["fragment", "/pricing#x"],
    ["dot-dot traversal", "/pricing/../evil"],
    ["not on the allow-list", "/evil"],
    ["prefix lookalike", "/pricingevil"],
    ["admin lookalike", "/administrator"],
    ["root", "/"],
    ["userinfo-style host", "/admin@evil.com"],
    ["semicolon", "/admin;x"],
    ["leading dot segment", "/./pricing"],
    ["trailing dot-dot", "/pricing/.."],
    ["dot-dot with semicolon", "/admin/..;/x"],
    ["slash backslash slash", "/\\/pricing"],
    ["cyrillic a lookalike", "/\u0430dmin"],
    ["fullwidth slash", "/pricing\uff0fx"],
    ["denied login", "/admin/login"],
    ["denied login with query", "/admin/login?error=x"],
    ["denied login subpath", "/admin/login/x"],
    ["login deny is by segment", "/admin/login/"],
    ["too long", `/pricing?x=${"a".repeat(MAX_NEXT_LENGTH)}`],
  ])("drops %s", (_label, value) => {
    expect(parseSafeNext(value)).toBeNull();
  });

  it.each([undefined, null, 42, {}, ["/pricing"]])("drops non-string %j", (value) => {
    expect(parseSafeNext(value)).toBeNull();
  });
});
