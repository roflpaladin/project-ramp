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
  ])("keeps %s", (value) => {
    expect(parseSafeNext(value)).toBe(value);
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
    ["too long", `/pricing?x=${"a".repeat(MAX_NEXT_LENGTH)}`],
  ])("drops %s", (_label, value) => {
    expect(parseSafeNext(value)).toBeNull();
  });

  it.each([undefined, null, 42, {}, ["/pricing"]])("drops non-string %j", (value) => {
    expect(parseSafeNext(value)).toBeNull();
  });
});
