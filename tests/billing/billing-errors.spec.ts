// Sprint 12, Ticket 59 (slice 2 code review fix — HIGH, reflected content
// spoofing). app/settings/billing/page.tsx used to render `?error=<raw text>`
// verbatim inside a trusted page — anyone could craft
// `/settings/billing?error=<phishing text>` and have it displayed as if it
// came from us. app/settings/billing/billing-errors.ts closes that off with
// a fixed, closed set of codes: the free-text param is replaced entirely, so
// there is nothing left to reflect.

import { describe, expect, it } from "vitest";

import { messageForBillingErrorCode } from "@/app/settings/billing/billing-errors";

describe("messageForBillingErrorCode — known codes", () => {
  const KNOWN_CODES = ["signed_out", "no_account", "rate_limited", "misconfigured", "generic"] as const;

  for (const code of KNOWN_CODES) {
    it(`returns a fixed, non-empty message for "${code}"`, () => {
      const message = messageForBillingErrorCode(code);
      expect(typeof message).toBe("string");
      expect((message as string).length).toBeGreaterThan(0);
    });
  }

  it("returns a different message for each code (no accidental collisions)", () => {
    const messages = KNOWN_CODES.map((code) => messageForBillingErrorCode(code));
    expect(new Set(messages).size).toBe(KNOWN_CODES.length);
  });
});

describe("messageForBillingErrorCode — absent", () => {
  it("returns null when the param is absent", () => {
    expect(messageForBillingErrorCode(undefined)).toBeNull();
  });
});

describe("messageForBillingErrorCode — attacker-supplied / unknown values never reflected", () => {
  it("returns the generic message for an arbitrary attacker-supplied string, never the string itself", () => {
    const attackerText = "Your card was declined — call 1-800-555-0100 to verify your identity";

    const message = messageForBillingErrorCode(attackerText);

    expect(message).not.toBe(attackerText);
    expect(message).not.toContain(attackerText);
    expect(message).toBe(messageForBillingErrorCode("generic"));
  });

  it("returns the generic message for an unrecognised short code", () => {
    expect(messageForBillingErrorCode("not_a_real_code")).toBe(messageForBillingErrorCode("generic"));
  });

  it("returns the generic message for a duplicated query param (array value), never crashing", () => {
    expect(messageForBillingErrorCode(["signed_out", "no_account"])).toBe(messageForBillingErrorCode("generic"));
  });

  it("returns the generic message for a non-string, non-array value", () => {
    expect(messageForBillingErrorCode(42)).toBe(messageForBillingErrorCode("generic"));
    expect(messageForBillingErrorCode({})).toBe(messageForBillingErrorCode("generic"));
    expect(messageForBillingErrorCode(null)).toBe(messageForBillingErrorCode("generic"));
  });

  it("never contains HTML/script-looking content regardless of input", () => {
    const message = messageForBillingErrorCode("<script>alert(1)</script>");
    expect(message).not.toContain("<script>");
  });
});
