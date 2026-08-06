import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// Server-side fetches of seller-pasted URLs (Sprint 2, Ticket 12) need an
// SSRF guard: block private/loopback/link-local ranges and the cloud
// metadata address, both by literal IP and by resolving the hostname
// (defends against DNS rebinding -- a public-looking hostname that
// resolves to a private address).

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // includes the 169.254.169.254 cloud metadata endpoint
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local, fc00::/7
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isIP(mapped) === 4) return isPrivateIPv4(mapped);
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // unrecognizable -- treat conservatively
}

// Throws if `value` isn't a fetchable public http(s) URL; otherwise returns
// the parsed URL.
export async function assertPublicHttpUrl(value: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Not a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL scheme must be http or https.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("URL host is not allowed.");
  }

  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("URL host is not allowed.");
    }
    return parsed;
  }

  const { address } = await lookup(hostname);
  if (isPrivateIp(address)) {
    throw new Error("URL host is not allowed.");
  }

  return parsed;
}

// T32-1 (Sprint 6, Ticket 32; plans/sprint-6-7-replan.md §6). A thin,
// additive wrapper -- NOT a replacement for assertPublicHttpUrl above, which
// intentionally permits http: because /api/scrape-meta depends on that.
// This one is for seller-controlled URLs that are stored and later rendered
// as a raw, clickable href (workspaces.chat_url / internal_chat_url) rather
// than fetched server-side, so there's no SSRF surface to guard here (no
// hostname/DNS resolution needed): the risk is scheme-based, a stored
// `javascript:`/`data:`/`vbscript:` URL executing in the buyer's browser.
// https:-only rather than http+https, because unlike assertPublicHttpUrl
// nothing here depends on http: working.
//
// Deliberately synchronous and pure (no I/O) so it stays a trivially
// unit-testable throwing function for the T32-5 scheme-rejection tests.
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
