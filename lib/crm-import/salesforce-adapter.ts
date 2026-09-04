// Sprint 11, Ticket 56 — the Salesforce implementation of CrmProviderAdapter.
// Full parity with lib/crm-import/hubspot-adapter.ts: same CrmDealSummary /
// CrmDealDetail shapes out, same "never trust anything beyond externalId"
// discipline, same non-fatal-sub-fetch-degrades-to-null pattern. Every
// outbound call goes through lib/salesforce/get-client.ts's SalesforceClient
// — never raw HTTP, never a token read/refresh of its own; that module owns
// the full access-token lifecycle (cache, refresh, single-flight, exactly
// one retry-on-401), same as HubSpot's own get-client.ts.
//
// SALESFORCE_API_VERSION is the single bump point for this pipeline's REST
// API version — every path this module builds interpolates it, never a
// second hardcoded version string.
//
// NO STAGE-LABEL RESOLUTION (divergence from hubspot-adapter.ts, SETTLED):
// HubSpot's dealstage is an internal slug requiring a pipelines-metadata
// fetch to resolve to a human label; Salesforce's StageName is ALREADY the
// human-facing label both in listDeals() and getDealDetail() — there is no
// separate raw-id-vs-label divergence to document here, and no extra fetch.
//
// SOQL STRING INTERPOLATION (SECURITY, SETTLED): Salesforce's REST query
// endpoint takes a literal SOQL string in a `q=` query parameter — there is
// no bind-parameter mechanism to protect a WHERE clause the way a
// parameterized SQL query would. getDealDetail()'s WHERE Id = '<externalId>'
// is therefore string-interpolated, but ONLY after externalId is validated
// against SALESFORCE_ID_PATTERN (15 or 18 alphanumeric characters — real
// Salesforce record ids can never contain a quote or any other SOQL
// metacharacter) — an id that fails this check is rejected as invalid_data
// BEFORE any SOQL string is ever built, let alone sent.
//
// GHOST CONTACT (SETTLED): an OpportunityContactRole junction row can point
// at a Contact that has since been deleted, merged, or simply has no email —
// fetchContactEmail() below treats this exactly like hubspot-adapter.ts
// treats a failed company/contact sub-fetch: degrades to null rather than
// failing the whole deal detail. companyDomain is NEVER derived from this
// contact email (or any contact field) — Account.Website is the only source,
// matching map-deal-to-workspace.ts's existing NEVER-guess-a-domain rule.
//
// ERROR MAPPING (SETTLED decision): Salesforce error bodies arrive as an
// ARRAY of `{ message, errorCode }` objects (never a bare object like
// HubSpot's), parsed by parseSalesforceErrorBody() below. 401 here is the
// SECOND one (get-client.ts already retried once internally) -> token_expired;
// a SalesforceReauthRequiredError thrown BY get-client (a dead refresh
// token — an expected lifecycle event per that module's own header) maps to
// the same token_expired/reconnectRequired outcome, never an uncaught
// exception; 403 REQUEST_LIMIT_EXCEEDED -> rate_limited; 403
// API_DISABLED_FOR_ORG -> "unknown" (the closed CrmImportFailureReason union
// is not extended for this — see types.ts) but with a distinct, honest
// message naming the real cause (a Professional-Edition org with API access
// disabled) rather than a generic "try again" that would mislead the seller
// into retrying something retrying can never fix; 5xx -> unknown; any other
// 4xx -> invalid_data on a per-object detail fetch (a structural problem with
// THIS one Opportunity), degrading to unknown on the LIST call (mirrors
// hubspot-adapter.ts's own toListFailureReason narrowing — there is no
// single object to blame yet at the list level).

import { getSalesforceClientForTenant, type SalesforceClient } from "@/lib/salesforce/get-client";
import { SalesforceReauthRequiredError } from "@/lib/salesforce/token-exchange";
import type {
  CrmAdapterListDealsResult,
  CrmDealDetail,
  CrmDealDetailResult,
  CrmDealSummary,
  CrmImportFailureReason,
  CrmListFailureReason,
  CrmProviderAdapter,
} from "./types";

/** Single bump point for this pipeline's Salesforce REST API version. */
export const SALESFORCE_API_VERSION = "v62.0";

const DEALS_SOQL = "SELECT Id, Name, Amount, StageName, Account.Name FROM Opportunity ORDER BY CreatedDate DESC";

