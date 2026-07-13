import { NextResponse } from "next/server";
import { issueAccessToken } from "@/lib/portal-access-token";

// Thin wrapper over the same issuance logic the portal gate form action
// uses (app/portal/[id]/gate-actions.ts) -- see lib/portal-access-token.ts.
// Kept as a documented REST contract per the Technical Source of Truth API
// surface, without a second implementation of token issuance.
export async function POST(request: Request) {
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
