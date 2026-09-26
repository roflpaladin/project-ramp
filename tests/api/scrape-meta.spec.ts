// Sprint 12, Ticket 62 — route spec for app/api/scrape-meta/route.ts.
//
// DB-FREE, in the same spirit as tests/api/waitlist.spec.ts: the POST handler
// is imported directly and its two collaborators are mocked, because what
// this file exists to pin is the route's CONTRACT, not Supabase.
//
// The headline case is the first one. Until T62 this endpoint was
// unauthenticated — it is not covered by middleware.ts's matcher ("/",
// "/admin/:path*", "/settings/:path*") — while doing a server-side fetch of
// a caller-supplied URL and reflecting the fetched page's metadata straight
// back. That is an open proxy with our egress IP. Every legitimate caller
// (lib/use-scrape-meta-prefill.ts and app/admin/workspaces/[id]/link-url-field.tsx)
// is a signed-in seller screen under /admin, so requiring a seller costs
// nothing and closes it.
//
// The second thing pinned here is the 400-vs-502 split: a POLICY refusal
// (BlockedUrlError — private range, bad scheme, redirect off to a blocked
// host) is the caller's fault and stays a 400, exactly as before T62; a
// TRANSPORT failure stays a 502. BlockedUrlError is imported for real from
// @/lib/ssrf/errors (a separate module from the mocked one) precisely so the
// route's `instanceof` check is tested against the real class.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SCRAPE_META_RATE_LIMIT } from "@/lib/rate-limit";
import { BlockedUrlError } from "@/lib/ssrf/errors";

interface FetchedPage {
  readonly html: string;
  readonly finalUrl: URL;
}

const { sessionResult, fetchResult, fetchCalls } = vi.hoisted(() => ({
  sessionResult: { value: null as { userId: string } | null },
  fetchResult: { value: (() => {}) as unknown as (rawUrl: string) => Promise<unknown> },
  fetchCalls: [] as string[],
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: async () => sessionResult.value,
}));

const { limiterDecision, limiterCalls } = vi.hoisted(() => ({
  limiterDecision: { allowed: true },
  limiterCalls: [] as Array<{ key: string; budget: { limit: number; windowMs: number } }>,
}));

vi.mock("@/lib/rate-limit-durable", () => ({
  checkDurableRateLimit: async (key: string, budget: { limit: number; windowMs: number }) => {
    limiterCalls.push({ key, budget });
    return limiterDecision.allowed ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: 77 };
  },
}));

vi.mock("@/lib/ssrf/fetch-public-html", () => ({
  fetchPublicHtml: async (rawUrl: string) => {
    fetchCalls.push(rawUrl);
    return fetchResult.value(rawUrl);
  },
}));

const { POST } = await import("@/app/api/scrape-meta/route");

const ROUTE_URL = "http://localhost/api/scrape-meta";
const SIGNED_IN = { userId: "seller-1" };

function postJson(body: unknown): Promise<Response> {
  return POST(
    new Request(ROUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function resolveWith(page: FetchedPage): void {
  fetchResult.value = async () => page;
}

function rejectWith(error: unknown): void {
  fetchResult.value = async () => {
    throw error;
  };
}

beforeEach(() => {
  fetchCalls.length = 0;
  limiterCalls.length = 0;
  limiterDecision.allowed = true;
  sessionResult.value = SIGNED_IN;
  resolveWith({ html: "<title>Default</title>", finalUrl: new URL("https://example.com/") });
});

describe("POST /api/scrape-meta — authentication", () => {
  it("answers 401 when there is no seller session and never fetches anything", async () => {
    sessionResult.value = null;

    const response = await postJson({ url: "https://example.com" });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Sign in to continue." });
    expect(fetchCalls).toEqual([]);
  });

  it("does not fetch for a signed-out caller even when the body is perfectly valid", async () => {
    sessionResult.value = null;

    await postJson({ url: "https://ok.example/page" });

    expect(fetchCalls).toEqual([]);
  });
});

describe("POST /api/scrape-meta — request validation", () => {
  it("answers 400 on a malformed JSON body", async () => {
    const response = await postJson("not json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request body." });
    expect(fetchCalls).toEqual([]);
  });

  it.each([{}, { url: 123 }, { url: "" }, { url: "   " }, { url: null }])(
    "answers 400 for %j — url is required",
    async (body) => {
      const response = await postJson(body);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "url is required." });
      expect(fetchCalls).toEqual([]);
    },
  );
});

describe("POST /api/scrape-meta — failure mapping", () => {
  it("answers 400 for a policy refusal (BlockedUrlError)", async () => {
    rejectWith(new BlockedUrlError("URL host is not allowed."));

    const response = await postJson({ url: "http://169.254.169.254/" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "That URL can't be fetched." });
  });

  it("answers 502 for a transport failure", async () => {
    rejectWith(new Error("socket hang up"));

    const response = await postJson({ url: "https://example.com" });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "That URL can't be fetched." });
  });

  it("never echoes the underlying error message back to the caller", async () => {
    rejectWith(new Error("connect ECONNREFUSED 10.1.2.3:443"));

    const response = await postJson({ url: "https://example.com" });

    expect(JSON.stringify(await response.json())).not.toContain("10.1.2.3");
  });
});

describe("POST /api/scrape-meta — success", () => {
  it("returns the parsed title, description and favicon", async () => {
    resolveWith({
      html: `<html><head><title>Acme</title><meta name="description" content="We make anvils"><link rel="icon" href="/icon.png"></head></html>`,
      finalUrl: new URL("https://acme.example/"),
    });

    const response = await postJson({ url: "https://acme.example" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      title: "Acme",
      desc: "We make anvils",
      favicon: "https://acme.example/icon.png",
    });
  });

  it("resolves a relative favicon against the FINAL url, not the requested one", async () => {
    // A page that 301s to another host is the common case (apex -> www, or a
    // CDN). Parsing against the requested URL would hand the client a
    // favicon URL that 404s.
    resolveWith({
      html: `<html><head><title>Moved</title><link rel="icon" href="../icon.png"></head></html>`,
      finalUrl: new URL("https://cdn.acme.example/deep/page"),
    });

    const response = await postJson({ url: "https://acme.example" });

    await expect(response.json()).resolves.toMatchObject({ favicon: "https://cdn.acme.example/icon.png" });
  });

  it("passes the trimmed url straight through to the guarded fetcher", async () => {
    await postJson({ url: "  https://acme.example/page  " });

    expect(fetchCalls).toEqual(["https://acme.example/page"]);
  });
});

describe("POST /api/scrape-meta — rate limit (T62)", () => {
  it("keys the budget per signed-in seller under the scrape-meta budget", async () => {
    await postJson({ url: "https://example.com/" });

    expect(limiterCalls).toHaveLength(1);
    expect(limiterCalls[0].key).toBe("scrape-meta:seller-1");
    expect(limiterCalls[0].budget).toEqual(SCRAPE_META_RATE_LIMIT);
  });

  it("answers 429 with Retry-After when over budget, and never fetches", async () => {
    limiterDecision.allowed = false;

    const response = await postJson({ url: "https://example.com/" });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("77");
    expect(fetchCalls).toHaveLength(0);
  });

  it("does not charge the budget for a signed-out caller", async () => {
    sessionResult.value = null;

    await postJson({ url: "https://example.com/" });

    expect(limiterCalls).toHaveLength(0);
  });
});
