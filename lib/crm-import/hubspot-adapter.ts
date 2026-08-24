// Sprint 10, Ticket 53 — the HubSpot implementation of CrmProviderAdapter.
// Every outbound call goes through lib/hubspot/get-client.ts's
// HubSpotClient — never raw HTTP, never a token read/refresh of its own.
// That module already owns the full access-token lifecycle (cache, refresh,
// exactly one retry-on-401) and this adapter's whole job is turning
// HubSpot's REST shapes into this ticket's CrmDealSummary / CrmDealDetail
// shapes, nothing more.
//
// PICKER-LABEL-VS-PERSISTED-ID DIVERGENCE (SETTLED decision, documented
// here per the ticket): listDeals()'s CrmDealSummary.stage is the human
// pipeline-stage LABEL ("Appointment scheduled"), resolved via one
// pipelines-metadata fetch cached for the lifetime of a single listDeals()
// call (never across calls, never across tenants — no module-level cache).
// getDealDetail()'s CrmDealDetail.stage is HubSpot's RAW internal stage id
// ("appointmentscheduled") — the write path (write-crm-import.ts) persists
// that raw id as-is to workspaces.crm_stage, never the label. A future
// reader of crm_stage must resolve it back through HubSpot's own pipeline
// metadata to show a label; this adapter does not cache that mapping
// anywhere durable.
//
// LEAST-DATA READS (SETTLED decision): every HubSpot request below passes
// an explicit `properties=` list — dealname/amount/dealstage/closedate for
// deals, name/domain for companies, email only for contacts. Never a bare
// object read that returns HubSpot's full default property set.
//
// ERROR MAPPING (SETTLED decision): 429 -> rate_limited; a 401 here is the
// SECOND one (get-client.ts already retried once internally on its own) ->
// token_expired; any other 4xx (404 deal not found/deleted, 400 bad
// request, a malformed/non-JSON response body) is a structural problem with
// this ONE object -> invalid_data; a network failure, timeout, or 5xx ->
// unknown. listDeals()'s own failure reason is the narrower
// CrmListFailureReason (no invalid_data — see types.ts's own comment on
// why): an invalid_data-classified failure on the LIST page itself (not a
// per-deal detail fetch) degrades to unknown, since there is no single
// deal's content to blame yet at that point.

import { getHubSpotClientForTenant, type HubSpotClient } from "@/lib/hubspot/get-client";
import type {
  CrmAdapterListDealsResult,
  CrmDealDetail,
  CrmDealDetailResult,
  CrmDealSummary,
  CrmImportFailureReason,
  CrmListFailureReason,
  CrmProviderAdapter,
} from "./types";

const DEAL_PROPERTIES = ["dealname", "amount", "dealstage", "closedate"] as const;
const COMPANY_PROPERTIES = ["name", "domain"] as const;
const CONTACT_PROPERTIES = ["email"] as const;
const DEALS_PAGE_LIMIT = 100;
/** Safety cap on pagination — 20 pages * 100/page = 2000 deals per listDeals() call, well above any real pilot tenant's deal count, guards against an unbounded loop on an unexpected paging response. */
const MAX_LIST_PAGES = 20;

const DISCONNECTED_MESSAGE = "Connect HubSpot before importing deals.";
const UNREACHABLE_MESSAGE = "Could not reach HubSpot. Try again shortly.";
const UNREADABLE_RESPONSE_MESSAGE = "HubSpot returned a response Brava could not read.";

function httpFailureMessage(status: number): string {
  if (status === 429) return "HubSpot rate-limited this request.";
  if (status === 401) return "The HubSpot connection is no longer valid.";
  return `HubSpot returned an unexpected response (status ${status}).`;
}

/** 429 -> rate_limited; a 401 here is the SECOND one (get-client.ts already retried once) -> token_expired; 5xx -> unknown; any other status (404, 400, ...) -> invalid_data — a structural problem with this one object, not a transient platform failure. */
function classifyHttpFailure(status: number): CrmImportFailureReason {
  if (status === 429) return "rate_limited";
  if (status === 401) return "token_expired";
  if (status >= 500) return "unknown";
  return "invalid_data";
}

/** listDeals()'s own failure reason has no invalid_data slot — see this module's header. */
function toListFailureReason(reason: CrmImportFailureReason): CrmListFailureReason {
  return reason === "invalid_data" ? "unknown" : reason;
}

type FetchJsonResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly reason: CrmImportFailureReason; readonly message: string };

