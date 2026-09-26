// Sprint 12, Ticket 62 — the one error type the SSRF modules use to say
// "refused on policy" as opposed to "the network failed".
//
// It lives in its own module, not beside fetchPublicHtml, for two reasons:
//
//   1. Callers need to `instanceof` it without importing the fetcher (and,
//      in tests, without un-mocking it) — tests/api/scrape-meta.spec.ts mocks
//      @/lib/ssrf/fetch-public-html wholesale and still checks the route's
//      real 400-vs-502 branch against the real class.
//   2. Three modules (resolve, fetch-public-html, and anything added later)
//      raise it; none of them should own it.
//
// The distinction is load-bearing for app/api/scrape-meta/route.ts: a policy
// refusal is the caller's own URL being un-fetchable -> 400; a transport
// failure is our side failing -> 502. Messages are always fixed, app-authored
// strings: never a hostname, never a resolved IP, never a socket error's
// text. The route replaces the message with a generic one anyway, but a
// message that cannot leak is one fewer thing to get wrong later (same
// reasoning as HubSpotOAuthError in lib/hubspot/token-exchange.ts). The real
// detail rides along in `cause` for server-side logging.

export class BlockedUrlError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BlockedUrlError";
  }
}
