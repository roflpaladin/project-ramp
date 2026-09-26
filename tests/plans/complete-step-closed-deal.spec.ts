// Sprint 12, Ticket 60 review fix (B3). A closed deal (won/lost) is
// read-only for the SELLER — so it must be read-only for the BUYER too.
// Without this, the buyer portal could still tick steps on a deal that was
// marked Won last week, which would rewrite history on a plan nobody is
// working any more.
//
// No extra round trip: resolveStepWorkspace already walks
// step -> stage -> plan -> workspace, so the plan's status comes back in the
// select it was already making.
//
// DB-free: resolveStepWorkspace takes an injected client (its existing test
// seam), and the route is exercised with next/headers, the portal session
// and the completion module mocked. tests/security/step-completion.spec.ts
// (a live-server suite) still owns the end-to-end matrix.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieJar, mockResolveStepWorkspace, mockCompleteStepAsBuyer, mockVerifySession } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  mockResolveStepWorkspace: vi.fn(),
  mockCompleteStepAsBuyer: vi.fn(),
  mockVerifySession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: () => Promise.resolve({ error: null }) }) }),
}));

vi.mock("@/lib/portal-session", () => ({
  portalCookieName: (workspaceId: string) => `portal_session_${workspaceId}`,
  verifyPortalSessionValue: mockVerifySession,
}));

vi.mock("@/lib/plans/complete-step", async () => {
  const actual = await vi.importActual<typeof import("@/lib/plans/complete-step")>("@/lib/plans/complete-step");
  return {
    ...actual,
    resolveStepWorkspace: mockResolveStepWorkspace,
    completeStepAsBuyer: mockCompleteStepAsBuyer,
  };
});

const { POST } = await import("@/app/api/steps/[id]/complete/route");

// The UNMOCKED implementation: the route half of this file replaces
// resolveStepWorkspace with a stub, and the second describe block below
// exercises the real one.
const { resolveStepWorkspace } = await vi.importActual<typeof import("@/lib/plans/complete-step")>(
  "@/lib/plans/complete-step",
);

const STEP_ID = "44444444-4444-4444-4444-444444444444";
const WORKSPACE_ID = "55555555-5555-5555-5555-555555555555";

function stepOn(planStatus: string) {
  return { id: STEP_ID, ownerSide: "buyer", status: "open", workspaceId: WORKSPACE_ID, planStatus };
}

function postComplete(): Promise<Response> {
  return POST(new Request("http://localhost/api/steps/x/complete", { method: "POST", headers: { cookie: "a=b" } }), {
    params: Promise.resolve({ id: STEP_ID }),
  });
}

beforeEach(() => {
  cookieJar.clear();
  cookieJar.set(`portal_session_${WORKSPACE_ID}`, "valid-cookie");
  mockVerifySession.mockReturnValue({ email: "dana@acme.com" });
  mockResolveStepWorkspace.mockResolvedValue(stepOn("active"));
  mockCompleteStepAsBuyer.mockResolvedValue({
    kind: "completed",
    step: { id: STEP_ID, label: "Step", status: "done", private_note: "seller only" },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  mockResolveStepWorkspace.mockReset();
  mockCompleteStepAsBuyer.mockReset();
  mockVerifySession.mockReset();
});

describe("POST /api/steps/[id]/complete — the deal is closed", () => {
  it.each(["won", "lost"])("refuses with 409 when the plan is %s", async (planStatus) => {
    mockResolveStepWorkspace.mockResolvedValue(stepOn(planStatus));

    const response = await postComplete();

    expect(response.status).toBe(409);
    expect(mockCompleteStepAsBuyer).not.toHaveBeenCalled();
  });

  it("answers in the route's existing error shape, leaking no plan detail", async () => {
    mockResolveStepWorkspace.mockResolvedValue(stepOn("won"));

    const body = (await (await postComplete()).json()) as { error?: string; data?: unknown };

    expect(typeof body.error).toBe("string");
    expect(body.data).toBeUndefined();
    expect(body.error).not.toMatch(/won|lost/i);
  });

  it.each(["draft", "active"])("still completes the step while the plan is %s", async (planStatus) => {
    mockResolveStepWorkspace.mockResolvedValue(stepOn(planStatus));

    const response = await postComplete();

    expect(response.status).toBe(200);
    expect(mockCompleteStepAsBuyer).toHaveBeenCalled();
  });
});

describe("resolveStepWorkspace — the plan's status rides along", () => {
  interface QueryResult {
    readonly data: unknown;
    readonly error: unknown;
  }

  let queryResult: QueryResult = { data: null, error: null };
  const selects: string[] = [];

  function fakeClient(): SupabaseClient {
    const build = (): Record<string, unknown> => {
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => {
        selects.push(columns);
        return builder;
      };
      builder.eq = () => builder;
      builder.maybeSingle = () => Promise.resolve(queryResult);
      return builder;
    };
    return { from: () => build() } as unknown as SupabaseClient;
  }

  beforeEach(() => {
    selects.length = 0;
    queryResult = {
      data: {
        id: STEP_ID,
        owner_side: "buyer",
        status: "open",
        plan_stages: { success_plans: { workspace_id: WORKSPACE_ID, status: "won" } },
      },
      error: null,
    };
  });

  it("returns the owning plan's status", async () => {
    const step = await resolveStepWorkspace(STEP_ID, fakeClient());

    expect(step?.planStatus).toBe("won");
    expect(step?.workspaceId).toBe(WORKSPACE_ID);
  });

  it("asks for it in the select it was already making — no second round trip", async () => {
    await resolveStepWorkspace(STEP_ID, fakeClient());

    expect(selects).toHaveLength(1);
    expect(selects[0]).toMatch(/success_plans\s*\(\s*workspace_id\s*,\s*status\s*\)/);
  });

  it("still returns null for a step whose plan cannot be resolved", async () => {
    queryResult = { data: { id: STEP_ID, owner_side: "buyer", status: "open", plan_stages: null }, error: null };

    await expect(resolveStepWorkspace(STEP_ID, fakeClient())).resolves.toBeNull();
  });
});
