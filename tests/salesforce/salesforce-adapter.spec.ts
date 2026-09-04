// Sprint 11, Ticket 56 — unit coverage for
// lib/crm-import/salesforce-adapter.ts. @/lib/salesforce/get-client is
// module-mocked (vi.hoisted style, mirroring tests/hubspot/hubspot-adapter.spec.ts's
// own mocking of its HubSpot equivalent): a fake SalesforceClient (a plain
// object exposing .fetch as a vi.fn()) is injected via
// getSalesforceClientForTenant, so every HTTP shape under test is asserted
// against a controlled Response, never a real network call.

import { describe, expect, it, vi } from "vitest";

const { getSalesforceClientForTenant } = vi.hoisted(() => ({
  getSalesforceClientForTenant: vi.fn(),
}));

vi.mock("@/lib/salesforce/get-client", () => ({ getSalesforceClientForTenant }));

// Real class — imported (not mocked) so `instanceof` narrowing inside the
// adapter under test works against the actual constructor.
const { SalesforceReauthRequiredError } = await import("@/lib/salesforce/token-exchange");
const { createSalesforceAdapter, SALESFORCE_API_VERSION } = await import("@/lib/crm-import/salesforce-adapter");

const TENANT_ID = "tenant-1";
// Valid-shaped Salesforce Opportunity id (15-18 alphanumeric chars).
const VALID_ID = "006AAAAAAAAAAAAAAA";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function salesforceErrorResponse(status: number, errorCode: string, message = "error"): Response {
  return jsonResponse([{ message, errorCode }], status);
}

function fakeClient(fetchImpl: (path: string, init?: RequestInit) => Promise<Response>) {
  return { fetch: vi.fn(fetchImpl) };
}

function opportunityQueryPath(): string {
  return `/services/data/${SALESFORCE_API_VERSION}/query`;
}

