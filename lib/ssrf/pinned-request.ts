import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

import type { ResolvedAddress } from "./resolve";

// Sprint 12, Ticket 62 — one HTTP request to ONE already-validated IP
// address, with the hostname left intact.
//
// This is the piece that makes lib/ssrf/resolve.ts's answer binding. Before
// T62 the guard resolved a hostname, approved it, and then handed the URL to
// global fetch(), which resolved the name AGAIN at connect time — so a
// domain whose DNS answer changes between the two lookups (a one-second TTL
// flipping from a public address to 169.254.169.254 — DNS rebinding) was
// checked on the good answer and connected on the bad one. undici/fetch
// exposes no hook to prevent that.
//
// node:http's `lookup` option does: the resolver below ALWAYS answers with
// the caller's pinned address, so the socket is guaranteed to land on the
// exact IP that was validated, with no second resolution anywhere.
// Everything else about the request stays honest:
//   - the hostname stays in the URL and in the Host header, so virtual
//     hosting keeps working;
//   - TLS SNI and certificate validation still use the real hostname
//     (`hostname`, not the pinned IP, is what node:https hands to TLS), so
//     pinning never weakens certificate checking. rejectUnauthorized is
//     never touched.
//
// Deliberately NOT done here:
//   - no range checking. Whether an address may be dialled is
//     lib/ssrf/resolve.ts's decision, made before this function is called.
//     Keeping that out is what lets pinned-request.spec.ts prove the pin
//     against a real loopback server.
//   - no redirect following. A 3xx is returned as data (status + location)
//     so lib/ssrf/fetch-public-html.ts can re-run the FULL validation on the
//     new URL. "Follow redirects for me" is precisely how the pre-T62 code
//     got walked to the metadata endpoint.
//   - no body beyond `maxBytes`. The socket is destroyed at the cap.

const DEFAULT_HTTP_PORT = "80";
const DEFAULT_HTTPS_PORT = "443";
// Announced to the site being scraped so an operator can identify (and
// block) us. Brava is the product's public name (CLAUDE.md).
const USER_AGENT = "BravaLinkPreview/1.0 (+https://getbrava.tech)";
const ACCEPT_HEADER = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5";

export interface PinnedResponse {
  readonly status: number;
  /** The raw `Location` header, if any — possibly relative. Resolving and
   * re-validating it belongs to the caller. */
  readonly location: string | null;
  /** UTF-8 decoding of at most `maxBytes` of the response body. */
  readonly body: string;
}

export interface PinnedRequestOptions {
  readonly signal: AbortSignal;
  readonly maxBytes: number;
}

function selectTransport(protocol: string): typeof httpRequest {
  if (protocol === "https:") return httpsRequest;
  if (protocol === "http:") return httpRequest;
  // Unreachable through fetchPublicHtml (which rejects other schemes before
  // resolving), but this module must not be the place where a gopher: or
  // file: URL quietly becomes an http request.
  throw new Error("Only http and https requests can be pinned.");
}

/** URL.hostname keeps the brackets on an IPv6 literal; node:http wants them
 * off for `hostname` (the Host header keeps them, via `url.host`). */
function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function createPinnedLookup(pinned: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    // net.connect asks with `all: true` on the happy-eyeballs path (Node's
    // default since v20) and without it otherwise — both shapes have to be
    // answered, and both answer with the same single pinned address.
    if (options.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

function buildRequestOptions(url: URL, pinned: ResolvedAddress, signal: AbortSignal): RequestOptions {
  return {
    protocol: url.protocol,
    hostname: stripBrackets(url.hostname),
    port: url.port || (url.protocol === "https:" ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT),
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: {
      host: url.host,
      accept: ACCEPT_HEADER,
      // Nothing here decompresses, and a compressed body would make the byte
      // cap meaningless as a cap on DECODED size (a zip bomb).
      "accept-encoding": "identity",
      "user-agent": USER_AGENT,
    },
    family: pinned.family,
    lookup: createPinnedLookup(pinned),
    signal,
  };
}

function readCappedBody(response: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).subarray(0, maxBytes).toString("utf-8"));
    };

    response.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received < maxBytes) return;
      // Cap reached: stop the transfer at the socket rather than reading a
      // multi-gigabyte body into memory to throw it away.
      response.destroy();
      finish();
    });
    response.on("end", finish);
    response.on("error", (error: Error) => {
      if (!settled) reject(error);
    });
  });
}

/**
 * Resolves with the response's status, `Location` header and capped body.
 * Rejects on any transport failure, including the abort signal firing — the
 * caller (lib/ssrf/fetch-public-html.ts) owns the timeout budget and the
 * status policy.
 *
 * `pinned` MUST already have been validated by lib/ssrf/resolve.ts: this
 * function dials it unconditionally.
 */
export function pinnedRequest(
  url: URL,
  pinned: ResolvedAddress,
  options: PinnedRequestOptions,
): Promise<PinnedResponse> {
  const transport = selectTransport(url.protocol);

  return new Promise<PinnedResponse>((resolve, reject) => {
    const clientRequest = transport(buildRequestOptions(url, pinned, options.signal), (response) => {
      readCappedBody(response, options.maxBytes).then(
        (body) =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location ?? null,
            body,
          }),
        reject,
      );
    });

    clientRequest.on("error", reject);
    clientRequest.end();
  });
}
