// Sprint 12, Ticket 65 — "Password Reset Flow". The base address a
// password-reset link is built on. That link carries a one-time sign-in
// token to an inbox, so a poisoned origin is an account takeover: the victim
// clicks a link WE sent and hands the token to someone else's site.
//
// Stricter than app/admin/workspaces/[id]/invite-actions.ts's buildPortalUrl
// (which may fall back to forwarded headers on any deployment): here request
// headers are trusted in local development only. In production the origin
// comes from deploy configuration, the platform-set preview address, or the
// fixed production address — never from anything a caller can send.

// WITH www: the bare domain 308-redirects to www (Sprint 12 plan note).
// getbrava.tech is the only domain we own — never .io.
const PRODUCTION_ORIGIN = "https://www.getbrava.tech";
const LOCAL_FALLBACK_HOST = "localhost:3000";

function parseHttpOrigin(candidate: string | undefined | null): string | null {
  const trimmed = candidate?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function previewOrigin(): string | null {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const host = process.env.VERCEL_URL?.trim();
  return host ? parseHttpOrigin(`https://${host}`) : null;
}

function headerDerivedOrigin(headerList: Headers): string | null {
  const fromOrigin = parseHttpOrigin(headerList.get("origin"));
  if (fromOrigin) return fromOrigin;

  const host = headerList.get("host") ?? LOCAL_FALLBACK_HOST;
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return parseHttpOrigin(`${protocol}://${host}`);
}

export function resolveAppOrigin(headerList: Headers): string {
  const configured = parseHttpOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    return previewOrigin() ?? PRODUCTION_ORIGIN;
  }

  return headerDerivedOrigin(headerList) ?? PRODUCTION_ORIGIN;
}
