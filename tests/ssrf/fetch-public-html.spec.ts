// Sprint 12, Ticket 62 — spec for lib/ssrf/fetch-public-html.ts, the module
// that composes "validate, then pin, then re-validate every redirect hop".
//
// Both DNS and the socket are injected here (FetchDeps), so nothing in this
// file touches the network. What it pins is the orchestration, and above all
// the hole that motivated the whole ticket: the pre-T62 code validated the
// URL the seller typed and then called global fetch(..., redirect: "follow"),
// so a perfectly public page that answered `302 Location:
// http://169.254.169.254/latest/meta-data/` got fetched — cloud credentials
// and all — with the guard none the wiser. Every redirect hop below must go
// through the SAME validation as hop zero, and a refused hop must never be
// requested at all (not requested-then-discarded: the request itself is the
// damage).
//
// The fake resolver deliberately delegates literal IPs to the real
// isPublicAddress, so the "redirect straight to 169.254.169.254" case
// exercises the real range table rather than a test double's opinion.

import { describe, expect, it } from "vitest";
import { isIP } from "node:net";

import { BlockedUrlError } from "@/lib/ssrf/errors";
import { fetchPublicHtml, type FetchDeps } from "@/lib/ssrf/fetch-public-html";
import { isPublicAddress } from "@/lib/ssrf/ip-ranges";
import { resolvePublicAddresses, type ResolvedAddress } from "@/lib/ssrf/resolve";
import type { PinnedResponse } from "@/lib/ssrf/pinned-request";

const PUBLIC_V4: ResolvedAddress = { address: "93.184.216.34", family: 4 };
const OTHER_PUBLIC_V4: ResolvedAddress = { address: "151.101.1.69", family: 4 };
const EXPECTED_MAX_BYTES = 500_000;

