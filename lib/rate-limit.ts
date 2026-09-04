// Interim fixed-window rate limiter (Sprint 8, Ticket 39 — pulled forward
// from R7 per the planning-poker ruling: the public signup surface ships
// with its guard, not nine weeks later in the hardening pass). Deliberately
// in-memory and per-instance: on a multi-instance deployment each instance
// keeps its own budget, so the effective global limit is (instances × limit).
// That is accepted interim scope; distributed limiting is Ticket 62 (R7).

interface WindowEntry {
  readonly count: number;
  readonly windowStart: number;
}

const MS_PER_SECOND = 1000;

const windows = new Map<string, WindowEntry>();

export interface RateLimitBudget {
  readonly limit: number;
  readonly windowMs: number;
}

// Named budgets so call sites carry policy, not magic numbers.
export const REGISTRATION_RATE_LIMIT: RateLimitBudget = { limit: 5, windowMs: 15 * 60_000 };
export const SEND_TOKEN_RATE_LIMIT: RateLimitBudget = { limit: 8, windowMs: 15 * 60_000 };
// T41 onboarding actions (sample seed + manual create), keyed per seller —
// the sample seed writes ~17 service-role rows per call with no idempotency,
// so it needs a budget even though the blast radius is the seller's own tenant.
export const ONBOARDING_RATE_LIMIT: RateLimitBudget = { limit: 5, windowMs: 15 * 60_000 };
// T45 CSV deal import, keyed per seller — 3 per 15 minutes, actually
// stricter than ONBOARDING_RATE_LIMIT's 5 per 15 minutes (code review, Phase
// 2a: an identical {5, 15min} budget wasn't stricter, just relabeled). One
// call here can write up to MAX_CSV_ROWS (200) workspace+plan pairs, a much
// larger write amplifier than onboarding's single sample deal or manual
// workspace, so it earns a tighter budget of its own rather than sharing
// ONBOARDING_RATE_LIMIT's.
export const CSV_IMPORT_RATE_LIMIT: RateLimitBudget = { limit: 3, windowMs: 15 * 60_000 };
// T47 public waitlist capture, keyed per caller IP — same threat class as
// REGISTRATION_RATE_LIMIT (public, unauthenticated, write), so it carries the
// same budget rather than inventing a separate policy for no reason.
export const WAITLIST_RATE_LIMIT: RateLimitBudget = { limit: 5, windowMs: 15 * 60_000 };
// T52 code review (MEDIUM): CRM OAuth start/callback and disconnect, keyed
// per authenticated seller. Renamed from HUBSPOT_OAUTH_RATE_LIMIT (Sprint 11,
// Ticket 55) — Salesforce's OAuth start/callback/disconnect
// (app/api/integrations/salesforce/oauth/*, salesforce-actions.ts) share this
// exact budget and threat model with HubSpot's, so it earns one shared,
// provider-agnostic name rather than two identically-shaped constants. A much
// shorter window than the 15-minute budgets above — connecting/disconnecting
// a CRM is a rare, occasional action, not something a legitimate seller does
// repeatedly in a short burst, so a tight per-minute cap catches a scripted
// replay loop fast without making a genuinely stuck seller wait a quarter
// hour to retry.
export const CRM_OAUTH_RATE_LIMIT: RateLimitBudget = { limit: 10, windowMs: 60_000 };
// T48 landing-page headline impression events, keyed per caller IP — same
// public/unauthenticated/write threat class as WAITLIST_RATE_LIMIT, but
// deliberately a bit looser (10 vs 5 per 15 minutes): a waitlist signup is a
// deliberate one-time action per visitor, while an impression fires
// automatically on page load and legitimately recurs more than once per IP
// within a window (reloads, back-button navigation, multiple tabs/devices
// behind the same NAT/office IP, or a visitor loading both variants across a
// couple of retries). The event itself carries no PII and writes one tiny
// row, so the abuse cost of a slightly looser budget is low, while still
// bounding write volume from any single IP.
export const LANDING_EVENT_RATE_LIMIT: RateLimitBudget = { limit: 10, windowMs: 15 * 60_000 };
// T53 HubSpot deal import, keyed per seller (list and import calls each get
// their own counter under this same budget — see hubspot-import-actions.ts).
// Looser than CSV_IMPORT_RATE_LIMIT's 3 per 15 minutes: a CRM import
// call writes one workspace+plan pair per deal the seller explicitly
// selected from the picker, not an arbitrary-sized CSV batch (up to
// MAX_CSV_ROWS = 200 rows) — its typical write amplification per call is
// smaller. It is still the same write-amplifying class of action (unbounded
// by this budget alone, since the picker's own selection size is the real
// cap), so it earns its own budget rather than sharing
// ONBOARDING_RATE_LIMIT's 5. Renamed from HUBSPOT_IMPORT_RATE_LIMIT (Sprint
// 11, Ticket 56) — same-budget-different-key semantics as T55's
// CRM_OAUTH_RATE_LIMIT rename: salesforce-import-actions.ts's list/import
// pair shares this exact budget and threat model with HubSpot's own, so both
// providers earn one shared, provider-agnostic name rather than two
// identically-shaped constants.
export const CRM_IMPORT_RATE_LIMIT: RateLimitBudget = { limit: 5, windowMs: 15 * 60_000 };

export interface RateLimitResult {
  readonly allowed: boolean;
  /** 0 when allowed; otherwise whole seconds until the window reopens. */
  readonly retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = windows.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    windows.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count < limit) {
    windows.set(key, { count: entry.count + 1, windowStart: entry.windowStart });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.ceil((entry.windowStart + windowMs - now) / MS_PER_SECOND);
  return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
}

/** Test-only: clears all windows so specs are order-independent. */
export function resetRateLimiterForTests(): void {
  windows.clear();
}
