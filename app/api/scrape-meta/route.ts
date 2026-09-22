import { NextResponse } from "next/server";

import { parseMeta } from "@/lib/meta-scrape";
import { requireSeller } from "@/lib/plans/require-seller";
import { SCRAPE_META_RATE_LIMIT } from "@/lib/rate-limit";
import { checkDurableRateLimit } from "@/lib/rate-limit-durable";
import { BlockedUrlError } from "@/lib/ssrf/errors";
import { fetchPublicHtml, type FetchedPage } from "@/lib/ssrf/fetch-public-html";

// Server-side OpenGraph/HTML scraper that hydrates the seller builder form
// (Sprint 2, Ticket 12). Server-side only, to centralize SSRF controls and
// avoid CORS. Always resolves with a clean JSON body -- never throws -- so
// the client can degrade to manual entry on any failure.
//
// Sprint 12, Ticket 62 hardened two things here:
//
// 1. AUTH. This route is not covered by middleware.ts's matcher ("/",
//    "/admin/:path*", "/settings/:path*"), so until T62 anyone on the
//    internet could make this server fetch a URL of their choosing and read
//    the result back — an open proxy wearing our egress IP. Every real
//    caller is a signed-in seller screen under /admin
//    (lib/use-scrape-meta-prefill.ts, app/admin/workspaces/[id]/link-url-field.tsx),
//    so requiring a seller costs those callers nothing.
//
// 2. THE FETCH ITSELF now goes through lib/ssrf/fetch-public-html.ts
//    (validated DNS + a pinned socket + re-validation of every redirect hop)
//    instead of assertPublicHttpUrl + global fetch(redirect: "follow"),
//    which followed a 302 to anywhere. The read cap and 5s budget that used
//    to be inlined here live in that module now — one implementation, shared
//    with lib/crm/brand-scrape.ts.
//
// The response contract is unchanged apart from the new 401: 400 for a bad
// body or an un-fetchable URL, 502 when the fetch itself fails, 200
// { title, desc, favicon }. The 400/502 split is exactly the
// BlockedUrlError/Error split, and no upstream error text ever reaches the
// caller.
export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireSeller();
  if (!session) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  }
  // Each call makes this server fetch a third-party page on the seller's
  // behalf, so the budget is per seller, not per IP.
  const { allowed, retryAfterSeconds } = await checkDurableRateLimit(
    `scrape-meta:${session.userId}`,
    SCRAPE_META_RATE_LIMIT,
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { url: rawUrl } = (body ?? {}) as { url?: unknown };
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return NextResponse.json({ error: "url is required." }, { status: 400 });
  }

  // Only the fetch is inside the try: a parse bug must not be reported to
  // the caller as an upstream fetch failure.
  let page: FetchedPage;
  try {
    page = await fetchPublicHtml(rawUrl.trim());
  } catch (error) {
    const status = error instanceof BlockedUrlError ? 400 : 502;
    return NextResponse.json({ error: "That URL can't be fetched." }, { status });
  }

  // parseMeta resolves relative hrefs (favicon, og:image) against the URL it
  // is given — that has to be the POST-redirect URL, or an apex-to-www or
  // CDN redirect yields favicon links that 404.
  const { title, desc, favicon } = parseMeta(page.html, page.finalUrl);
  return NextResponse.json({ title, desc, favicon });
}