/** Real Salesforce record ids are always 15 (case-sensitive) or 18 (case-insensitive, checksum-suffixed) alphanumeric characters — never a quote or any other SOQL metacharacter. Checked BEFORE this id is ever interpolated into a SOQL string (see this module's header). */
const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;

/** Safety cap on pagination, same reasoning as hubspot-adapter.ts's MAX_LIST_PAGES — guards against an unbounded loop on an unexpected paging response (a server that never sets done:true). */
const MAX_LIST_PAGES = 20;

const DISCONNECTED_MESSAGE = "Connect Salesforce before importing deals.";
const UNREACHABLE_MESSAGE = "Could not reach Salesforce. Try again shortly.";
const UNREADABLE_RESPONSE_MESSAGE = "Salesforce returned a response Brava could not read.";
const DEAL_NOT_FOUND_MESSAGE = "This Opportunity could not be found in Salesforce.";
const INVALID_EXTERNAL_ID_MESSAGE = "This Salesforce record id is not a valid Opportunity id.";
/** Distinct, honest message for API_DISABLED_FOR_ORG (SETTLED decision, see this module's header) — retrying never helps until the org's edition changes, so the generic "try again shortly" copy would be actively misleading here. */
const API_DISABLED_MESSAGE =
  "Your Salesforce edition doesn't include API access — retrying won't help until it's enabled on the Salesforce side.";

function queryPath(soql: string): string {
  return `/services/data/${SALESFORCE_API_VERSION}/query?q=${encodeURIComponent(soql)}`;
}

function isValidSalesforceId(id: string): boolean {
  return SALESFORCE_ID_PATTERN.test(id);
}

// --- Salesforce raw response shapes ---------------------------------------

interface SalesforceQueryResponse<T> {
  readonly totalSize: number;
  readonly done: boolean;
  /** A full relative path (e.g. "/services/data/v62.0/query/01g...-2000") — passed straight to client.fetch, never rebuilt. */
  readonly nextRecordsUrl?: string;
  readonly records: readonly T[];
}

interface SalesforceAccountRef {
  readonly Name: string | null;
}

interface SalesforceOpportunityListRecord {
  readonly Id: string;
  readonly Name: string | null;
  readonly Amount: number | null;
  readonly StageName: string | null;
  readonly Account: SalesforceAccountRef | null;
}

interface SalesforceAccountDetailRef {
  readonly Name: string | null;
  readonly Website: string | null;
}

interface SalesforceOpportunityDetailRecord {
  readonly Id: string;
  readonly Name: string | null;
  readonly Amount: number | null;
  readonly StageName: string | null;
  readonly CloseDate: string | null;
  readonly AccountId: string | null;
  readonly Account: SalesforceAccountDetailRef | null;
}

interface SalesforceContactRoleRecord {
  readonly Contact: { readonly Email: string | null } | null;
}

/** Salesforce's error response body shape — an ARRAY of these, never a bare object (this module's own header). */
interface SalesforceErrorEntry {
  readonly message?: unknown;
  readonly errorCode?: unknown;
}

// --- error classification --------------------------------------------------

/**
 * Never throws — an unparseable or unexpectedly-shaped body just yields
 * `null`, and classification falls back to status-code-only rules below.
 * Only `errorCode` is extracted: Salesforce's own free-text `message` is
 * deliberately never surfaced to the seller (this module builds its own
 * fixed, honest copy per status/errorCode below instead — same discipline
 * as hubspot-adapter.ts's own httpFailureMessage()).
 */
async function parseSalesforceErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (Array.isArray(body) && body.length > 0) {
      const first = body[0] as SalesforceErrorEntry;
      return typeof first.errorCode === "string" ? first.errorCode : null;
    }
  } catch {
    // Not JSON, or an unexpected shape — fall through to status-only rules.
  }
  return null;
}

function classifyHttpFailure(status: number, errorCode: string | null): CrmImportFailureReason {
  if (status === 401) return "token_expired";
  if (status === 403 && errorCode === "REQUEST_LIMIT_EXCEEDED") return "rate_limited";
  if (status === 403 && errorCode === "API_DISABLED_FOR_ORG") return "unknown";
  if (status >= 500) return "unknown";
  return "invalid_data";
}

function httpFailureMessage(status: number, errorCode: string | null): string {
  if (errorCode === "API_DISABLED_FOR_ORG") return API_DISABLED_MESSAGE;
  if (status === 403 && errorCode === "REQUEST_LIMIT_EXCEEDED") return "Salesforce rate-limited this request.";
  if (status === 401) return "The Salesforce connection is no longer valid.";
  return `Salesforce returned an unexpected response (status ${status}).`;
}

