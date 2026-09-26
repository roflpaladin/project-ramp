import "server-only";

import {
  GLOBAL_EMAIL_DAILY_LIMIT,
  TENANT_EMAIL_DAILY_LIMIT,
  TENANT_EMAIL_HOURLY_LIMIT,
  type RateLimitBudget,
} from "@/lib/rate-limit";
import { checkDurableRateLimit } from "@/lib/rate-limit-durable";

// Sprint 12, Ticket 62 — "Self-Serve Hardening Pass". The ticket's "abuse
// guard caps email sending per tenant".
//
// Why: every transactional email (buyer access codes and seller invites
// today; password resets once T65 merges and its sender is wired in)
// leaves through ONE Resend account and ONE sending domain
// (lib/email/resend-transport.ts). Before this, nothing bounded how much of
// that a single tenant's activity could consume: the per-(workspace, email)
// cooldown and the per-workspace invite cap are both per WORKSPACE, so a
// tenant with N workspaces got N times the allowance. A spent quota — or a
// domain throttled for spam complaints — silently stops buyer access codes
// for EVERY tenant, because the transport fails soft.
//
// How: three budgets on the shared-store limiter (lib/rate-limit-durable.ts),
// so there is no table of its own — per tenant per hour, per tenant per day,
// and one global daily circuit breaker. Call it immediately before a send; a
// refusal means "do not send". Budgets are charged in order and charging
// stops at the first refusal, so a refused tenant does not also eat into the
// global budget.
//
// A reservation is not refunded if the send then fails: a failing provider is
// exactly when retries pile up, and counting attempts rather than deliveries
// is what keeps that bounded.

export type EmailSendRefusal = "tenant_hourly" | "tenant_daily" | "global_daily";

export type EmailSendReservation =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: EmailSendRefusal };

export interface EmailSendContext {
  /** The tenant whose activity causes this email, or `null` when nobody's does (e.g. a password reset). */
  readonly tenantId: string | null;
}

interface BudgetCheck {
  readonly key: string;
  readonly budget: RateLimitBudget;
  readonly reason: EmailSendRefusal;
}

const GLOBAL_CHECK: BudgetCheck = {
  key: "email-send:global-day",
  budget: GLOBAL_EMAIL_DAILY_LIMIT,
  reason: "global_daily",
};

function checksFor(tenantId: string | null): readonly BudgetCheck[] {
  if (!tenantId) return [GLOBAL_CHECK];
  return [
    { key: `email-send:tenant-hour:${tenantId}`, budget: TENANT_EMAIL_HOURLY_LIMIT, reason: "tenant_hourly" },
    { key: `email-send:tenant-day:${tenantId}`, budget: TENANT_EMAIL_DAILY_LIMIT, reason: "tenant_daily" },
    GLOBAL_CHECK,
  ];
}

export async function reserveEmailSend({ tenantId }: EmailSendContext): Promise<EmailSendReservation> {
  for (const { key, budget, reason } of checksFor(tenantId)) {
    const { allowed } = await checkDurableRateLimit(key, budget);
    if (!allowed) {
      // A tenant id is not personal data and is what an operator needs here.
      console.error("[email-send-guard] send refused:", reason, tenantId ?? "no tenant");
      return { allowed: false, reason };
    }
  }
  return { allowed: true };
}
