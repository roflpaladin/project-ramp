import { BlockedUrlError } from "./errors";
import { pinnedRequest, type PinnedRequestOptions, type PinnedResponse } from "./pinned-request";
import { resolvePublicAddresses, type ResolvedAddress } from "./resolve";

// Sprint 12, Ticket 62 — the ONE way this codebase fetches a URL a user
// supplied. app/api/scrape-meta/route.ts and lib/crm/brand-scrape.ts both go
// through here; neither calls global fetch() any more.
//
// It composes the other two modules into the rule that the pre-T62 code got
// wrong: validate, pin, and then do the WHOLE thing again for every redirect
// hop. The old code called
//
//     assertPublicHttpUrl(url)            // validates hop zero, by DNS
//     fetch(url, { redirect: "follow" })  // re-resolves, and follows 3xx
//                                         // to wherever, unchecked
//
// so a public page answering `302 Location: http://169.254.169.254/...`
// (or a private intranet host, or file:///etc/passwd) got fetched and its
// body handed back to the caller. A redirect is attacker-controlled input
// exactly like the original URL, and is treated as such here: same scheme
// check, same DNS policy, same pin, every hop.
//
// Both collaborators are injectable (FetchDeps) so the orchestration above
// is testable without DNS or sockets.
//
// Failure vocabulary, which the route depends on:
//   BlockedUrlError -> "your URL is not fetchable"  (400)
//   any other Error -> "we could not fetch it"      (502)
// Messages never contain a hostname or a resolved address: they are logged
// and, in principle, reachable by a client.

const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 500_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const HTTP_OK_MIN = 200;
const HTTP_OK_MAX = 299;

export interface FetchedPage {
  readonly html: string;
  /** The URL the body actually came from, after any redirects — what
   * relative links in the HTML must be resolved against. */
  readonly finalUrl: URL;
}

export interface FetchDeps {
  readonly resolve: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  readonly request: (url: URL, pinned: ResolvedAddress, options: PinnedRequestOptions) => Promise<PinnedResponse>;
}

const defaultDeps: FetchDeps = {
  resolve: (hostname) => resolvePublicAddresses(hostname),
  request: pinnedRequest,
};

function parseHttpUrl(value: string, base?: URL): URL {
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    throw new BlockedUrlError("Not a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedUrlError("URL scheme must be http or https.");
  }
  return parsed;
}

function nextRedirectTarget(location: string | null, current: URL): URL {
  if (!location) {
    // A 3xx with no Location is a broken upstream, not a policy refusal —
    // an ordinary Error so the route answers 502 rather than blaming the
    // caller's URL.
    throw new Error("Redirect response carried no Location header.");
  }
  return parseHttpUrl(location, current);
}

function assertOkStatus(status: number): void {
  if (status < HTTP_OK_MIN || status > HTTP_OK_MAX) {
    throw new Error(`Upstream responded with status ${status}.`);
  }
}

/**
 * Fetches `rawUrl` (at most `MAX_RESPONSE_BYTES`, within one overall
 * `FETCH_TIMEOUT_MS` budget spanning every redirect hop) and returns the body
 * with the URL it finally came from.
 *
 * Throws BlockedUrlError when the URL — or any redirect it leads to — is not
 * a fetchable public http(s) address, and an ordinary Error for transport or
 * status failures.
 */
export async function fetchPublicHtml(rawUrl: string, deps: FetchDeps = defaultDeps): Promise<FetchedPage> {
  // One signal for the whole chain: a per-hop timeout would let a redirect
  // loop hold a request open for MAX_REDIRECTS * FETCH_TIMEOUT_MS.
  const options: PinnedRequestOptions = {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    maxBytes: MAX_RESPONSE_BYTES,
  };

  let current = parseHttpUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const addresses = await deps.resolve(current.hostname);
    const [pinned] = addresses;
    if (!pinned) throw new BlockedUrlError("URL host is not allowed.");

    const response = await deps.request(current, pinned, options);

    if (!REDIRECT_STATUSES.has(response.status)) {
      assertOkStatus(response.status);
      return { html: response.body, finalUrl: current };
    }

    current = nextRedirectTarget(response.location, current);
  }

  throw new BlockedUrlError("Too many redirects.");
}