async function fetchJsonWithClient<T>(client: HubSpotClient, path: string, init?: RequestInit): Promise<FetchJsonResult<T>> {
  let response: Response;
  try {
    response = await client.fetch(path, init);
  } catch {
    return { ok: false, reason: "unknown", message: UNREACHABLE_MESSAGE };
  }

  if (!response.ok) {
    return { ok: false, reason: classifyHttpFailure(response.status), message: httpFailureMessage(response.status) };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "invalid_data", message: UNREADABLE_RESPONSE_MESSAGE };
  }
}

// --- HubSpot raw response shapes ------------------------------------------

interface HubSpotDealProperties {
  readonly dealname: string | null;
  readonly amount: string | null;
  readonly dealstage: string | null;
  readonly closedate: string | null;
}

interface HubSpotAssociationsBlock {
  readonly results?: ReadonlyArray<{ readonly id: string }>;
}

interface HubSpotDealListItem {
  readonly id: string;
  readonly properties: HubSpotDealProperties;
  readonly associations?: { readonly companies?: HubSpotAssociationsBlock };
}

interface HubSpotDealsPageResponse {
  readonly results: readonly HubSpotDealListItem[];
  readonly paging?: { readonly next?: { readonly after?: string } };
}

interface HubSpotPipelineStage {
  readonly id: string;
  readonly label: string;
}

interface HubSpotPipeline {
  readonly id: string;
  readonly stages: readonly HubSpotPipelineStage[];
}

interface HubSpotPipelinesResponse {
  readonly results: readonly HubSpotPipeline[];
}

interface HubSpotBatchReadResponse<TProps> {
  readonly results: ReadonlyArray<{ readonly id: string; readonly properties: TProps }>;
}

interface HubSpotDealDetailResponse {
  readonly id: string;
  readonly properties: HubSpotDealProperties;
  readonly associations?: {
    readonly companies?: HubSpotAssociationsBlock;
    readonly contacts?: HubSpotAssociationsBlock;
  };
}

interface HubSpotCompanyProperties {
  readonly name: string | null;
  readonly domain: string | null;
}

interface HubSpotContactProperties {
  readonly email: string | null;
}

// --- pure-ish helpers -------------------------------------------------

/** Blank/absent/unparseable -> null — a malformed amount is display data, not a reason to fail the whole picker row (mirrors map-deal-to-workspace.ts's own leniency for the same field). */
function parseListAmount(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstAssociationId(block: HubSpotAssociationsBlock | undefined): string | null {
  return block?.results?.[0]?.id ?? null;
}

function toDealSummary(
  item: HubSpotDealListItem,
  stageLabels: ReadonlyMap<string, string>,
  companyNames: ReadonlyMap<string, string>,
): CrmDealSummary {
  const rawStage = item.properties.dealstage ?? "";
  const companyId = firstAssociationId(item.associations?.companies);

  return {
    externalId: item.id,
    name: item.properties.dealname ?? "",
    amount: parseListAmount(item.properties.amount),
    stage: stageLabels.get(rawStage) ?? rawStage,
    companyName: companyId ? (companyNames.get(companyId) ?? null) : null,
  };
}

// --- listDeals ----------------------------------------------------------

/** Non-fatal: a failed pipelines fetch falls back to every deal showing its raw stage id as its own label rather than failing the whole list. */
async function fetchStageLabels(client: HubSpotClient): Promise<ReadonlyMap<string, string>> {
  const result = await fetchJsonWithClient<HubSpotPipelinesResponse>(client, "/crm/v3/pipelines/deals");
  if (!result.ok) return new Map();

  const entries: Array<[string, string]> = [];
  for (const pipeline of result.data.results) {
    for (const stage of pipeline.stages) entries.push([stage.id, stage.label]);
  }
  return new Map(entries);
}

/** Non-fatal, same reasoning as fetchStageLabels: a failed batch company read falls back to every deal in the page showing companyName: null. */
async function fetchCompanyNames(client: HubSpotClient, companyIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (companyIds.length === 0) return new Map();

  const result = await fetchJsonWithClient<HubSpotBatchReadResponse<HubSpotCompanyProperties>>(
    client,
    "/crm/v3/objects/companies/batch/read",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ properties: ["name"], inputs: companyIds.map((id) => ({ id })) }),
    },
  );
  if (!result.ok) return new Map();

  return new Map(
    result.data.results
      .map((row) => [row.id, row.properties.name] as const)
      .filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== ""),
  );
}

async function fetchDealsPage(client: HubSpotClient, after: string | undefined): Promise<FetchJsonResult<HubSpotDealsPageResponse>> {
  const params = new URLSearchParams({
    limit: String(DEALS_PAGE_LIMIT),
    properties: DEAL_PROPERTIES.join(","),
    associations: "companies",
  });
  if (after) params.set("after", after);
  return fetchJsonWithClient<HubSpotDealsPageResponse>(client, `/crm/v3/objects/deals?${params.toString()}`);
}

