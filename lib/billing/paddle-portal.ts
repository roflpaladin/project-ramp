import "server-only";

// Sprint 12, Ticket 59 (slice 2 — seller-facing billing surface). The one
// place that calls Paddle's Customer Portal API. Endpoint, request and
// response shape confirmed against the live doc (curled 2026-09-21,
// https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session):
//
//   POST {apiBase}/customers/{customer_id}/portal-sessions
//   body: { "subscription_ids": ["sub_..."] }
//   response: { "data": { "urls": { "general": { "overview": "https://customer-portal.paddle.com/...?token=..." } } } }
//
// Importer: app/settings/billing/actions.ts's openBillingPortalAction, which
// resolves customerId/subscriptionId server-side from the signed-in
// seller's OWN tenant row (lib/billing/subscription-repository.ts) — this
// module never receives, and has no way to receive, an id supplied by a
// caller. Mirrors lib/hubspot/token-exchange.ts's outbound-fetch shape
// (injectable fetch, AbortSignal.timeout, a small typed error whose message
// is always a fixed, app-authored string — never the raw response body).
// This one carries an extra rule on top: the returned URL contains a live,
// single-use session token, so — like the API key — it must never appear in
// a thrown message or a console.error call. Callers log only
// `error.message` (see the class below), never `error.cause` or any part of
// the response.

const PORTAL_FETCH_TIMEOUT_MS = 8000;

export class PaddlePortalError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PaddlePortalError";
  }
}

export interface CreatePortalSessionInput {
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly customerId: string;
  readonly subscriptionId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `data.urls.general.overview` only — nothing else in the response is ever read. */
function readOverviewUrl(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const { urls } = body.data;
  if (!isRecord(urls) || !isRecord(urls.general)) return null;
  const overview = urls.general.overview;
  return typeof overview === "string" && overview.trim() !== "" ? overview : null;
}

const ALLOWED_PROTOCOL = "https:";
const ALLOWED_HOST = "paddle.com";
const ALLOWED_HOST_SUFFIX = ".paddle.com";

/**
 * Never redirect to an unvalidated URL: https, and a host that either IS
 * paddle.com or is a genuine paddle.com subdomain — never merely "the
 * string paddle.com appears at the end of the host", which a host like
 * "notpaddle.com" would also satisfy under a naive `.endsWith("paddle.com")`
 * check.
 */
function isTrustedPaddleUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== ALLOWED_PROTOCOL) return false;
  return url.hostname === ALLOWED_HOST || url.hostname.endsWith(ALLOWED_HOST_SUFFIX);
}

/**
 * Throws PaddlePortalError on every failure path — network error/timeout,
 * non-2xx, malformed JSON, a missing/blank overview URL, or a URL on an
 * untrusted scheme/host. Never throws (or logs) the API key or the response
 * body verbatim.
 */
export async function createBillingPortalSession(
  input: CreatePortalSessionInput,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const endpoint = `${input.apiBaseUrl}/customers/${encodeURIComponent(input.customerId)}/portal-sessions`;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({ subscription_ids: [input.subscriptionId] }),
      signal: AbortSignal.timeout(PORTAL_FETCH_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new PaddlePortalError("Couldn't reach Paddle to open the billing portal.", error);
  }

  if (!response.ok) {
    throw new PaddlePortalError(`Paddle rejected the portal session request (status ${response.status}).`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error: unknown) {
    throw new PaddlePortalError("Paddle's portal session response was not valid JSON.", error);
  }

  const url = readOverviewUrl(body);
  if (!url) {
    throw new PaddlePortalError("Paddle's portal session response was missing the overview URL.");
  }
  if (!isTrustedPaddleUrl(url)) {
    throw new PaddlePortalError("Paddle returned a portal URL on an unexpected host.");
  }

  return url;
}
