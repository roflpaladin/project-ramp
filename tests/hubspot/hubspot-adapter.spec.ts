// Sprint 10, Ticket 53 — unit coverage for lib/crm-import/hubspot-adapter.ts.
// @/lib/hubspot/get-client is module-mocked (vi.hoisted style, mirroring
// tests/hubspot/get-client.spec.ts's own mocking of its dependencies): a
// fake HubSpotClient (a plain object exposing .fetch as a vi.fn()) is
// injected via getHubSpotClientForTenant, so every HTTP shape under test is
// asserted against a controlled Response, never a real network call.

import { describe, expect, it, vi } from "vitest";

const { getHubSpotClientForTenant } = vi.hoisted(() => ({
  getHubSpotClientForTenant: vi.fn(),
}));

vi.mock("@/lib/hubspot/get-client", () => ({ getHubSpotClientForTenant }));

const { createHubSpotAdapter } = await import("@/lib/crm-import/hubspot-adapter");

const TENANT_ID = "tenant-1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeClient(fetchImpl: (path: string, init?: RequestInit) => Promise<Response>) {
  return { fetch: vi.fn(fetchImpl) };
}

describe("createHubSpotAdapter — listDeals", () => {
  it("returns deals from a single page, resolving stage labels via one pipelines fetch", async () => {
    const client = fakeClient(async (path) => {
      if (path.startsWith("/crm/v3/pipelines/deals")) {
        return jsonResponse({ results: [{ id: "p1", stages: [{ id: "appointmentscheduled", label: "Appointment scheduled" }] }] });
      }
      if (path.startsWith("/crm/v3/objects/deals?")) {
        return jsonResponse({
          results: [
            {
              id: "deal-1",
              properties: { dealname: "Q1 rollout", amount: "1000", dealstage: "appointmentscheduled", closedate: "2026-09-01" },
              associations: { companies: { results: [{ id: "company-1" }] } },
            },
          ],
        });
      }
      if (path.startsWith("/crm/v3/objects/companies/batch/read")) {
        return jsonResponse({ results: [{ id: "company-1", properties: { name: "Acme Corp" } }] });
      }
      throw new Error(`unexpected path: ${path}`);
    });
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result).toEqual({
      ok: true,
      deals: [
        { externalId: "deal-1", name: "Q1 rollout", amount: 1000, stage: "Appointment scheduled", companyName: "Acme Corp" },
      ],
    });
  });

  it("falls back to the raw stage id when the pipelines fetch itself fails (non-fatal)", async () => {
    const client = fakeClient(async (path) => {
      if (path.startsWith("/crm/v3/pipelines/deals")) return new Response("nope", { status: 500 });
      if (path.startsWith("/crm/v3/objects/deals?")) {
        return jsonResponse({
          results: [
            { id: "deal-1", properties: { dealname: "Deal", amount: null, dealstage: "raw_stage_id", closedate: null }, associations: {} },
          ],
        });
      }
      throw new Error(`unexpected path: ${path}`);
    });
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deals[0].stage).toBe("raw_stage_id");
    expect(result.deals[0].companyName).toBeNull();
  });

  it("paginates through multiple pages using the paging.next.after cursor", async () => {
    const client = fakeClient(async (path) => {
      if (path.startsWith("/crm/v3/pipelines/deals")) return jsonResponse({ results: [] });
      if (path.includes("after=cursor-2")) {
        return jsonResponse({ results: [{ id: "deal-2", properties: { dealname: "Deal 2", amount: null, dealstage: "s", closedate: null }, associations: {} }] });
      }
      if (path.startsWith("/crm/v3/objects/deals?")) {
        return jsonResponse({
          results: [{ id: "deal-1", properties: { dealname: "Deal 1", amount: null, dealstage: "s", closedate: null }, associations: {} }],
          paging: { next: { after: "cursor-2" } },
        });
      }
      throw new Error(`unexpected path: ${path}`);
    });
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deals.map((d) => d.externalId)).toEqual(["deal-1", "deal-2"]);
  });

  it("returns token_expired when the tenant has no HubSpot connection", async () => {
    getHubSpotClientForTenant.mockResolvedValue(null);

    const adapter = createHubSpotAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("token_expired");
  });

  it("maps a 429 on the deals list page to rate_limited", async () => {
    const client = fakeClient(async (path) => {
      if (path.startsWith("/crm/v3/pipelines/deals")) return jsonResponse({ results: [] });
      return new Response("slow down", { status: 429 });
    });
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("rate_limited");
  });

  it("maps a second 401 (get-client already retried once) to token_expired", async () => {
    const client = fakeClient(async (path) => {
      if (path.startsWith("/crm/v3/pipelines/deals")) return jsonResponse({ results: [] });
      return new Response("unauthorized", { status: 401 });
    });
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("token_expired");
  });

  it("maps a 5xx on the deals list page to unknown (never invalid_data — no single object to blame at the list level)", async () => {
    const client = fakeClient(async (path) => {
      if (path.startsWith("/crm/v3/pipelines/deals")) return jsonResponse({ results: [] });
      return new Response("server error", { status: 503 });
    });
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });

  it("maps a network failure (fetch throws) to unknown", async () => {
    const client = fakeClient(async (path) => {
      if (path.startsWith("/crm/v3/pipelines/deals")) return jsonResponse({ results: [] });
      throw new Error("network down");
    });
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });

  it("maps a malformed (non-JSON) deals list page response to unknown", async () => {
    const client = fakeClient(async (path) => {
      if (path.startsWith("/crm/v3/pipelines/deals")) return jsonResponse({ results: [] });
      return new Response("not json", { status: 200, headers: { "content-type": "text/plain" } });
    });
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.listDeals(TENANT_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });
});

