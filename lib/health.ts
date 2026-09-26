import "server-only";

import type { RateLimitBudget } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

// Sprint 12, Ticket 63 — "Prod readiness". The check behind GET /api/health,
// which the uptime monitor polls. It answers one question — can this
// deployment serve a seller and a buyer right now? — so it checks the env
// vars the core product cannot run without, then one cheap database read.
// The reasons go to the server log only: the endpoint is public, so the
// response never names a var, a table or an error.
//
// Deliberately NOT required: the CRM integration credentials (HubSpot,
// Salesforce, CRM_WEBHOOK_SECRET) and optional tuning (EMAIL_DAILY_LIMIT,
// SALESFORCE_LOGIN_BASE_URL). A missing integration degrades one feature;
// it must not page anyone as "site down".
export const REQUIRED_PROD_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PORTAL_SESSION_SECRET",
  "APP_ENCRYPTION_KEY",
  "NEXT_PUBLIC_APP_URL",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "NEXT_PUBLIC_PADDLE_ENV",
  "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN",
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
] as const;

// Per caller IP. A monitor polling every minute uses 5 of these per window;
// the rest is room for a person checking by hand. Kept here rather than in
// lib/rate-limit.ts because nothing else shares it.
export const HEALTH_RATE_LIMIT: RateLimitBudget = { limit: 20, windowMs: 5 * 60_000 };

// A read slower than this counts as down: the monitor's own timeout is
// longer, so a hung database reports 503 instead of a monitor timeout.
const DATABASE_CHECK_TIMEOUT_MS = 5_000;
// Any small table the service role can read. `tenants` exists from 0001.
const DATABASE_CHECK_TABLE = "tenants";

function missingRequiredEnv(): readonly string[] {
  return REQUIRED_PROD_ENV.filter((name) => !process.env[name]?.trim());
}

async function isDatabaseReachable(): Promise<boolean> {
  try {
    const { error } = await createAdminClient()
      .from(DATABASE_CHECK_TABLE)
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(DATABASE_CHECK_TIMEOUT_MS));
    if (!error) return true;
    // The code only: a message can carry hostnames or connection details.
    console.error("[health] database check failed:", error.code ?? "no code");
    return false;
  } catch (error: unknown) {
    console.error("[health] database check threw:", error instanceof Error ? error.name : "unknown");
    return false;
  }
}

export async function isHealthy(): Promise<boolean> {
  const missing = missingRequiredEnv();
  if (missing.length > 0) {
    // Names only, never values.
    console.error("[health] missing required env vars:", missing.join(", "));
    return false;
  }
  return isDatabaseReachable();
}
