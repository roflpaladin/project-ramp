import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { BlockedUrlError } from "./errors";
import { isPublicAddress } from "./ip-ranges";

// Sprint 12, Ticket 62 — hostname -> the set of addresses we are willing to
// dial, or a refusal. This is the DNS half of the SSRF guard; the pinning
// half (lib/ssrf/pinned-request.ts) is what makes the answer mean anything.
//
// Three deliberate differences from the pre-T62 lib/ssrf-guard.ts:
//
// 1. `{ all: true }`. The old code called dns.lookup() with no options and
//    judged the FIRST address only. An attacker-controlled domain that
//    answers with one public A record and one private A record passed that
//    check, and then the OS was free to pick the private one when fetch()
//    re-resolved. Here, ONE non-public record refuses the whole answer —
//    there is no legitimate site that needs a 127.0.0.1 record alongside its
//    real one, so "poison the whole answer" costs nothing and removes the
//    entire multi-record rebinding class.
//
// 2. The addresses are RETURNED, not thrown away. The old guard validated a
//    hostname and handed back only the URL, so the caller's fetch() did a
//    SECOND, unvalidated resolution — the textbook DNS-rebinding TOCTOU
//    window (validate the good answer, connect to the bad one). Callers now
//    pin one of these exact addresses to the socket.
//
// 3. The lookup is injectable, so the policy above is unit-testable without
//    a network or a cooperating attacker-controlled domain.
//
// Every refusal is a BlockedUrlError (a 400 at the route boundary, not a
// 502) with a fixed message that names neither the host nor the address.

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Shape of `dns.promises.lookup(hostname, { all: true })`. `family` is
 * `number` rather than `4 | 6` because it is external data — the address
 * itself is what gets re-derived and trusted below. */
export type LookupAllFn = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

const HOST_NOT_ALLOWED = "URL host is not allowed.";
const HOST_NOT_RESOLVED = "URL host could not be resolved.";
const LOCALHOST = "localhost";
const LOCALHOST_SUFFIX = ".localhost";

const defaultLookupAll: LookupAllFn = (hostname) => lookup(hostname, { all: true });

/** URL.hostname keeps the brackets on an IPv6 literal (`[::1]`); isIP does
 * not accept them. */
function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/** Re-derives the family from the address rather than trusting the record's
 * own `family` field, and refuses anything outside the public ranges. */
function toPublicAddress(address: string): ResolvedAddress {
  const version = isIP(address);
  if ((version !== 4 && version !== 6) || !isPublicAddress(address)) {
    throw new BlockedUrlError(HOST_NOT_ALLOWED);
  }
  return { address, family: version };
}

async function lookupOrRefuse(hostname: string, lookupAll: LookupAllFn): Promise<readonly { address: string; family: number }[]> {
  try {
    return await lookupAll(hostname);
  } catch (error) {
    // A host that cannot be resolved is not a transport failure we should
    // report as a 502 — it is an unusable URL (the pre-T62 behaviour of
    // /api/scrape-meta, preserved). The real DNS error is kept as `cause`
    // for server-side logging rather than swallowed.
    throw new BlockedUrlError(HOST_NOT_RESOLVED, { cause: error });
  }
}

/**
 * Returns every address `hostname` resolves to, in resolver order, once ALL
 * of them have been confirmed public. Throws BlockedUrlError if the hostname
 * is in the localhost family, is a non-public literal, resolves to nothing,
 * or resolves to even one non-public address.
 *
 * A literal IP hostname skips DNS entirely (there is nothing to resolve, and
 * calling a resolver on it would only add a failure mode).
 */
export async function resolvePublicAddresses(
  hostname: string,
  lookupAll: LookupAllFn = defaultLookupAll,
): Promise<readonly ResolvedAddress[]> {
  const host = stripBrackets(hostname.trim().toLowerCase());
  if (!host) throw new BlockedUrlError(HOST_NOT_ALLOWED);
  if (host === LOCALHOST || host.endsWith(LOCALHOST_SUFFIX)) throw new BlockedUrlError(HOST_NOT_ALLOWED);

  if (isIP(host)) return [toPublicAddress(host)];

  const records = await lookupOrRefuse(host, lookupAll);
  if (records.length === 0) throw new BlockedUrlError(HOST_NOT_RESOLVED);

  return records.map((record) => toPublicAddress(record.address));
}
