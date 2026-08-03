// T39-3 (CRITICAL merge blocker) — pins the EXACT cookie options object set at
// BOTH buyer-gate call sites: app/portal/[id]/gate-actions.ts (`verifyAccess`,
// the real magic-link gate) and app/view/[id]/gate-actions.ts (`enterView`,
// the demo/any-"@" gate). Both deliberately set `path: "/"`, not
// `/portal/[id]` or `/view/[id]` — the SAME signed session cookie must also
// reach /api/track and (Sprint 6) /api/steps/[id]/complete, which live
// outside both prefixes. Ticket 38 fixed a pre-auth metadata leak; this test
// makes a future `path` regression at either call site a static test failure
// instead of a silent production break.
//
// next/headers.cookies() and next/navigation.redirect() both throw outside a
// real Next.js request scope, so both are mocked: cookies() returns a fake
// store that records every set() call's options object verbatim; redirect()
// throws a sentinel to halt control flow exactly where the real one would,
// caught below. @/lib/supabase/admin is mocked with a minimal chainable query
// builder — table configuration is set per test so each gate's real reads
// resolve the way they would against a genuine row. The portal token hash is
// computed with the REAL hashToken() from @/lib/portal-access-token, and the
// view gate's tenant check is proven against the REAL DEMO_TENANT_ID, so
// neither mock quietly rigs the comparison it's supposed to be exercising.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_TENANT_ID } from "@/lib/demo";
import { hashToken } from "@/lib/portal-access-token";
import { portalCookieName } from "@/lib/portal-session";

interface RecordedCookieSet {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
}

interface TableResult {
  readonly data: unknown;
  readonly error: unknown;
}

const { cookieSetCalls, redirectSentinel, tableConfig } = vi.hoisted(() => ({
  cookieSetCalls: [] as RecordedCookieSet[],
  redirectSentinel: Symbol("redirect-sentinel"),
  tableConfig: new Map<string, TableResult>(),
}));

/**
 * A minimal stand-in for the Supabase query builder. Every filter/select
 * method returns the SAME builder so chains of arbitrary length work, and the
 * builder is itself thenable so it resolves to the configured `{ data, error
 * }` whether the real code awaits it after a terminal `.maybeSingle()` /
 * `.single()` or awaits the filter chain directly (as the view gate's
 * `.limit(1)` and `.insert(...)` calls do). Table identity, not call
 * sequence, decides the result — sufficient for pinning cookie options,
 * which never depends on which branch of either gate's retry/attempts logic
 * ran.
 */
function makeQueryBuilder(result: TableResult): Record<string, unknown> {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    update: () => builder,
    insert: () => builder,
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: (value: TableResult) => void) => resolve(result),
  };
  return builder;
}

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieSetCalls.push({ name, value, options });
    },
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw redirectSentinel;
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeQueryBuilder(tableConfig.get(table) ?? { data: null, error: null }),
  }),
}));

const PINNED_SECURITY_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

describe("portal session cookie — options pinning at both gate call sites (T39-3)", () => {
  beforeEach(() => {
    cookieSetCalls.length = 0;
    tableConfig.clear();
  });

  it("verifyAccess (/portal/[id]) sets the pinned httpOnly/secure/sameSite/path cookie options", async () => {
    const workspaceId = "7e570000-0000-4000-8000-0000000000c1";
    const email = "buyer@portal-pin-test.invalid";
    const token = "4821";

    // Real hashToken() computes the stored hash — a faked-to-match hash would
    // let this test pass even if verifyAccess's own comparison were broken.
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

    expect(cookieSetCalls).toHaveLength(1);
    const [call] = cookieSetCalls;
    expect(call.name).toBe(portalCookieName(workspaceId));
    expect(call.options).toEqual({
      ...PINNED_SECURITY_OPTIONS,
      expires: expect.any(Date),
    });
  });

  it("enterView (/view/[id]) sets the SAME pinned httpOnly/secure/sameSite/path cookie options", async () => {
    const workspaceId = "7e570000-0000-4000-8000-0000000000c2";
    const email = "buyer@view-pin-test.invalid";

    // Real DEMO_TENANT_ID — a faked tenant id would let this test pass even
    // if enterView's own demo-tenant scope check were broken.
    tableConfig.set("workspaces", {
      data: { id: workspaceId, tenant_id: DEMO_TENANT_ID },
      error: null,
    });
    // Non-empty so the one-time demo-link seeding branch is skipped; that
    // seeding is unrelated to cookie options and would otherwise need its
    // own insert-shape mock for no benefit to this test.
    tableConfig.set("links", { data: [{ id: "existing-link" }], error: null });
    tableConfig.set("workspace_analytics", { data: null, error: null });

    const { enterView } = await import("@/app/view/[id]/gate-actions");
    const formData = new FormData();
    formData.set("email", email);

    await expect(enterView(workspaceId, formData)).rejects.toBe(redirectSentinel);

    expect(cookieSetCalls).toHaveLength(1);
    const [call] = cookieSetCalls;
    expect(call.name).toBe(portalCookieName(workspaceId));
    expect(call.options).toEqual({
      ...PINNED_SECURITY_OPTIONS,
      expires: expect.any(Date),
    });
  });

  it("both gate call sites agree on identical security options — the pinning guarantee itself", async () => {
    const portalWorkspaceId = "7e570000-0000-4000-8000-0000000000c3";
    const portalEmail = "buyer@portal-pin-test-2.invalid";
    const portalToken = "9137";
    tableConfig.set("portal_access_tokens", {
      data: {
        id: "candidate-token-id-2",
        token_hash: hashToken(portalToken, portalWorkspaceId, portalEmail),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        attempts: 0,
      },
      error: null,
    });
    const { verifyAccess } = await import("@/app/portal/[id]/gate-actions");
    const portalFormData = new FormData();
    portalFormData.set("email", portalEmail);
    portalFormData.set("token", portalToken);
    await expect(verifyAccess(portalWorkspaceId, portalFormData)).rejects.toBe(redirectSentinel);
    const portalOptions = cookieSetCalls[0].options;

    cookieSetCalls.length = 0;
    tableConfig.clear();

    const viewWorkspaceId = "7e570000-0000-4000-8000-0000000000c4";
    const viewEmail = "buyer@view-pin-test-2.invalid";
    tableConfig.set("workspaces", { data: { id: viewWorkspaceId, tenant_id: DEMO_TENANT_ID }, error: null });
    tableConfig.set("links", { data: [{ id: "existing-link" }], error: null });
    tableConfig.set("workspace_analytics", { data: null, error: null });
    const { enterView } = await import("@/app/view/[id]/gate-actions");
    const viewFormData = new FormData();
    viewFormData.set("email", viewEmail);
    await expect(enterView(viewWorkspaceId, viewFormData)).rejects.toBe(redirectSentinel);
    const viewOptions = cookieSetCalls[0].options;

    // Compare the four named security-relevant options directly — `expires`
    // deliberately excluded, since each call computes its own independent
    // timestamp and is not itself part of the pinning guarantee.
    expect(portalOptions).toMatchObject(PINNED_SECURITY_OPTIONS);
    expect(viewOptions).toMatchObject(PINNED_SECURITY_OPTIONS);
    expect({ ...portalOptions, expires: undefined }).toEqual({ ...viewOptions, expires: undefined });
  });
});
