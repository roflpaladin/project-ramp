import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { HEALTH_RATE_LIMIT, isHealthy } from "@/lib/health";
import { checkDurableRateLimit } from "@/lib/rate-limit-durable";

// Sprint 12, Ticket 63: the uptime monitor's target (see lib/health.ts).
// Public and unauthenticated, so it answers {ok} and nothing else, and it is
// rate limited per caller IP because each call does a database read.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const { allowed, retryAfterSeconds } = await checkDurableRateLimit(
    `health:${clientIp(request.headers)}`,
    HEALTH_RATE_LIMIT,
  );
  if (!allowed) {
    return NextResponse.json(
      { ok: false },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const ok = await isHealthy();
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: NO_STORE });
}
