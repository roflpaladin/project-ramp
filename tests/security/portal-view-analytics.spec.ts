// T34-4 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §3, §7). Proves
// portal_view logging is now normalised to the GATE ACTION on both buyer
// surfaces, not merely documented in a comment:
//
//   - app/portal/[id]/gate-actions.ts's verifyAccess writes portal_view
//     exactly once, on a successful code verification. It used to be written
//     during app/portal/[id]/page.tsx's render instead, which an RSC render
//     re-running could duplicate.
//   - app/view/[id]/gate-actions.ts's enterView keeps writing portal_view at
//     the same point it always did — asserted here too, so this file is the
//     one place proving both surfaces now agree, not just that /portal moved.
//
// Mirrors tests/security/portal-session-cookie.spec.ts's mocking idiom
// exactly (same hoisted mocks, same chainable query-builder shape) rather
// than inventing a second harness: next/headers.cookies() and
// next/navigation.redirect() both throw outside a live Next.js request
// context, so both are mocked, and @/lib/supabase/admin is mocked with a
// minimal chainable builder. The builder here additionally RECORDS every
// insert() call per table, which portal-session-cookie.spec.ts's version
// does not need.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_TENANT_ID } from "@/lib/demo";
import { hashToken } from "@/lib/portal-access-token";

interface RecordedInsert {
  readonly table: string;
  readonly payload: Record<string, unknown>;
}

interface TableResult {
  readonly data: unknown;
  readonly error: unknown;
}

const { insertCalls, redirectSentinel, tableConfig } = vi.hoisted(() => ({
  insertCalls: [] as RecordedInsert[],
  redirectSentinel: Symbol("redirect-sentinel"),
  tableConfig: new Map<string, TableResult>(),
}));

/**
 * Same shape as portal-session-cookie.spec.ts's makeQueryBuilder, extended to
 * record what insert() was actually called with — that payload is what this
 * file's assertions are about.
 */
function makeQueryBuilder(table: string, result: TableResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    update: () => builder,
    insert: (payload: Record<string, unknown>) => {
      insertCalls.push({ table, payload });
      return builder;
    },
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: (value: TableResult) => void) => resolve(result),
  };
  return builder;
}

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: () => {},
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw redirectSentinel;
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeQueryBuilder(table, tableConfig.get(table) ?? { data: null, error: null }),
  }),
}));

function portalViewInsertsFor(workspaceId: string): RecordedInsert[] {
  return insertCalls.filter(
    (call) => call.table === "workspace_analytics" && call.payload.action_type === "portal_view",
  ).filter((call) => call.payload.workspace_id === workspaceId);
}

describe("portal_view analytics — normalised to the gate action on both surfaces (T34-4)", () => {
  beforeEach(() => {
    insertCalls.length = 0;
    tableConfig.clear();
  });

  it("verifyAccess (/portal/[id]) writes exactly one portal_view row, on successful verification", async () => {
    const workspaceId = "7e570000-0000-4000-8000-0000000000d1";
    const email = "buyer@portal-analytics-test.invalid";
    const token = "3140";

    tableConfig.set("portal_access_tokens", {
      data: {
        id: "candidate-token-id",
        token_hash: hashToken(token, workspaceId, email),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        attempts: 0,
      },
      error: null,
    });

    const { verifyAccess } = await import("@/app/portal/[id]/gate-actions");
    const formData = new FormData();
    formData.set("email", email);
    formData.set("token", token);

    await expect(verifyAccess(workspaceId, formData)).rejects.toBe(redirectSentinel);

    const portalViewInserts = portalViewInsertsFor(workspaceId);
    expect(portalViewInserts).toHaveLength(1);
    expect(portalViewInserts[0].payload).toMatchObject({
      workspace_id: workspaceId,
      buyer_email: email,
      action_type: "portal_view",
    });
  });

  it("verifyAccess (/portal/[id]) writes NO portal_view row when the code is wrong — the write is gated on success", async () => {
    const workspaceId = "7e570000-0000-4000-8000-0000000000d2";
    const email = "buyer@portal-analytics-test-2.invalid";

    tableConfig.set("portal_access_tokens", {
      data: {
        id: "candidate-token-id-2",
        token_hash: hashToken("0000", workspaceId, email),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        attempts: 0,
      },
      error: null,
    });

    const { verifyAccess } = await import("@/app/portal/[id]/gate-actions");
    const formData = new FormData();
    formData.set("email", email);
    formData.set("token", "9999"); // wrong code

    await expect(verifyAccess(workspaceId, formData)).rejects.toBe(redirectSentinel);

    expect(portalViewInsertsFor(workspaceId)).toHaveLength(0);
  });

  it("enterView (/view/[id]) still writes exactly one portal_view row at gate entry — unchanged by this ticket", async () => {
    const workspaceId = "7e570000-0000-4000-8000-0000000000d3";
    const email = "buyer@view-analytics-test.invalid";

    tableConfig.set("workspaces", { data: { id: workspaceId, tenant_id: DEMO_TENANT_ID }, error: null });
    // Non-empty so the one-time demo-link seeding branch is skipped — unrelated
    // to this file's assertions, mirroring portal-session-cookie.spec.ts.
    tableConfig.set("links", { data: [{ id: "existing-link" }], error: null });

    const { enterView } = await import("@/app/view/[id]/gate-actions");
    const formData = new FormData();
    formData.set("email", email);

    await expect(enterView(workspaceId, formData)).rejects.toBe(redirectSentinel);

    const portalViewInserts = portalViewInsertsFor(workspaceId);
    expect(portalViewInserts).toHaveLength(1);
    expect(portalViewInserts[0].payload).toMatchObject({
      workspace_id: workspaceId,
      buyer_email: email,
      action_type: "portal_view",
    });
  });
});
