import { NextResponse } from "next/server";
import { issueAccessToken } from "@/lib/portal-access-token";
import { clientIp } from "@/lib/client-ip";
import { SEND_TOKEN_RATE_LIMIT } from "@/lib/rate-limit";
import { checkDurableRateLimit } from "@/lib/rate-limit-durable";

// Thin wrapper over the same issuance logic the portal gate form action
// uses (app/portal/[id]/gate-actions.ts) -- see lib/portal-access-token.ts.
// Kept as a documented REST contract per the Technical Source of Truth API
// surface, without a second implementation of token issuance.
//
// Rate limit: keyed by caller IP (lib/client-ip.ts), layered on top of
// issueAccessToken's own per-(workspace, email) resend cooldown. Interim and
// in-memory from Sprint 8, Ticket 39; on the shared store since Sprint 12,
// Ticket 62 (lib/rate-limit-durable.ts), so the budget holds across
// serverless instances.
export async function POST(request: Request) {
  const { allowed, retryAfterSeconds } = await checkDurableRateLimit(
    `send-token:${clientIp(request.headers)}`,
    SEND_TOKEN_RATE_LIMIT,
  );
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const { email, workspaceId } = (body ?? {}) as { email?: unknown; workspaceId?: unknown };

  if (typeof email !== "string" || typeof workspaceId !== "string" || !email.trim() || !workspaceId.trim()) {
    return NextResponse.json({ ok: false, error: "email and workspaceId are required." }, { status: 400 });
  }

  // issueAccessToken silently no-ops for an unknown workspace, an unapproved
  // email, or an active resend cooldown -- always return the same uniform
  // response so the caller can't enumerate the approved-email whitelist.
  await issueAccessToken(workspaceId.trim(), email.trim().toLowerCase());

  return NextResponse.json({ ok: true });
}
