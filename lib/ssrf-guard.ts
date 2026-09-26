// Scheme validation for seller-pasted URLs that are STORED and later
// rendered as a clickable href — not fetched.
//
// Sprint 12, Ticket 62 emptied this file of everything else. It used to also
// export `assertPublicHttpUrl`, the DNS-based SSRF check for the two
// server-side fetchers (app/api/scrape-meta/route.ts and
// lib/crm/brand-scrape.ts). That function is gone, not moved, because it was
// unsound in a way a wrapper could not fix:
//
//   - it resolved the hostname with dns.lookup() (first address only, no
//     `all: true`) and then RETURNED, leaving the caller's fetch() to
//     resolve the name a second time — so its old comment claiming it
//     "defends against DNS rebinding" was simply false; it checked one
//     answer and connected on another. Only pinning the validated address to
//     the socket defends against that, which is what
//     lib/ssrf/pinned-request.ts now does.
//   - both callers used `fetch(..., { redirect: "follow" })`, so a public
//     page that answered `302 Location: http://169.254.169.254/...` was
//     fetched with no re-validation at all.
//   - its private-range table missed carrier NAT, the TEST-NETs, multicast,
//     240/4, IPv6 "::", hex-form IPv4-mapped addresses, NAT64, 6to4 and most
//     of fe80::/10 (see lib/ssrf/ip-ranges.ts for the full list).
//
// Fetching now lives in lib/ssrf/ (ip-ranges -> resolve -> pinned-request ->
// fetch-public-html). Nothing http-fetch-related should be added back here.

/**
 * T32-1 (Sprint 6, Ticket 32; plans/sprint-6-7-replan.md §6). For
 * seller-controlled URLs that are stored and later rendered as a raw,
 * clickable href (workspaces.chat_url / internal_chat_url) rather than
 * fetched server-side, so there is no SSRF surface to guard here (no
 * hostname/DNS resolution needed): the risk is scheme-based, a stored
 * `javascript:`/`data:`/`vbscript:` URL executing in the buyer's browser.
 * https:-only because nothing on this path needs http: to work.
 *
 * Deliberately synchronous and pure (no I/O) so it stays a trivially
 * unit-testable throwing function for the T32-5 scheme-rejection tests
 * (tests/security/assert-https-url.spec.ts).
 */
export function assertHttpsUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Not a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("URL scheme must be https.");
  }

  return parsed;
}