/** listDeals()'s own failure reason has no invalid_data slot — see hubspot-adapter.ts's equivalent comment on why (types.ts owns the full reasoning). */
function toListFailureReason(reason: CrmImportFailureReason): CrmListFailureReason {
  return reason === "invalid_data" ? "unknown" : reason;
}

type FetchJsonResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly reason: CrmImportFailureReason; readonly message: string };

async function fetchJsonWithClient<T>(client: SalesforceClient, path: string): Promise<FetchJsonResult<T>> {
  let response: Response;
  try {
    response = await client.fetch(path);
  } catch (error: unknown) {
    // A dead refresh token surfaces here too (client.fetch() re-checks token
    // freshness on every call, not just at construction) — same mapping as
    // getClientOrFailure()'s own SalesforceReauthRequiredError handling
    // below, so a reconnect-required outcome is never mistaken for a
    // transient network failure.
    if (error instanceof SalesforceReauthRequiredError) {
      return { ok: false, reason: "token_expired", message: DISCONNECTED_MESSAGE };
    }
    return { ok: false, reason: "unknown", message: UNREACHABLE_MESSAGE };
  }

  if (!response.ok) {
    const errorCode = await parseSalesforceErrorCode(response);
    return {
      ok: false,
      reason: classifyHttpFailure(response.status, errorCode),
      message: httpFailureMessage(response.status, errorCode),
    };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, reason: "invalid_data", message: UNREADABLE_RESPONSE_MESSAGE };
  }
}

// --- client acquisition -----------------------------------------------------

type ClientResult = { readonly ok: true; readonly client: SalesforceClient } | { readonly ok: false; readonly reason: CrmImportFailureReason; readonly message: string };

/**
 * getSalesforceClientForTenant() returns null for "never connected", but can
 * also THROW (most notably SalesforceReauthRequiredError — an expected
 * lifecycle event per lib/salesforce/get-client.ts's own header, not an
 * anomaly) when a stored connection's refresh token has died. Both outcomes
 * fold into the same token_expired/reconnectRequired shape here, so neither
 * case can escape this adapter as an uncaught exception.
 */
async function getClientOrFailure(tenantId: string): Promise<ClientResult> {
  try {
    const client = await getSalesforceClientForTenant(tenantId);
    if (!client) return { ok: false, reason: "token_expired", message: DISCONNECTED_MESSAGE };
    return { ok: true, client };
  } catch (error: unknown) {
    if (error instanceof SalesforceReauthRequiredError) {
      return { ok: false, reason: "token_expired", message: DISCONNECTED_MESSAGE };
    }
    return { ok: false, reason: "unknown", message: UNREACHABLE_MESSAGE };
  }
}

// --- pure-ish helpers -------------------------------------------------

function toDealSummary(record: SalesforceOpportunityListRecord): CrmDealSummary {
  return {
    externalId: record.Id,
    name: record.Name ?? "",
    amount: record.Amount,
    stage: record.StageName ?? "",
    companyName: record.Account?.Name ?? null,
  };
}

// --- listDeals ----------------------------------------------------------

// Security review (T56): nextRecordsUrl comes back inside the query RESPONSE
// body — org-influenced data by this module's own threat model — and becomes
// the path of the next Bearer-authed request. Unvalidated, a crafted
// "@evil.example/..." value would re-aim that request (and the access token)
// at an attacker host via URL userinfo parsing. Only Salesforce's documented
// pagination-locator shape is followed; anything else ends the list as a
// failed fetch rather than being requested.
const SALESFORCE_NEXT_RECORDS_PATH_PATTERN = /^\/services\/data\/v\d+\.\d+\/query\/[\w-]+$/;
const INVALID_NEXT_RECORDS_MESSAGE =
  "Salesforce returned an unexpected pagination reference, so the deal list could not be fetched completely.";

