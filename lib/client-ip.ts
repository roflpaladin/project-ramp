import { isIP } from "node:net";

// Sprint 12, Ticket 62 — "Self-Serve Hardening Pass". The ONE place a
// rate-limit key's caller address comes from. Replaces six hand-copied
// `x-forwarded-for`-first-entry idioms (two of which had quietly drifted:
// `??` vs `||` on an empty first entry).
//
// What is and is not trustworthy (vercel.com/docs/headers/request-headers):
//   - ON Vercel the platform OVERWRITES x-forwarded-for "to prevent IP
//     spoofing", and sets x-vercel-forwarded-for to the same value. The
//     latter additionally survives a proxy placed in front of Vercel, so it
//     is the one read here. The Sprint 12 panel's "spoofable
//     X-Forwarded-For" finding therefore does not hold in production — the
//     limiter's real weakness was being per-instance
//     (lib/rate-limit-durable.ts), not its key.
//   - OFF Vercel (local dev, any other host) every forwarding header is just
//     something the client typed. It is still used, because a limiter needs
//     some key — but x-vercel-forwarded-for is ignored there, and on Vercel
//     nothing client-typed is ever used as a fallback.
//
// The result becomes part of a storage key, so it is validated as an IP
// address: anything else collapses into one shared "unknown" bucket rather
// than letting a caller mint unlimited distinct keys out of junk.

export const UNKNOWN_CLIENT_IP = "unknown";

const PLATFORM_HEADER = "x-vercel-forwarded-for";
const FALLBACK_HEADERS: readonly string[] = ["x-forwarded-for", "x-real-ip"];
// Longest textual IPv6 form (with an embedded IPv4 tail) is 45 characters.
const MAX_IP_TEXT_LENGTH = 45;

function isOnVercel(): boolean {
  return process.env.VERCEL === "1";
}

function firstValidIp(headerValue: string | null): string | null {
  const firstEntry = headerValue?.split(",")[0]?.trim();
  if (!firstEntry || firstEntry.length > MAX_IP_TEXT_LENGTH) return null;
  return isIP(firstEntry) === 0 ? null : firstEntry.toLowerCase();
}

// Every caller that lands in the "unknown" bucket shares ONE budget, so on
// the shared store a missing platform header is not a degraded key, it is a
// switch anyone can use to lock everyone out of an endpoint (security review
// H2). Vercel always sets the header, so this should never fire; if it does,
// it is a deploy misconfiguration that must be visible immediately.
let hasWarnedMissingPlatformHeader = false;

function warnMissingPlatformHeader(): void {
  if (hasWarnedMissingPlatformHeader) return;
  hasWarnedMissingPlatformHeader = true;
  console.error(
    `[client-ip] VERCEL=1 but ${PLATFORM_HEADER} is missing or invalid; callers are sharing the "unknown" rate-limit bucket.`,
  );
}

/** Test-only: re-arms the once-per-process warning above. */
export function resetClientIpWarningForTests(): void {
  hasWarnedMissingPlatformHeader = false;
}

export function clientIp(headers: Headers): string {
  if (isOnVercel()) {
    const ip = firstValidIp(headers.get(PLATFORM_HEADER));
    if (!ip) warnMissingPlatformHeader();
    return ip ?? UNKNOWN_CLIENT_IP;
  }

  for (const name of FALLBACK_HEADERS) {
    const ip = firstValidIp(headers.get(name));
    if (ip) return ip;
  }
  return UNKNOWN_CLIENT_IP;
}
