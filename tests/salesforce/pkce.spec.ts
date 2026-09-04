// Sprint 11, Ticket 55 — unit coverage for lib/salesforce/pkce.ts. The S256
// case is checked against RFC 7636 Appendix B's own worked example, not just
// a round trip against this module's own generateCodeVerifier() — that
// guards against a subtly wrong (but internally self-consistent) hash/encode
// implementation that would still "round trip" with itself while producing a
// challenge Salesforce's server would reject.

import { describe, expect, it } from "vitest";

import { codeChallengeS256, generateCodeVerifier, PKCE_COOKIE_NAME, readCookieValue } from "@/lib/salesforce/pkce";

// RFC 7636 Appendix B.
const RFC7636_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC7636_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("codeChallengeS256", () => {
  it("matches RFC 7636 Appendix B's worked example", () => {
    expect(codeChallengeS256(RFC7636_VERIFIER)).toBe(RFC7636_CHALLENGE);
  });
});

describe("generateCodeVerifier", () => {
  it("produces a string within RFC 7636's 43-128 character range", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("uses only RFC 7636 §4.1's unreserved character set", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("produces a different verifier on every call", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it("round-trips through codeChallengeS256 without throwing", () => {
    const verifier = generateCodeVerifier();
    expect(() => codeChallengeS256(verifier)).not.toThrow();
    expect(codeChallengeS256(verifier)).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

describe("readCookieValue", () => {
  it("returns null when the Cookie header is absent", () => {
    expect(readCookieValue(null, PKCE_COOKIE_NAME)).toBeNull();
  });

  it("returns null when the named cookie isn't present", () => {
    expect(readCookieValue("other_cookie=abc; another=def", PKCE_COOKIE_NAME)).toBeNull();
  });

  it("finds the named cookie among several, regardless of position", () => {
    const header = `first=1; ${PKCE_COOKIE_NAME}=the-verifier-value; last=3`;
    expect(readCookieValue(header, PKCE_COOKIE_NAME)).toBe("the-verifier-value");
  });

  it("finds the named cookie when it's the only one", () => {
    expect(readCookieValue(`${PKCE_COOKIE_NAME}=solo-value`, PKCE_COOKIE_NAME)).toBe("solo-value");
  });

  it("URL-decodes the cookie value", () => {
    const header = `${PKCE_COOKIE_NAME}=${encodeURIComponent("a+b/c=")}`;
    expect(readCookieValue(header, PKCE_COOKIE_NAME)).toBe("a+b/c=");
  });
});
