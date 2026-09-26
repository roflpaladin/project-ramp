// In-memory fixed-window rate limiter (Sprint 8, Ticket 39 — pulled forward
// from R7 per the planning-poker ruling: the public signup surface shipped
// with its guard, not nine weeks later in the hardening pass). Per-instance
// by construction: on a multi-instance deployment each instance keeps its own
// budget, so the effective global limit is (instances x limit).
//
// Sprint 12, Ticket 62 (R7) added the shared-store limiter,
// lib/rate-limit-durable.ts, and moved the public, unauthenticated surfaces
// onto it. This module stays for three jobs: (1) the named budgets below,
// shared by both limiters; (2) the durable limiter's fallback when its store
// cannot answer; (3) authenticated per-seller call sites, where the key is a
// user id an attacker cannot mint and the (instances x limit) slack is
// tolerable — moving those is follow-up work, not a hole.

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
// T59 checkout-reference issuance (app/pricing/checkout-actions.ts), keyed
// per signed-in seller. One call writes one billing_checkout_refs row, so
// the budget exists to bound a click-spamming (or scripted) authenticated
// caller, not to gate a normal purchase: a real seller opens checkout a
// handful of times at most.
export const CHECKOUT_REF_RATE_LIMIT: RateLimitBudget = { limit: 10, windowMs: 15 * 60_000 };
// T59 slice 2 — opening Paddle's hosted customer portal
// (app/settings/billing/actions.ts), keyed per signed-in seller. Same threat
// model and shape as CHECKOUT_REF_RATE_LIMIT above (an authenticated,
// low-write, click-triggered action; the budget bounds a click-spamming or
// scripted caller, not a real seller's normal use), so it shares that exact
// budget rather than inventing a new number with no reasoning behind it.
export const BILLING_PORTAL_RATE_LIMIT: RateLimitBudget = { limit: 10, windowMs: 15 * 60_000 };
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
// T62 buyer portal code CHECKS (app/portal/[id]/gate-actions.ts verifyAccess),
// keyed per caller IP. Looser than the send budgets because a real buyer
// mistypes, and a shared office IP may have several buyers verifying at once;
// it is the outer fence only — the inner one is durable and per
// (workspace, email): lib/portal-access-token.ts caps failed guesses across
// every code issued in a rolling hour.
export const PORTAL_VERIFY_RATE_LIMIT: RateLimitBudget = { limit: 20, windowMs: 15 * 60_000 };
// T62 (security review C2) buyer portal code checks keyed per TARGET
// (workspace + buyer email), charged atomically on the shared store before
// the code is compared. This is what bounds guessing when the attacker
// rotates IPs; the per-IP budget above only bounds one client. Ten guesses an
// hour against 1,000,000 codes is ~0.024% per day.
export const PORTAL_TARGET_VERIFY_RATE_LIMIT: RateLimitBudget = { limit: 10, windowMs: 60 * 60_000 };
// T62 /api/scrape-meta, keyed per signed-in seller. Each call makes the
// server fetch a third-party page, so the budget bounds outbound requests a
// single account can cause. The prefill hook fires once per pasted URL, so a
// seller building a workspace by hand uses a handful.
export const SCRAPE_META_RATE_LIMIT: RateLimitBudget = { limit: 30, windowMs: 15 * 60_000 };
// T62 email abuse guard (lib/email/send-guard.ts): how many transactional
// emails one tenant's activity may cause, per hour and per day. Sized well
// above honest use — inviting a buying committee of 10 across 5 deals in an
// hour is 50 — and far below what would dent the Resend quota every tenant's
// buyer access codes share.
export const TENANT_EMAIL_HOURLY_LIMIT: RateLimitBudget = { limit: 100, windowMs: 60 * 60_000 };
export const TENANT_EMAIL_DAILY_LIMIT: RateLimitBudget = { limit: 400, windowMs: 24 * 60 * 60_000 };
// T62 circuit breaker across ALL tenants and ALL transactional email: the
// last line of defence for the shared Resend quota if every per-key limit is
// somehow side-stepped at once. Sized as a RUNAWAY detector, not a fairness
// mechanism (security review C1): it must sit far above what any plausible
// number of honest-but-busy tenants produce together, because tripping it
// stops buyer access codes for EVERY tenant. At 400/tenant/day, 3,000 was
// reachable by eight self-registered accounts; 25,000 needs sixty-plus
// tenants all at their daily cap on the same day.
//
// T63 founder ruling (Sep 26): Resend stays on the FREE plan (100/day,
// 3,000/month), so the plan IS the real limit and the breaker sits under it:
// 90/day leaves headroom because our 24h window never lines up with Resend's
// day boundary, and 90 x 31 = 2,790 stays under the monthly cap. On the free
// plan the per-tenant budgets above can never bind before this one does.
// EMAIL_DAILY_LIMIT overrides it, so a plan upgrade is a Vercel env change
// (plus the redeploy any env change needs), not a code change.
export const DEFAULT_EMAIL_DAILY_LIMIT = 90;

/** Parses EMAIL_DAILY_LIMIT: a positive whole number, else the default (logged when set but invalid). */
export function resolveEmailDailyLimit(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return DEFAULT_EMAIL_DAILY_LIMIT;

  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;

  console.error(
    `[rate-limit] EMAIL_DAILY_LIMIT must be a positive whole number; using the default of ${DEFAULT_EMAIL_DAILY_LIMIT}.`,
  );
  return DEFAULT_EMAIL_DAILY_LIMIT;
}

export const GLOBAL_EMAIL_DAILY_LIMIT: RateLimitBudget = {
  limit: resolveEmailDailyLimit(process.env.EMAIL_DAILY_LIMIT),
  windowMs: 24 * 60 * 60_000,
};
// T65 password-reset requests (app/forgot-password/actions.ts). Same threat
// class as REGISTRATION_RATE_LIMIT and WAITLIST_RATE_LIMIT (public,
// unauthenticated, and each allowed call sends an email), so it carries the
// same budget. Applied twice per request under separate keys: per caller IP
// (one machine spraying many addresses) and per target email (many machines
// flooding one seller's inbox).
export const PASSWORD_RESET_RATE_LIMIT: RateLimitBudget = { limit: 5, windowMs: 15 * 60_000 };

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
