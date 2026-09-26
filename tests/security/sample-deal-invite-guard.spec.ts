// Sprint 12, Ticket 60 review fix (B2 — founder ruling, 2026-09-21). The
// sample deal is for PRACTICE: a seller may invite their own login address
// to it (that is the whole "see what your buyer sees" moment), and nobody
// else. Otherwise a tenant could run a real customer through the one
// workspace the active-deal limit does not count.
//
// Two halves, both covered here:
//   1. app/admin/workspaces/[id]/invite-actions.ts refuses a foreign email
//      on a sample workspace, before any whitelist write or any email send.
//   2. lib/portal-access.ts's domain auto-approval is OFF for a sample
//      workspace — otherwise editing target_domain (which a seller can do
//      through PostgREST) would re-open the same door on the portal side,
//      where no seller identity exists to compare against.
//
// DB-free: next/headers, next/navigation, requireSeller and the token
// issuer are mocked (the same set tests/security/invite-actions.spec.ts
// mocks), and the seller client is a fake that answers one workspace read.
// That live suite still owns the real-RLS coverage; this one owns the
// sample rule, which is ours and needs no database to be true.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isEmailApproved } from "@/lib/portal-access";
import type { SellerSession } from "@/lib/plans/require-seller";
import { INITIAL_SEND_INVITE_STATE } from "@/app/admin/workspaces/[id]/invite-state";

const { currentSellerSession, mockIssueInvite, redirectCalls, redirectSentinel } = vi.hoisted(() => ({
  currentSellerSession: { value: null as SellerSession | null },
  mockIssueInvite: vi.fn(),
  redirectCalls: [] as string[],
  redirectSentinel: Symbol("redirect-sentinel"),
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSellerSession.value),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    redirectCalls.push(path);
    throw redirectSentinel;
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: () => {} })),
  headers: vi.fn(async () => ({ get: () => null })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/portal-access-token", () => ({ issueAccessTokenForInvite: mockIssueInvite }));

const { sendBuyerInvite } = await import("@/app/admin/workspaces/[id]/invite-actions");

const WORKSPACE_ID = "55555555-5555-5555-5555-555555555555";
const SELLER_EMAIL = "seller@example.com";
const BUYER_EMAIL = "dana@realbuyer.com";

interface WorkspaceRow {
  readonly id: string;
  readonly approved_emails: string[];
  readonly target_domain: string;
  readonly is_sample: boolean;
}

let workspaceRow: WorkspaceRow | null = null;
const workspaceUpdates: unknown[] = [];

function fakeSellerClient(): SupabaseClient {
  const build = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.update = (patch: unknown) => {
      workspaceUpdates.push(patch);
      return builder;
    };
    builder.single = () => Promise.resolve({ data: workspaceRow, error: null });
    builder.then = (resolve: (value: { error: null }) => void) => resolve({ error: null });
    return builder;
  };

  return { from: () => build() } as unknown as SupabaseClient;
}

function invite(email: string) {
  return sendBuyerInvite(WORKSPACE_ID, INITIAL_SEND_INVITE_STATE, formDataFor(email));
}

function formDataFor(email: string): FormData {
  const data = new FormData();
  data.append("email", email);
  return data;
}

beforeEach(() => {
  workspaceUpdates.length = 0;
  redirectCalls.length = 0;
  workspaceRow = {
    id: WORKSPACE_ID,
    approved_emails: [],
    target_domain: "realbuyer.com",
    is_sample: false,
  };
  currentSellerSession.value = {
    client: fakeSellerClient(),
    userId: "user-1",
    email: SELLER_EMAIL,
    tenantId: "11111111-1111-1111-1111-111111111111",
  };
  mockIssueInvite.mockResolvedValue({ status: "sent", email: BUYER_EMAIL });
});

afterEach(() => {
  vi.restoreAllMocks();
  mockIssueInvite.mockReset();
});

describe("sendBuyerInvite — on the SAMPLE deal", () => {
  beforeEach(() => {
    workspaceRow = { ...workspaceRow!, is_sample: true };
  });

  it("refuses an email that is not the seller's own, in plain words", async () => {
    const state = await invite(BUYER_EMAIL);

    expect(state.status).toBe("error");
    expect(state.message).toMatch(/sample deal/i);
    expect(state.message).toMatch(/your own email/i);
  });

  it("sends nothing and whitelists nobody when it refuses", async () => {
    await invite(BUYER_EMAIL);

    expect(mockIssueInvite).not.toHaveBeenCalled();
    expect(workspaceUpdates).toEqual([]);
  });

  it("refuses an address on the workspace's own target domain too — domain approval does not apply here", async () => {
    workspaceRow = { ...workspaceRow!, target_domain: "realbuyer.com" };

    const state = await invite("someone@realbuyer.com");

    expect(state.status).toBe("error");
    expect(mockIssueInvite).not.toHaveBeenCalled();
  });

  it("allows the seller's own address, whatever its case or spacing", async () => {
    mockIssueInvite.mockResolvedValue({ status: "sent", email: SELLER_EMAIL });

    const state = await invite("  Seller@Example.COM  ");

    expect(state.status).toBe("sent");
    expect(mockIssueInvite).toHaveBeenCalledWith(WORKSPACE_ID, SELLER_EMAIL, expect.anything());
  });

  it("whitelists the seller's own address explicitly, since domain matching is off here", async () => {
    mockIssueInvite.mockResolvedValue({ status: "sent", email: SELLER_EMAIL });

    await invite(SELLER_EMAIL);

    expect(workspaceUpdates).toEqual([{ approved_emails: [SELLER_EMAIL] }]);
  });

  it("refuses when the session carries no email to compare against", async () => {
    currentSellerSession.value = { ...currentSellerSession.value!, email: null };

    const state = await invite(SELLER_EMAIL);

    expect(state.status).toBe("error");
    expect(mockIssueInvite).not.toHaveBeenCalled();
  });
});

describe("sendBuyerInvite — on a REAL deal (unchanged)", () => {
  it("still invites the buyer", async () => {
    const state = await invite(BUYER_EMAIL);

    expect(state.status).toBe("sent");
    expect(mockIssueInvite).toHaveBeenCalledWith(WORKSPACE_ID, BUYER_EMAIL, expect.anything());
  });

  it("still skips the whitelist write for an address on the target domain", async () => {
    await invite("dana@realbuyer.com");

    expect(workspaceUpdates).toEqual([]);
  });

  it("still appends an off-domain address to the whitelist", async () => {
    mockIssueInvite.mockResolvedValue({ status: "sent", email: "procurement@elsewhere.com" });

    await invite("procurement@elsewhere.com");

    expect(workspaceUpdates).toEqual([{ approved_emails: ["procurement@elsewhere.com"] }]);
  });
});

describe("isEmailApproved — domain matching can be switched off", () => {
  it("approves a domain match by default (every existing caller)", () => {
    expect(isEmailApproved("dana@acme.com", [], "acme.com")).toBe(true);
  });

  it("refuses the same domain match when domain approval is disabled", () => {
    expect(isEmailApproved("dana@acme.com", [], "acme.com", { allowDomainMatch: false })).toBe(false);
  });

  it("still approves an explicitly whitelisted address when domain approval is disabled", () => {
    expect(isEmailApproved("dana@acme.com", ["Dana@Acme.com"], "acme.com", { allowDomainMatch: false })).toBe(true);
  });
});