describe("createHubSpotAdapter — getDealDetail", () => {
  function detailClient(dealResponse: () => Response, companyResponse?: () => Response, contactResponse?: () => Response) {
    return fakeClient(async (path) => {
      if (path.startsWith("/crm/v3/objects/deals/deal-1")) return dealResponse();
      if (path.startsWith("/crm/v3/objects/companies/company-1") && companyResponse) return companyResponse();
      if (path.startsWith("/crm/v3/objects/contacts/contact-1") && contactResponse) return contactResponse();
      throw new Error(`unexpected path: ${path}`);
    });
  }

  it("fetches the deal plus its associated company and contact", async () => {
    const client = detailClient(
      () =>
        jsonResponse({
          id: "deal-1",
          properties: { dealname: "Q1 rollout", amount: "1000", dealstage: "appointmentscheduled", closedate: "2026-09-01" },
          associations: { companies: { results: [{ id: "company-1" }] }, contacts: { results: [{ id: "contact-1" }] } },
        }),
      () => jsonResponse({ id: "company-1", properties: { name: "Acme Corp", domain: "acme.example.com" } }),
      () => jsonResponse({ id: "contact-1", properties: { email: "buyer@acme.example.com" } }),
    );
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, "deal-1");

    expect(result).toEqual({
      ok: true,
      detail: {
        externalId: "deal-1",
        dealName: "Q1 rollout",
        amount: "1000",
        stage: "appointmentscheduled",
        closeDate: "2026-09-01",
        companyName: "Acme Corp",
        companyDomain: "acme.example.com",
        contactEmail: "buyer@acme.example.com",
      },
    });
  });

  it("companyName/companyDomain/contactEmail are null when the deal has no associations", async () => {
    const client = detailClient(() =>
      jsonResponse({
        id: "deal-1",
        properties: { dealname: "Deal", amount: null, dealstage: "s", closedate: null },
        associations: {},
      }),
    );
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, "deal-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.companyName).toBeNull();
    expect(result.detail.companyDomain).toBeNull();
    expect(result.detail.contactEmail).toBeNull();
  });

  it("a failed company/contact sub-fetch degrades to null rather than failing the whole deal detail", async () => {
    const client = detailClient(
      () =>
        jsonResponse({
          id: "deal-1",
          properties: { dealname: "Deal", amount: null, dealstage: "s", closedate: null },
          associations: { companies: { results: [{ id: "company-1" }] } },
        }),
      () => new Response("not found", { status: 404 }),
    );
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, "deal-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detail.companyName).toBeNull();
    expect(result.detail.companyDomain).toBeNull();
  });

  it("returns token_expired when the tenant has no HubSpot connection", async () => {
    getHubSpotClientForTenant.mockResolvedValue(null);

    const adapter = createHubSpotAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, "deal-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("token_expired");
  });

  it("maps a 429 on the deal fetch to rate_limited", async () => {
    const client = detailClient(() => new Response("slow down", { status: 429 }));
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, "deal-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("rate_limited");
  });

  it("maps a second 401 on the deal fetch to token_expired", async () => {
    const client = detailClient(() => new Response("unauthorized", { status: 401 }));
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, "deal-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("token_expired");
  });

  it("maps a 404 (deal not found/deleted) on the deal fetch to invalid_data", async () => {
    const client = detailClient(() => new Response("not found", { status: 404 }));
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, "deal-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_data");
  });

  it("maps a 5xx on the deal fetch to unknown", async () => {
    const client = detailClient(() => new Response("server error", { status: 502 }));
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, "deal-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });

  it("maps a network failure (fetch throws) on the deal fetch to unknown", async () => {
    const client = fakeClient(async () => {
      throw new Error("network down");
    });
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, "deal-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown");
  });

  it("maps a malformed (non-JSON) deal fetch response to invalid_data", async () => {
    const client = detailClient(() => new Response("not json", { status: 200 }));
    getHubSpotClientForTenant.mockResolvedValue(client);

    const adapter = createHubSpotAdapter();
    const result = await adapter.getDealDetail(TENANT_ID, "deal-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_data");
  });
});

describe("createHubSpotAdapter — provider identity", () => {
  it("identifies itself as hubspot", () => {
    const adapter = createHubSpotAdapter();
    expect(adapter.provider).toBe("hubspot");
  });
});