async function listAllDeals(client: HubSpotClient): Promise<CrmAdapterListDealsResult> {
  const stageLabels = await fetchStageLabels(client);
  let deals: readonly CrmDealSummary[] = [];
  let after: string | undefined;
  let pagesFetched = 0;

  do {
    const page = await fetchDealsPage(client, after);
    if (!page.ok) return { ok: false, reason: toListFailureReason(page.reason), message: page.message };

    const companyIds = [...new Set(page.data.results.map((item) => firstAssociationId(item.associations?.companies)).filter((id): id is string => id !== null))];
    const companyNames = await fetchCompanyNames(client, companyIds);

    deals = [...deals, ...page.data.results.map((item) => toDealSummary(item, stageLabels, companyNames))];

    after = page.data.paging?.next?.after;
    pagesFetched += 1;
  } while (after && pagesFetched < MAX_LIST_PAGES);

  return { ok: true, deals };
}

// --- getDealDetail --------------------------------------------------------

async function fetchCompanyDetail(client: HubSpotClient, companyId: string): Promise<{ readonly name: string | null; readonly domain: string | null } | null> {
  const params = new URLSearchParams({ properties: COMPANY_PROPERTIES.join(",") });
  const result = await fetchJsonWithClient<{ readonly id: string; readonly properties: HubSpotCompanyProperties }>(
    client,
    `/crm/v3/objects/companies/${encodeURIComponent(companyId)}?${params.toString()}`,
  );
  if (!result.ok) return null;
  return { name: result.data.properties.name, domain: result.data.properties.domain };
}

async function fetchContactEmail(client: HubSpotClient, contactId: string): Promise<string | null> {
  const params = new URLSearchParams({ properties: CONTACT_PROPERTIES.join(",") });
  const result = await fetchJsonWithClient<{ readonly id: string; readonly properties: HubSpotContactProperties }>(
    client,
    `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?${params.toString()}`,
  );
  if (!result.ok) return null;
  return result.data.properties.email;
}

async function fetchDealDetail(client: HubSpotClient, externalId: string): Promise<CrmDealDetailResult> {
  const params = new URLSearchParams({ properties: DEAL_PROPERTIES.join(","), associations: "companies,contacts" });
  const dealResult = await fetchJsonWithClient<HubSpotDealDetailResponse>(
    client,
    `/crm/v3/objects/deals/${encodeURIComponent(externalId)}?${params.toString()}`,
  );
  if (!dealResult.ok) return { ok: false, reason: dealResult.reason, message: dealResult.message };

  const companyId = firstAssociationId(dealResult.data.associations?.companies);
  const contactId = firstAssociationId(dealResult.data.associations?.contacts);

  // Company/contact sub-fetch failures are non-fatal (fetchCompanyDetail /
  // fetchContactEmail return null on any failure) — a stale or since-deleted
  // association must not fail the whole deal detail; downstream
  // map-deal-to-workspace.ts is what decides whether a missing companyDomain
  // is actually fatal for THIS deal.
  const [company, contactEmail] = await Promise.all([
    companyId ? fetchCompanyDetail(client, companyId) : Promise.resolve(null),
    contactId ? fetchContactEmail(client, contactId) : Promise.resolve(null),
  ]);

  const detail: CrmDealDetail = {
    externalId,
    dealName: dealResult.data.properties.dealname,
    amount: dealResult.data.properties.amount,
    stage: dealResult.data.properties.dealstage,
    closeDate: dealResult.data.properties.closedate,
    companyName: company?.name ?? null,
    companyDomain: company?.domain ?? null,
    contactEmail,
  };

  return { ok: true, detail };
}

// --- adapter ----------------------------------------------------------

export function createHubSpotAdapter(): CrmProviderAdapter {
  return {
    provider: "hubspot",

    async listDeals(tenantId: string): Promise<CrmAdapterListDealsResult> {
      const client = await getHubSpotClientForTenant(tenantId);
      if (!client) return { ok: false, reason: "token_expired", message: DISCONNECTED_MESSAGE };
      return listAllDeals(client);
    },

    async getDealDetail(tenantId: string, externalId: string): Promise<CrmDealDetailResult> {
      const client = await getHubSpotClientForTenant(tenantId);
      if (!client) return { ok: false, reason: "token_expired", message: DISCONNECTED_MESSAGE };
      return fetchDealDetail(client, externalId);
    },
  };
}
