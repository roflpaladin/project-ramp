import { NextResponse } from "next/server";
import { assertPublicHttpUrl } from "@/lib/ssrf-guard";
import { parseMeta } from "@/lib/meta-scrape";

const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 500_000;

// Server-side OpenGraph/HTML scraper that hydrates the seller builder form
// (Sprint 2, Ticket 12). Server-side only, to centralize SSRF controls and
// avoid CORS. Always resolves with a clean JSON body -- never throws -- so
// the client can degrade to manual entry on any failure.
export async function POST(request: Request) {
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

  let pageUrl: URL;
  try {
    pageUrl = await assertPublicHttpUrl(rawUrl.trim());
  } catch {
    return NextResponse.json({ error: "That URL can't be fetched." }, { status: 400 });
  }

  let html: string;
  try {
    const response = await fetch(pageUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!response.ok || !response.body) {
      return NextResponse.json({ error: "That URL can't be fetched." }, { status: 502 });
    }

    // Cap how much we read so a huge or slow-streaming response can't tie
    // up the request -- OG/title/description tags are always near the top
    // of <head> in practice.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    reader.cancel().catch(() => {});
    html = Buffer.concat(chunks).toString("utf-8");
  } catch {
    return NextResponse.json({ error: "That URL can't be fetched." }, { status: 502 });
  }

  const { title, desc, favicon } = parseMeta(html, pageUrl);
  return NextResponse.json({ title, desc, favicon });
}