describe("createSalesforceAdapter — listDeals", () => {
  it("lists deals via one SOQL query, StageName passed through as-is (no separate label resolution)", async () => {
    const client = fakeClient(async (path) => {
      expect(path).toContain(opportunityQueryPath());
      expect(path).toContain(encodeURIComponent("FROM Opportunity"));
      return jsonResponse({
        totalSize: 1,
        done: true,
        records: [
          { Id: "006AAAAAAAAAAAAAA1", Name: "Q1 rollout", Amount: 1000, StageName: "Qualification", Account: { Name: "Acme Corp" } },
        ],
      });
    });
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result).toEqual({
      ok: true,
      deals: [{ externalId: "006AAAAAAAAAAAAAA1", name: "Q1 rollout", amount: 1000, stage: "Qualification", companyName: "Acme Corp" }],
    });
  });

  it("companyName is null when the Opportunity has no Account", async () => {
    const client = fakeClient(async () =>
      jsonResponse({
        totalSize: 1,
        done: true,
        records: [{ Id: "006AAAAAAAAAAAAAA2", Name: "Deal", Amount: null, StageName: "Prospecting", Account: null }],
      }),
    );
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deals[0].companyName).toBeNull();
    expect(result.deals[0].amount).toBeNull();
  });

  it("paginates through multiple pages using nextRecordsUrl, passed straight to client.fetch", async () => {
    const client = fakeClient(async (path) => {
      if (path === "/services/data/v62.0/query/01gAAAA-2000") {
        return jsonResponse({
          totalSize: 2,
          done: true,
          records: [{ Id: "006AAAAAAAAAAAAAA4", Name: "Deal 2", Amount: null, StageName: "s", Account: null }],
        });
      }
      if (path.includes(opportunityQueryPath())) {
        return jsonResponse({
          totalSize: 2,
          done: false,
          nextRecordsUrl: "/services/data/v62.0/query/01gAAAA-2000",
          records: [{ Id: "006AAAAAAAAAAAAAA3", Name: "Deal 1", Amount: null, StageName: "s", Account: null }],
        });
      }
      throw new Error(`unexpected path: ${path}`);
    });
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deals.map((d) => d.externalId)).toEqual(["006AAAAAAAAAAAAAA3", "006AAAAAAAAAAAAAA4"]);
  });

  it("refuses to follow a nextRecordsUrl that is not a Salesforce pagination path (SSRF guard, T56 security review)", async () => {
    let callCount = 0;
    const client = fakeClient(async () => {
      callCount += 1;
      return jsonResponse({
        totalSize: 2,
        done: false,
        // URL parsing reads "@host" as userinfo@host — following this would
        // re-aim the Bearer-authed request at evil.example.
        nextRecordsUrl: "@evil.example/exfil",
        records: [{ Id: "006AAAAAAAAAAAAAA5", Name: "Deal", Amount: null, StageName: "s", Account: null }],
      });
    });
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(callCount).toBe(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
    expect(result.message).not.toContain("evil.example");
  });

  it.each([
    "https://evil.example/services/data/v62.0/query/01g-2000", // absolute URL
    "//evil.example/services/data/v62.0/query/01g-2000", // protocol-relative
    "/services/data/v62.0/sobjects/Opportunity", // right host shape, wrong endpoint
    "/services/data/v62.0/query/01g?x=@evil", // query-string smuggling
  ])("rejects malformed nextRecordsUrl %s", async (hostile) => {
    const client = fakeClient(async () =>
      jsonResponse({
        totalSize: 2,
        done: false,
        nextRecordsUrl: hostile,
        records: [{ Id: "006AAAAAAAAAAAAAA6", Name: "Deal", Amount: null, StageName: "s", Account: null }],
      }),
    );
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
  });

  it("stops paginating at the MAX_LIST_PAGES safety cap even if the server keeps claiming done:false", async () => {
    let callCount = 0;
    const client = fakeClient(async () => {
      callCount += 1;
      return jsonResponse({
        totalSize: 1000,
        done: false,
        nextRecordsUrl: "/services/data/v62.0/query/endless",
        records: [{ Id: `006AAAAAAAAAAAA${String(callCount).padStart(3, "0")}`, Name: "Deal", Amount: null, StageName: "s", Account: null }],
      });
    });
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A safety cap exists and is finite — the exact page count is this
    // module's own implementation detail, not asserted here.
    expect(callCount).toBeGreaterThan(0);
    expect(callCount).toBeLessThan(1000);
    expect(result.deals.length).toBe(callCount);
  });

  it("returns token_expired when the tenant has no Salesforce connection", async () => {
    getSalesforceClientForTenant.mockResolvedValue(null);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("token_expired");
  });

  it("maps SalesforceReauthRequiredError thrown by get-client to token_expired (reconnect lifecycle)", async () => {
    getSalesforceClientForTenant.mockRejectedValue(new SalesforceReauthRequiredError());

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("token_expired");
  });

  it("maps a 403 REQUEST_LIMIT_EXCEEDED to rate_limited", async () => {
    const client = fakeClient(async () => salesforceErrorResponse(403, "REQUEST_LIMIT_EXCEEDED", "TotalRequests Limit exceeded."));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("rate_limited");
  });

  it("maps a 403 API_DISABLED_FOR_ORG to 'unknown' with a distinct, honest message naming the edition limitation", async () => {
    const client = fakeClient(async () => salesforceErrorResponse(403, "API_DISABLED_FOR_ORG", "API is not enabled for this Organization"));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
    expect(result.message).toMatch(/edition doesn't include API access/i);
  });

  it("maps a second 401 (get-client already retried once) to token_expired", async () => {
    const client = fakeClient(async () => salesforceErrorResponse(401, "INVALID_SESSION_ID", "Session expired or invalid"));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("token_expired");
  });

  it("maps a 5xx on the query page to unknown", async () => {
    const client = fakeClient(async () => new Response("server error", { status: 503 }));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });

  it("maps an unclassified 4xx on the query page to unknown (list has no invalid_data slot)", async () => {
    const client = fakeClient(async () => salesforceErrorResponse(400, "MALFORMED_QUERY", "bad SOQL"));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });

  it("maps a network failure (fetch throws) to unknown", async () => {
    const client = fakeClient(async () => {
      throw new Error("network down");
    });
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });

  it("maps a malformed (non-JSON) query response to unknown", async () => {
    const client = fakeClient(async () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });
});

describe("createSalesforceAdapter — getDealDetail", () => {
  function detailClient(
    dealResponse: () => Response,
    contactRoleResponse?: () => Response,
  ) {
    return fakeClient(async (path) => {
      if (path.includes("FROM%20OpportunityContactRole") || path.includes("OpportunityContactRole")) {
        return contactRoleResponse ? contactRoleResponse() : jsonResponse({ totalSize: 0, done: true, records: [] });
      }
      if (path.includes(opportunityQueryPath())) return dealResponse();
      throw new Error(`unexpected path: ${path}`);
    });
  }

  it("fetches the Opportunity plus its Account and a contact email via a separate contact-role query", async () => {
    const client = detailClient(
      () =>
        jsonResponse({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: VALID_ID,
              Name: "Q1 rollout",
              Amount: 1000,
              StageName: "Qualification",
              CloseDate: "2026-09-01",
              AccountId: "001AAAAAAAAAAAAAAA",
              Account: { Name: "Acme Corp", Website: "acme.example.com" },
            },
          ],
        }),
      () => jsonResponse({ totalSize: 1, done: true, records: [{ Contact: { Email: "buyer@acme.example.com" } }] }),
    );
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result).toEqual({
      ok: true,
      detail: {
        externalId: VALID_ID,
        dealName: "Q1 rollout",
        amount: "1000",
        stage: "Qualification",
        closeDate: "2026-09-01",
        companyName: "Acme Corp",
        companyDomain: "acme.example.com",
        contactEmail: "buyer@acme.example.com",
      },
    });
  });

  it("Ghost Contact gotcha: a junction row resolving to no usable contact -> contactEmail null, never derived from anywhere else", async () => {
    const client = detailClient(
      () =>
        jsonResponse({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: VALID_ID,
              Name: "Deal",
              Amount: null,
              StageName: "s",
              CloseDate: null,
              AccountId: "001AAAAAAAAAAAAAAA",
              Account: { Name: "Acme Corp", Website: "acme.example.com" },
            },
          ],
        }),
      // A real Ghost Contact shape: the junction row exists but resolves to
      // a Contact with no email (or no Contact at all).
      () => jsonResponse({ totalSize: 1, done: true, records: [{ Contact: { Email: null } }] }),
    );
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.contactEmail).toBeNull();
    // NEVER derive companyDomain from a contact email — Account.Website only.
    expect(result.detail.companyDomain).toBe("acme.example.com");
  });

  it("companyName/companyDomain are null when the Opportunity has no Account", async () => {
    const client = detailClient(() =>
      jsonResponse({
        totalSize: 1,
        done: true,
        records: [{ Id: VALID_ID, Name: "Deal", Amount: null, StageName: "s", CloseDate: null, AccountId: null, Account: null }],
      }),
    );
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.companyName).toBeNull();
    expect(result.detail.companyDomain).toBeNull();
    expect(result.detail.contactEmail).toBeNull();
  });

  it("a failed contact-role sub-fetch degrades to contactEmail: null rather than failing the whole deal detail", async () => {
    const client = detailClient(
      () =>
        jsonResponse({
          totalSize: 1,
          done: true,
          records: [{ Id: VALID_ID, Name: "Deal", Amount: null, StageName: "s", CloseDate: null, AccountId: "001x", Account: { Name: "Acme", Website: "acme.example.com" } }],
        }),
      () => new Response("server error", { status: 500 }),
    );
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.contactEmail).toBeNull();
    expect(result.detail.companyDomain).toBe("acme.example.com");
  });

  it("no matching Opportunity record (zero rows, not an HTTP error) -> invalid_data", async () => {
    const client = detailClient(() => jsonResponse({ totalSize: 0, done: true, records: [] }));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_data");
  });

  it("returns token_expired when the tenant has no Salesforce connection", async () => {
    getSalesforceClientForTenant.mockResolvedValue(null);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("token_expired");
  });

  it("maps SalesforceReauthRequiredError thrown by get-client to token_expired", async () => {
    getSalesforceClientForTenant.mockRejectedValue(new SalesforceReauthRequiredError());

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("token_expired");
  });

  it("maps a 403 REQUEST_LIMIT_EXCEEDED on the deal fetch to rate_limited", async () => {
    const client = detailClient(() => salesforceErrorResponse(403, "REQUEST_LIMIT_EXCEEDED"));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("rate_limited");
  });

  it("maps a 403 API_DISABLED_FOR_ORG on the deal fetch to 'unknown' with the distinct edition message", async () => {
    const client = detailClient(() => salesforceErrorResponse(403, "API_DISABLED_FOR_ORG"));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
    expect(result.message).toMatch(/edition doesn't include API access/i);
  });

  it("maps a second 401 on the deal fetch to token_expired", async () => {
    const client = detailClient(() => salesforceErrorResponse(401, "INVALID_SESSION_ID"));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("token_expired");
  });

  it("maps an unclassified 4xx on the deal fetch to invalid_data (a structural problem with this one object)", async () => {
    const client = detailClient(() => salesforceErrorResponse(400, "MALFORMED_QUERY"));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_data");
  });

  it("maps a 5xx on the deal fetch to unknown", async () => {
    const client = detailClient(() => new Response("server error", { status: 502 }));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });

  it("maps a network failure (fetch throws) on the deal fetch to unknown", async () => {
    const client = fakeClient(async () => {
      throw new Error("network down");
    });
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });

  it("maps a malformed (non-JSON) deal fetch response to invalid_data", async () => {
    const client = detailClient(() => new Response("not json", { status: 200 }));
    getSalesforceClientForTenant.mockResolvedValue(client);

    const adapter = createSalesforceAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, VALID_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_data");
  });

  // SECURITY (must have explicit tests, per this ticket's brief): the detail
  // WHERE Id = '...' clause is string-interpolated (Salesforce's query
  // endpoint has no bind params) — externalId must be validated against
  // ^[a-zA-Z0-9]{15,18}$ BEFORE it ever reaches a SOQL string, and rejected
  // as invalid_data otherwise. No client call is even attempted.
  describe("externalId validation (SOQL string-interpolation guard)", () => {
    it("rejects an externalId containing a quote before any SOQL is built", async () => {
      getSalesforceClientForTenant.mockClear();
      const adapter = createSalesforceAdapter();

      const result = await adapter.getDealDetail(TENANT_ID, "006' OR '1'='1");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid_data");
      expect(getSalesforceClientForTenant).not.toHaveBeenCalled();
    });

    it("rejects an externalId shorter than 15 characters", async () => {
      getSalesforceClientForTenant.mockClear();
      const adapter = createSalesforceAdapter();

      const result = await adapter.getDealDetail(TENANT_ID, "006AAAA");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid_data");
      expect(getSalesforceClientForTenant).not.toHaveBeenCalled();
    });

    it("rejects an externalId longer than 18 characters", async () => {
      getSalesforceClientForTenant.mockClear();
      const adapter = createSalesforceAdapter();

      const result = await adapter.getDealDetail(TENANT_ID, "006AAAAAAAAAAAAAAAAAAAAA");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid_data");
      expect(getSalesforceClientForTenant).not.toHaveBeenCalled();
    });

    it("accepts a 15-char and an 18-char alphanumeric id (boundary check)", async () => {
      const client = detailClient(() =>
        jsonResponse({
          totalSize: 1,
          done: true,
          records: [{ Id: "006AAAAAAAAAAAA", Name: "Deal", Amount: null, StageName: "s", CloseDate: null, AccountId: null, Account: null }],
        }),
      );
      getSalesforceClientForTenant.mockResolvedValue(client);
      const adapter = createSalesforceAdapter();

      const fifteenCharResult = await adapter.getDealDetail(TENANT_ID, "006AAAAAAAAAAAA");
      expect(fifteenCharResult.ok).toBe(true);

      const eighteenCharClient = detailClient(() =>
        jsonResponse({
          totalSize: 1,
          done: true,
          records: [{ Id: VALID_ID, Name: "Deal", Amount: null, StageName: "s", CloseDate: null, AccountId: null, Account: null }],
        }),
      );
      getSalesforceClientForTenant.mockResolvedValue(eighteenCharClient);
      const eighteenCharResult = await adapter.getDealDetail(TENANT_ID, VALID_ID);
      expect(eighteenCharResult.ok).toBe(true);
    });
  });
});

describe("createSalesforceAdapter — provider identity", () => {
  it("identifies itself as salesforce", () => {
    const adapter = createSalesforceAdapter();
    expect(adapter.provider).toBe("salesforce");
  });
});
