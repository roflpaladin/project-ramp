// Sprint 12, Ticket 62 — integration spec for lib/ssrf/pinned-request.ts,
// against a REAL loopback http server, with no mocks anywhere.
//
// The single most important assertion in this file is the one that looks
// least like a security test: every request below is made to
// `http://pin-test.invalid:<port>/`, and `.invalid` is the RFC 2606 TLD that
// is guaranteed never to resolve. If the pin were not honoured — if anything
// in the stack did its own DNS lookup — every one of these tests would fail
// with ENOTFOUND. Passing IS the proof that the socket went to exactly the
// address that was validated, which is the whole point: it closes the
// DNS-rebinding TOCTOU window that the old assertPublicHttpUrl + global
// fetch() pair left wide open.
//
// The second assertion that matters: the Host header the server actually
// receives is `pin-test.invalid:<port>`, not `127.0.0.1:<port>`. Pinning must
// change only which IP the socket dials — the hostname has to survive intact
// for virtual hosting, TLS SNI and certificate validation.
//
// Loopback is exactly the right fixture here BECAUSE pinnedRequest performs
// no range checking of its own (that is resolvePublicAddresses' job, one
// layer up). See the module header.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { pinnedRequest } from "@/lib/ssrf/pinned-request";

const MAX_BYTES = 500_000;
const LOOPBACK = { address: "127.0.0.1", family: 4 } as const;
const BIG_BODY_BYTES = 40_000;
const SMALL_CAP_BYTES = 1000;
const ABORT_AFTER_MS = 150;
const REQUEST_BUDGET_MS = 5000;

const seenRequests: { url: string; host: string | undefined }[] = [];
let server: Server;
let port = 0;
/** The /never handler's response, kept so afterAll can release the socket. */
let danglingResponse: ServerResponse | null = null;

function handle(request: IncomingMessage, response: ServerResponse): void {
  seenRequests.push({ url: request.url ?? "", host: request.headers.host });

  if (request.url === "/big") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("x".repeat(BIG_BODY_BYTES));
    return;
  }
  if (request.url === "/never") {
    response.writeHead(200, { "content-type": "text/html" });
    response.write("<html>");
    danglingResponse = response;
    return;
  }
  if (request.url === "/redirect") {
    response.writeHead(302, { location: "/target" });
    response.end();
    return;
  }
  if (request.url === "/missing") {
    response.writeHead(404, { "content-type": "text/html" });
    response.end("nope");
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<html><head><title>Pinned</title></head></html>");
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  danglingResponse?.end();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

function pinnedUrl(path: string): URL {
  return new URL(`http://pin-test.invalid:${port}${path}`);
}

function requestPinned(path: string, maxBytes = MAX_BYTES, signal = AbortSignal.timeout(REQUEST_BUDGET_MS)) {
  return pinnedRequest(pinnedUrl(path), LOOPBACK, { signal, maxBytes });
}

describe("pinnedRequest — the pin is what the socket dials", () => {
  it("reaches the loopback server through a hostname that can never resolve", async () => {
    const response = await requestPinned("/");

    expect(response.status).toBe(200);
    expect(response.body).toContain("<title>Pinned</title>");
    expect(response.location).toBeNull();
  });

  it("leaves the real hostname in the Host header, so virtual hosting and TLS SNI still work", async () => {
    seenRequests.length = 0;
    await requestPinned("/");

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0].host).toBe(`pin-test.invalid:${port}`);
  });
});

describe("pinnedRequest — response limits", () => {
  it("truncates the body at maxBytes instead of reading an unbounded response", async () => {
    const response = await requestPinned("/big", SMALL_CAP_BYTES);

    expect(response.status).toBe(200);
    expect(response.body.length).toBe(SMALL_CAP_BYTES);
  });

  it("reads a small body whole when it is under the cap", async () => {
    const response = await requestPinned("/big", MAX_BYTES);

    expect(response.body.length).toBe(BIG_BODY_BYTES);
  });

  it("rejects when the abort signal fires on a response that never ends", async () => {
    await expect(requestPinned("/never", MAX_BYTES, AbortSignal.timeout(ABORT_AFTER_MS))).rejects.toThrow();
  });
});

describe("pinnedRequest — redirects are surfaced, never followed", () => {
  it("returns the 302 and its Location without requesting the target", async () => {
    seenRequests.length = 0;
    const response = await requestPinned("/redirect");

    expect(response.status).toBe(302);
    expect(response.location).toBe("/target");
    expect(seenRequests.map((entry) => entry.url)).toEqual(["/redirect"]);
  });

  it("returns a non-2xx status as data rather than throwing — status policy belongs to the caller", async () => {
    const response = await requestPinned("/missing");

    expect(response.status).toBe(404);
    expect(response.body).toBe("nope");
  });
});