async function listAllDeals(client: SalesforceClient): Promise<CrmAdapterListDealsResult> {
  let deals: readonly CrmDealSummary[] = [];
  let path: string | undefined = queryPath(DEALS_SOQL);
  let pagesFetched = 0;

  while (path && pagesFetched < MAX_LIST_PAGES) {
    const page: FetchJsonResult<SalesforceQueryResponse<SalesforceOpportunityListRecord>> = await fetchJsonWithClient(
      client,
      path,
    );
    if (!page.ok) return { ok: false, reason: toListFailureReason(page.reason), message: page.message };

    deals = [...deals, ...page.data.records.map(toDealSummary)];
    pagesFetched += 1;
    path = page.data.done ? undefined : page.data.nextRecordsUrl;
    if (path !== undefined && !SALESFORCE_NEXT_RECORDS_PATH_PATTERN.test(path)) {
      return { ok: false, reason: "unknown", message: INVALID_NEXT_RECORDS_MESSAGE };
    }
  }

  return { ok: true, deals };
}

// --- getDealDetail --------------------------------------------------------

/**
 * Non-fatal, mirrors hubspot-adapter.ts's own fetchCompanyDetail /
 * fetchContactEmail degrade: a failed OpportunityContactRole query, or a
 * junction row resolving to no usable contact (Ghost Contact — see this
 * module's header), returns null rather than failing the whole deal detail.
 * The first contact-role row carrying a non-empty email wins; ordering
 * beyond that is not this pipeline's concern (v1 has no "primary contact"
 * preference beyond "the first one with an actual email").
 */
async function fetchContactEmail(client: SalesforceClient, externalId: string): Promise<string | null> {
  const soql = `SELECT Contact.Email FROM OpportunityContactRole WHERE OpportunityId = '${externalId}'`;
  const result = await fetchJsonWithClient<SalesforceQueryResponse<SalesforceContactRoleRecord>>(client, queryPath(soql));
  if (!result.ok) return null;

  const withEmail = result.data.records.find((record) => Boolean(record.Contact?.Email));
  return withEmail?.Contact?.Email ?? null;
}

async function fetchDealDetail(client: SalesforceClient, externalId: string): Promise<CrmDealDetailResult> {
  const soql = `SELECT Id, Name, Amount, StageName, CloseDate, AccountId, Account.Name, Account.Website FROM Opportunity WHERE Id = '${externalId}'`;
  const dealResult = await fetchJsonWithClient<SalesforceQueryResponse<SalesforceOpportunityDetailRecord>>(client, queryPath(soql));
  if (!dealResult.ok) return { ok: false, reason: dealResult.reason, message: dealResult.message };

  const record = dealResult.data.records[0];
  if (!record) {
    // Zero rows is not an HTTP error (Salesforce's query endpoint returns
    // 200 with an empty records array for "no match") — a deleted/never-
    // existed Opportunity id is a structural problem with this ONE object,
    // same bucket as hubspot-adapter.ts's 404-on-deal-fetch -> invalid_data.
    return { ok: false, reason: "invalid_data", message: DEAL_NOT_FOUND_MESSAGE };
  }

  // Non-fatal sub-fetch — see fetchContactEmail's own header.
  const contactEmail = await fetchContactEmail(client, externalId);

  const detail: CrmDealDetail = {
    externalId: record.Id,
    dealName: record.Name,
    amount: record.Amount === null ? null : String(record.Amount),
    stage: record.StageName,
    closeDate: record.CloseDate,
    companyName: record.Account?.Name ?? null,
    // NEVER derive companyDomain from contactEmail — Account.Website only
    // (this module's header; matches map-deal-to-workspace.ts's own rule).
    companyDomain: record.Account?.Website ?? null,
    contactEmail,
  };

  return { ok: true, detail };
}

// --- adapter ----------------------------------------------------------

export function createSalesforceAdapter(): CrmProviderAdapter {
  return {
    provider: "salesforce",

    async listDeals(tenantId: string): Promise<CrmAdapterListDealsResult> {
      const clientResult = await getClientOrFailure(tenantId);
      if (!clientResult.ok) return { ok: false, reason: toListFailureReason(clientResult.reason), message: clientResult.message };
      return listAllDeals(clientResult.client);
    },

    async getDealDetail(tenantId: string, externalId: string): Promise<CrmDealDetailResult> {
      // SECURITY: validated BEFORE any SOQL string is built or any client is
      // even acquired — see this module's header on SOQL string
      // interpolation.
      if (!isValidSalesforceId(externalId)) {
        return { ok: false, reason: "invalid_data", message: INVALID_EXTERNAL_ID_MESSAGE };
      }

      const clientResult = await getClientOrFailure(tenantId);
      if (!clientResult.ok) return clientResult;
      return fetchDealDetail(clientResult.client, externalId);
    },
  };
}
