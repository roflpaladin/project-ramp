// Sprint 12, Ticket 67 (slice 1, founder scope amendment — Paddle overlay
// checkout). Normalises the x-vercel-ip-country request header (read
// server-side in app/pricing/page.tsx) before it can reach
// Paddle.PricePreview's address.countryCode param. Vercel sets "XX" for a
// request it can't geolocate (reserved/unknown), and the header is absent
// entirely off-Vercel (local dev, other hosts) — both cases resolve to
// null here so the caller can omit the field, letting Paddle auto-detect
// from the request IP instead. This is the one seam that sentinel is
// normalised away at: nothing downstream (the client PricingTiers
// component, Paddle itself) ever sees "XX" or any other internal
// placeholder value.
const COUNTRY_CODE_PATTERN = /^[A-Za-z]{2}$/;
const UNKNOWN_COUNTRY_SENTINEL = "XX";

export function resolveVercelCountryCode(rawHeaderValue: string | null | undefined): string | null {
  if (!rawHeaderValue) {
    return null;
  }

  const value = rawHeaderValue.trim().toUpperCase();
  if (value === UNKNOWN_COUNTRY_SENTINEL || !COUNTRY_CODE_PATTERN.test(value)) {
    return null;
  }

  return value;
}
