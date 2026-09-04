// Sprint 11, Ticket 55 — unit coverage for lib/salesforce/oauth-state.ts's
// signed OAuth `state` param. Mirrors tests/hubspot/oauth-state.spec.ts 1:1;
// the one behavioral addition is the key-separation check at the bottom,
// proving this module's HMAC subkey is NOT the same as HubSpot's (distinct
// HKDF info string, per this ticket's brief).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signOAuthState, verifyOAuthState } from "@/lib/salesforce/oauth-state";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";

describe("signOAuthState / verifyOAuthState (Salesforce)", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "e".repeat(64));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("round-trips: a freshly signed state verifies back to the same tenantId", () => {
    const state = signOAuthState(TENANT_ID);
    expect(verifyOAuthState(state)).toEqual({ tenantId: TENANT_ID });
  });

  it("rejects a state with an altered tenantId segment", () => {
    const state = signOAuthState(TENANT_ID);
    const [, expiresAt, signature] = state.split(".");
    const tampered = `33333333-3333-3333-3333-333333333333.${expiresAt}.${signature}`;
    expect(verifyOAuthState(tampered)).toBeNull();
  });

  it("rejects a state with an altered signature", () => {
    const state = signOAuthState(TENANT_ID);
    const [tenantId, expiresAt, signature] = state.split(".");
    const tamperedSignature = signature.slice(0, -1) + (signature.at(-1) === "a" ? "b" : "a");
    expect(verifyOAuthState(`${tenantId}.${expiresAt}.${tamperedSignature}`)).toBeNull();
  });

  it("rejects a malformed state string", () => {
    expect(verifyOAuthState("not-a-valid-state")).toBeNull();
  });

  it("accepts a state right up to its TTL boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const state = signOAuthState(TENANT_ID);

    vi.setSystemTime(new Date("2026-01-01T00:09:59Z")); // 9m59s later, within the 10-min TTL.
    expect(verifyOAuthState(state)).toEqual({ tenantId: TENANT_ID });
  });

  it("rejects a state past its 10-minute TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const state = signOAuthState(TENANT_ID);

    vi.setSystemTime(new Date("2026-01-01T00:10:01Z")); // just past the 10-min TTL.
    expect(verifyOAuthState(state)).toBeNull();
  });

  it("derives a signature independent from HubSpot's oauth-state module (distinct HKDF info string)", async () => {
    const { signOAuthState: signHubSpotState } = await import("@/lib/hubspot/oauth-state");

    // Freeze time so both modules sign the IDENTICAL payload
    // (tenantId + expiresAt) — the only variable left that can make the two
    // signatures differ is the HMAC subkey itself, isolating the key
    // separation this test exists to prove from an incidental timestamp
    // difference between the two calls.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const salesforceState = signOAuthState(TENANT_ID);
    const hubspotState = signHubSpotState(TENANT_ID);
    const [salesforcePayload, salesforceSignature] = [salesforceState.split(".").slice(0, 2).join("."), salesforceState.split(".")[2]];
    const [hubspotPayload, hubspotSignature] = [hubspotState.split(".").slice(0, 2).join("."), hubspotState.split(".")[2]];

    expect(salesforcePayload).toBe(hubspotPayload); // sanity: same payload, so any signature diff is the key, not the content
    expect(salesforceSignature).not.toBe(hubspotSignature);
  });
});
