// Sprint 12, Ticket 60 review fix (B2, portal side). The access-code issuer
// is the OTHER approval gate: it runs on the service-role client for an
// anonymous buyer, so there is no seller identity to compare an address
// against. On a SAMPLE workspace it therefore falls back to the explicit
// whitelist only — domain auto-approval is off.
//
// Why that matters: target_domain is seller-writable through PostgREST
// (0001's "AE manages own tenant workspaces" is `for all`). Without this,
// pointing the sample's target_domain at a real customer's domain would let
// that customer request a code and use the one workspace the active-deal
// limit does not count.
//
// DB-free: the service-role client and the email sender are mocked, the
// same way tests/api/send-token.spec.ts mocks the sender.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueryResult {
  readonly data: unknown;
  readonly error: unknown;
}

const { tables, sendCalls, insertedTables } = vi.hoisted(() => ({
  tables: {
    workspace: null as unknown,
    recentToken: null as unknown,
  },
  sendCalls: [] as { to: string }[],
  insertedTables: [] as string[],
}));

function builderFor(table: string): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const passthrough = (..._args: unknown[]) => builder;

  for (const operation of ["select", "eq", "is", "gte", "order", "limit"]) {
    builder[operation] = passthrough;
  }
  builder.insert = () => {
    insertedTables.push(table);
    return Promise.resolve({ data: null, error: null } as QueryResult);
  };
  builder.single = () => Promise.resolve({ data: tables.workspace, error: null });
  builder.maybeSingle = () =>
    Promise.resolve({ data: table === "workspaces" ? tables.workspace : tables.recentToken, error: null });
  builder.then = (resolve: (value: QueryResult) => void) => resolve({ data: null, error: null });

  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builderFor(table) }),
}));

vi.mock("@/lib/email/send-access-code", () => ({
  sendAccessCodeEmail: vi.fn(async ({ to }: { to: string }) => {
    sendCalls.push({ to });
    return { ok: true };
  }),
}));

const { issueAccessTokenForInvite } = await import("@/lib/portal-access-token");

const WORKSPACE_ID = "55555555-5555-5555-5555-555555555555";

beforeEach(() => {
  sendCalls.length = 0;
  insertedTables.length = 0;
  tables.recentToken = null;
  tables.workspace = { target_domain: "acme.com", approved_emails: [], is_sample: false };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("issueAccessTokenForInvite — a real workspace", () => {
  it("still approves an address on the target domain with no explicit whitelist entry", async () => {
    const result = await issueAccessTokenForInvite(WORKSPACE_ID, "dana@acme.com");

    expect(result.status).toBe("sent");
    expect(sendCalls).toEqual([{ to: "dana@acme.com" }]);
  });
});

describe("issueAccessTokenForInvite — the SAMPLE workspace", () => {
  beforeEach(() => {
    tables.workspace = { target_domain: "acme.com", approved_emails: [], is_sample: true };
  });

  it("refuses a domain-matched address that is not explicitly whitelisted", async () => {
    const result = await issueAccessTokenForInvite(WORKSPACE_ID, "dana@acme.com");

    expect(result.status).toBe("not-approved");
    expect(sendCalls).toEqual([]);
    expect(insertedTables).toEqual([]);
  });

  it("still issues a code for an explicitly whitelisted address (the seller's own inbox)", async () => {
    tables.workspace = {
      target_domain: "acme.com",
      approved_emails: ["seller@example.com"],
      is_sample: true,
    };

    const result = await issueAccessTokenForInvite(WORKSPACE_ID, "seller@example.com");

    expect(result.status).toBe("sent");
    expect(sendCalls).toEqual([{ to: "seller@example.com" }]);
  });
});