interface RecordedRequest {
  readonly url: string;
  readonly address: string;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

type ResolveMap = Readonly<Record<string, readonly ResolvedAddress[] | "blocked">>;
type Responder = (url: URL) => PinnedResponse;

function ok(body: string): PinnedResponse {
  return { status: 200, location: null, body };
}

function redirect(location: string | null, status = 302): PinnedResponse {
  return { status, location, body: "" };
}

function byUrl(responses: Readonly<Record<string, PinnedResponse>>): Responder {
  return (url) => responses[url.toString()] ?? ok("<title>fallback</title>");
}

function fakeDeps(resolveMap: ResolveMap, responder: Responder) {
  const requests: RecordedRequest[] = [];
  const resolvedHosts: string[] = [];

  const deps: FetchDeps = {
    resolve: async (hostname) => {
      resolvedHosts.push(hostname);
      if (isIP(hostname)) {
        if (!isPublicAddress(hostname)) throw new BlockedUrlError("URL host is not allowed.");
        return [{ address: hostname, family: isIP(hostname) === 4 ? 4 : 6 }];
      }
      const entry = resolveMap[hostname];
      if (!entry || entry === "blocked") throw new BlockedUrlError("URL host is not allowed.");
      return entry;
    },
    request: async (url, pinned, options) => {
      requests.push({ url: url.toString(), address: pinned.address, ...options });
      return responder(url);
    },
  };

  return { deps, requests, resolvedHosts };
}

describe("fetchPublicHtml — the happy path connects to the validated address", () => {
  it("requests exactly the address the resolver returned, and reports the final URL", async () => {
    const { deps, requests } = fakeDeps(
      { "example.com": [PUBLIC_V4] },
      byUrl({ "https://example.com/page": ok("<title>Hello</title>") }),
    );

    const result = await fetchPublicHtml("https://example.com/page", deps);

    expect(result.html).toBe("<title>Hello</title>");
    expect(result.finalUrl.toString()).toBe("https://example.com/page");
    expect(requests).toHaveLength(1);
    expect(requests[0].address).toBe(PUBLIC_V4.address);
  });

  it("caps the read and shares ONE timeout budget across every hop", async () => {
    const { deps, requests } = fakeDeps(
      { "example.com": [PUBLIC_V4] },
      byUrl({ "https://example.com/": redirect("/second"), "https://example.com/second": ok("<title>Done</title>") }),
    );

    await fetchPublicHtml("https://example.com/", deps);

    expect(requests).toHaveLength(2);
    expect(requests.every((entry) => entry.maxBytes === EXPECTED_MAX_BYTES)).toBe(true);
    // The same signal instance, not a fresh 5s grant per hop — otherwise a
    // redirect chain could stall for 5s * hops.
    expect(requests[1].signal).toBe(requests[0].signal);
  });
});

describe("fetchPublicHtml — every redirect hop is re-validated", () => {
  it("refuses a redirect to a host that resolves private, and never requests that host", async () => {
    const { deps, requests, resolvedHosts } = fakeDeps(
      { "example.com": [PUBLIC_V4], "internal.example": "blocked" },
      byUrl({ "https://example.com/": redirect("https://internal.example/secret") }),
    );

    await expect(fetchPublicHtml("https://example.com/", deps)).rejects.toBeInstanceOf(BlockedUrlError);

    expect(resolvedHosts).toEqual(["example.com", "internal.example"]);
    expect(requests.map((entry) => entry.url)).toEqual(["https://example.com/"]);
  });

  it("refuses a redirect to the literal cloud metadata address", async () => {
    const { deps, requests } = fakeDeps(
      { "example.com": [PUBLIC_V4] },
      byUrl({ "https://example.com/": redirect("http://169.254.169.254/latest/meta-data/") }),
    );

    await expect(fetchPublicHtml("https://example.com/", deps)).rejects.toBeInstanceOf(BlockedUrlError);
    expect(requests).toHaveLength(1);
  });

  it.each(["file:///etc/passwd", "gopher://example.com:70/1", "javascript:alert(1)", "data:text/html,hi"])(
    "refuses a redirect to %s — only http/https survive a hop",
    async (location) => {
      const { deps, requests } = fakeDeps(
        { "example.com": [PUBLIC_V4] },
        byUrl({ "https://example.com/": redirect(location) }),
      );

      await expect(fetchPublicHtml("https://example.com/", deps)).rejects.toBeInstanceOf(BlockedUrlError);
      expect(requests).toHaveLength(1);
    },
  );

  it("resolves a relative Location against the CURRENT url, not the original one", async () => {
    const { deps, requests } = fakeDeps(
      { "example.com": [PUBLIC_V4], "cdn.example": [OTHER_PUBLIC_V4] },
      byUrl({
        "https://example.com/a/start": redirect("https://cdn.example/deep/page"),
        "https://cdn.example/deep/page": redirect("../moved?x=1"),
        "https://cdn.example/moved?x=1": ok("<title>Moved</title>"),
      }),
    );

    const result = await fetchPublicHtml("https://example.com/a/start", deps);

    expect(result.finalUrl.toString()).toBe("https://cdn.example/moved?x=1");
    expect(requests[2].address).toBe(OTHER_PUBLIC_V4.address);
  });

  it.each([301, 302, 303, 307, 308])("follows a %d the same way", async (status) => {
    const { deps } = fakeDeps(
      { "example.com": [PUBLIC_V4] },
      byUrl({ "https://example.com/": redirect("/end", status), "https://example.com/end": ok("<title>End</title>") }),
    );

    await expect(fetchPublicHtml("https://example.com/", deps)).resolves.toMatchObject({ html: "<title>End</title>" });
  });

  it("throws on a redirect with no Location header rather than looping or returning an empty body", async () => {
    const { deps } = fakeDeps({ "example.com": [PUBLIC_V4] }, byUrl({ "https://example.com/": redirect(null) }));

    await expect(fetchPublicHtml("https://example.com/", deps)).rejects.toThrow();
  });
});

describe("fetchPublicHtml — redirect depth", () => {
  const chain = byUrl({
    "https://example.com/1": redirect("/2"),
    "https://example.com/2": redirect("/3"),
    "https://example.com/3": redirect("/4"),
    "https://example.com/4": redirect("/5"),
    "https://example.com/5": ok("<title>Too deep to reach</title>"),
  });

  it("follows up to three redirects", async () => {
    const { deps, requests } = fakeDeps(
      { "example.com": [PUBLIC_V4] },
      byUrl({
        "https://example.com/1": redirect("/2"),
        "https://example.com/2": redirect("/3"),
        "https://example.com/3": redirect("/4"),
        "https://example.com/4": ok("<title>Deep</title>"),
      }),
    );

    const result = await fetchPublicHtml("https://example.com/1", deps);

    expect(result.html).toBe("<title>Deep</title>");
    expect(requests).toHaveLength(4);
  });

  it("throws on the fourth redirect and stops requesting", async () => {
    const { deps, requests } = fakeDeps({ "example.com": [PUBLIC_V4] }, chain);

    await expect(fetchPublicHtml("https://example.com/1", deps)).rejects.toThrow();
    expect(requests).toHaveLength(4);
  });
});

describe("fetchPublicHtml — input and status handling", () => {
  it.each(["not a url", "", "ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)"])(
    "refuses %j before any DNS lookup happens",
    async (rawUrl) => {
      const { deps, resolvedHosts } = fakeDeps({ "example.com": [PUBLIC_V4] }, byUrl({}));

      await expect(fetchPublicHtml(rawUrl, deps)).rejects.toBeInstanceOf(BlockedUrlError);
      expect(resolvedHosts).toEqual([]);
    },
  );

  it("throws an ordinary (non-Blocked) Error on a non-2xx status, so the route can answer 502 not 400", async () => {
    const { deps } = fakeDeps({ "example.com": [PUBLIC_V4] }, () => ({ status: 503, location: null, body: "" }));

    const error = await fetchPublicHtml("https://example.com/", deps).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BlockedUrlError);
  });

  it("lets a transport failure propagate as an ordinary Error", async () => {
    const { deps } = fakeDeps({ "example.com": [PUBLIC_V4] }, () => {
      throw new Error("socket hang up");
    });

    const error = await fetchPublicHtml("https://example.com/", deps).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BlockedUrlError);
  });
});

describe("fetchPublicHtml — one public + one private DNS record is refused outright", () => {
  it("refuses the host and never requests it, using the real resolver with an injected lookup", async () => {
    const requests: string[] = [];
    const deps: FetchDeps = {
      resolve: (hostname) =>
        resolvePublicAddresses(hostname, async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]),
      request: async (url) => {
        requests.push(url.toString());
        return ok("<title>never</title>");
      },
    };

    await expect(fetchPublicHtml("https://rebind.example/", deps)).rejects.toBeInstanceOf(BlockedUrlError);
    expect(requests).toEqual([]);
  });
});

describe("fetchPublicHtml — thrown messages are safe to surface", () => {
  it("never leaks a resolved address into the error message", async () => {
    const deps: FetchDeps = {
      resolve: (hostname) => resolvePublicAddresses(hostname, async () => [{ address: "10.1.2.3", family: 4 }]),
      request: async () => ok(""),
    };

    const error = await fetchPublicHtml("https://rebind.example/", deps).catch((caught: unknown) => caught);

    expect((error as Error).message).not.toContain("10.1.2.3");
    expect((error as Error).message).not.toContain("rebind.example");
  });
});
