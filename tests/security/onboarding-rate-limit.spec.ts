// T41 (Sprint 8, Ticket 41) — security-review finding: the onboarding
// actions need SERVER-side rate limiting, because disable-on-pending is UI
// state, not a control — a Server Action is a stable POST endpoint a
// scripted caller can replay, and startWithSampleDeal writes ~17
// service-role rows per call with no idempotency (T42 contract).
//
// This spec is deliberately DB-FREE, unlike its sibling
// tests/security/onboarding-actions.spec.ts (which proves auth/RLS/seed
// behaviour against the real dev Supabase): the thing under test here is the
// checkRateLimit branch INSIDE each action, so requireSeller and
// seedSampleDeal are mocked, and the manual path's seller.client is a
// minimal insert-chain stub. The limiter itself (lib/rate-limit.ts) is NOT
// mocked — it's an in-memory fixed window in this same process, so calling
// the real actions repeatedly exercises it for real. Budgets are keyed per
// seller userId, so each test uses its own unique userId to keep windows
// isolated from the other tests in this file.

import { describe, expect, it, vi } from "vitest";

import type { SellerSession } from "@/lib/plans/require-seller";
import { ONBOARDING_RATE_LIMIT } from "@/lib/rate-limit";
import {
  INITIAL_ONBOARDING_STATE,
  RATE_LIMITED_MESSAGE,
} from "@/app/admin/onboarding/onboarding-state";

const { redirectSentinel, currentSession } = vi.hoisted(() => ({
  redirectSentinel: Symbol("redirect-sentinel"),
  currentSession: { value: null as SellerSession | null },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw redirectSentinel;
  }),
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSession.value),
}));

const seedSampleDeal = vi.fn(async (_input: unknown) => ({
  ok: true as const,
  workspaceId: "ws-seeded",
  planId: "plan-seeded",
}));
vi.mock("@/lib/seed/sample-deal", () => ({
  seedSampleDeal: (input: unknown) => seedSampleDeal(input),
}));

const { startWithSampleDeal, createFirstWorkspace } = await import(
  "@/app/admin/onboarding/onboarding-actions"
);

const insertCalls = vi.fn();

/** Minimal insert-chain stub for the manual path — table identity is
 * irrelevant here; only "the insert branch was or wasn't reached" matters. */
function makeSession(userId: string): SellerSession {
  const client = {
    from: () => ({
      insert: (row: unknown) => {
        insertCalls(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: "ws-manual" }, error: null }),
          }),
        };
      },
    }),
  } as unknown as SellerSession["client"];
  return { client, userId, email: null, tenantId: "7e570000-0000-4000-8000-00000000410a" };
}

function manualFormData(): FormData {
  const formData = new FormData();
  formData.set("target_company_name", "Acme Inc");
  formData.set("target_domain", "acme.com");
  return formData;
}

describe("onboarding actions — per-seller rate limiting (T41 security review)", () => {
  it("startWithSampleDeal: allows the budgeted calls, then returns the rate-limit error without seeding", async () => {
    currentSession.value = makeSession("rate-limit-sample-user");
    seedSampleDeal.mockClear();

    for (let call = 0; call < ONBOARDING_RATE_LIMIT.limit; call += 1) {
      // Each in-budget call reaches the (mocked) seed and redirects.
      await expect(startWithSampleDeal(INITIAL_ONBOARDING_STATE, new FormData())).rejects.toBe(
        redirectSentinel,
      );
    }
    expect(seedSampleDeal).toHaveBeenCalledTimes(ONBOARDING_RATE_LIMIT.limit);

    const overBudget = await startWithSampleDeal(INITIAL_ONBOARDING_STATE, new FormData());

    expect(overBudget).toEqual({ error: RATE_LIMITED_MESSAGE });
    // The refusal happens BEFORE the seed — no 17-row write burned.
    expect(seedSampleDeal).toHaveBeenCalledTimes(ONBOARDING_RATE_LIMIT.limit);
  });

  it("createFirstWorkspace: allows the budgeted calls, then returns the rate-limit error without inserting", async () => {
    currentSession.value = makeSession("rate-limit-manual-user");
    insertCalls.mockClear();

    for (let call = 0; call < ONBOARDING_RATE_LIMIT.limit; call += 1) {
      await expect(createFirstWorkspace(INITIAL_ONBOARDING_STATE, manualFormData())).rejects.toBe(
        redirectSentinel,
      );
    }
    expect(insertCalls).toHaveBeenCalledTimes(ONBOARDING_RATE_LIMIT.limit);

    const overBudget = await createFirstWorkspace(INITIAL_ONBOARDING_STATE, manualFormData());

    expect(overBudget).toEqual({ error: RATE_LIMITED_MESSAGE });
    expect(insertCalls).toHaveBeenCalledTimes(ONBOARDING_RATE_LIMIT.limit);
  });

  it("budgets are per seller: one seller at the cap does not throttle another", async () => {
    currentSession.value = makeSession("rate-limit-capped-user");
    for (let call = 0; call < ONBOARDING_RATE_LIMIT.limit; call += 1) {
      await expect(startWithSampleDeal(INITIAL_ONBOARDING_STATE, new FormData())).rejects.toBe(
        redirectSentinel,
      );
    }
    expect(await startWithSampleDeal(INITIAL_ONBOARDING_STATE, new FormData())).toEqual({
      error: RATE_LIMITED_MESSAGE,
    });

    currentSession.value = makeSession("rate-limit-other-user");
    await expect(startWithSampleDeal(INITIAL_ONBOARDING_STATE, new FormData())).rejects.toBe(
      redirectSentinel,
    );
  });
});
