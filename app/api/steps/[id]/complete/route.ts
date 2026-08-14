import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { mapPostgrestError } from "@/lib/plans/errors";
import { completeStepAsBuyer, isPostgrestErrorLike, resolveStepWorkspace } from "@/lib/plans/complete-step";
import { toBuyerStep } from "@/lib/portal-payload";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";
import { createAdminClient } from "@/lib/supabase/admin";

// T35-1..T35-4 (Sprint 7, Ticket 35; plans/sprint-6-7-replan.md §7). Buyer
// step-completion endpoint.

/**
 * T35-11: every failure path in POST() below funnels through here so a
 * genuine Postgres error (a constraint violation, a transient outage,
 * anything) -- no matter which guard or call it comes from -- always
 * surfaces as clean 4xx/5xx JSON, never the raw Postgres message, `details`,
 * or a stack trace.
 */
function errorResponse(error: unknown, stepId: string): NextResponse {
  const mapped = isPostgrestErrorLike(error) ? mapPostgrestError(error) : null;
  console.error("[steps/complete] failed:", {
    stepId,
    code: mapped?.code ?? "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json({ error: mapped?.code ?? "UNKNOWN_ERROR" }, { status: mapped?.status ?? 500 });
}

// T35-1: THE HANDLER NEVER READS THE REQUEST BODY -- not parsed, not
// destructured, nothing. `request` below is used only for its headers (to
// tell "zero cookies at all" apart from "some cookie, just not this one" --
// see the 401-vs-404 branch), never its body. completed_by_email comes from
// the verified portal session; completed_at is generated server-side inside
// completeStepAsBuyer(). A spoofed owner_side or completed_by_email in a POST
// body is therefore impossible BY CONSTRUCTION, not merely defended against.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: stepId } = await params;
  const admin = createAdminClient();

  // Everything below can reach Postgres, so it all runs under one try/catch
  // funnelling into errorResponse() above -- a resolveStepWorkspace() failure
  // (e.g. a transient outage) must get the same clean-JSON treatment as a
  // completeStepAsBuyer() constraint violation, not an unhandled rejection
  // that Next.js's default error page would render instead.
  try {
    // T35-2 -- READ THIS BEFORE TOUCHING THE ORDER BELOW: the workspace is
    // resolved FROM THE STEP (step -> stage -> plan -> workspace) FIRST, and
    // only its result picks which single cookie name gets read next. A
    // handler that instead scanned the request for any cookie matching
    // /^portal_session_/ and asked "does ONE of these name a workspace this
    // step belongs to?" would pass every status-code assertion below while
    // trusting whichever workspace the CALLER's cookie jar happened to name,
    // not one derived from the resource being acted on. Swapping these two
    // lines is the whole bug. (T35-10: human-reviewed by eye -- automated
    // tests cannot confirm an ordering by themselves.)
    const step = await resolveStepWorkspace(stepId, admin);
    if (!step) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const cookieStore = await cookies();
    const rawSessionCookie = cookieStore.get(portalCookieName(step.workspaceId))?.value;
    const session = verifyPortalSessionValue(step.workspaceId, rawSessionCookie);

    if (!session) {
      // Two distinct "no valid session for THIS step's workspace" causes,
      // deliberately mapped to two different status codes:
      //
      //  - a cookie NAMED for exactly this workspace was present but failed
      //    verification (tampered / expired), OR the request carried no
      //    cookies at all (fully anonymous) -> 401.
      //  - the request carried at least one cookie, but not one that
      //    verifies for THIS workspace (e.g. a valid session for a DIFFERENT
      //    workspace) -> 404, never 403. A 403 here would confirm "this step
      //    exists, you just aren't allowed it" -- the exact enumeration
      //    oracle the no-enumeration-oracle rule already bars for /portal
      //    and /view.
      //
      // The second branch is a coarse PRESENCE check (is the cookie jar
      // non-empty at all?), never a scan of cookie NAMES or VALUES for the
      // portal_session_* pattern -- see the T35-2 comment above for why that
      // distinction matters.
      const attemptedThisWorkspace = rawSessionCookie !== undefined;
      const carriedAnyCookieAtAll = request.headers.get("cookie") !== null;
      const status = attemptedThisWorkspace || !carriedAnyCookieAtAll ? 401 : 404;
      return NextResponse.json(
        { error: status === 401 ? "Unauthenticated" : "Not found" },
        { status },
      );
    }

    // T35-5: this comparison is the ONLY place ownership is enforced. 0005's
    // owner_side CHECK bounds the column's VALUE DOMAIN ('seller' | 'buyer'),
    // nothing more -- Postgres has no notion of who "the buyer" on a given
    // session is, because buyers hold no Supabase Auth session at all. Zero
    // side effects on rejection: nothing has been written yet at this point.
    if (step.ownerSide !== "buyer") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const outcome = await completeStepAsBuyer(stepId, session.email, admin);

    if (outcome.kind === "blocked") {
      // T35-3 decision (plans/sprint-6-7-replan.md §1): a blocked step is an
      // explicit rejection, never the "already handled" 200 branch below.
      // 409 Conflict, chosen over 422 Unprocessable Entity because the
      // failure is about the STEP'S SERVER-SIDE STATE colliding with the
      // request, not about anything malformed in the request itself -- there
      // is no request body to be malformed (T35-1).
      return NextResponse.json({ error: "Step is blocked" }, { status: 409 });
    }

    if (outcome.kind === "unexpected") {
      // Defensive only -- see completeStepAsBuyer's comment on this branch.
      // Never leaks the raw status value or any Postgres detail.
      return NextResponse.json({ error: "Unexpected step state" }, { status: 500 });
    }

    // "completed" and "already-done" both return 200 with the row: the
    // sprint plan's recorded default for replaying an already-completed step
    // is an idempotent no-op, not an error.
    if (outcome.kind === "completed") {
      // T35-4: the analytics row is written ONLY on a genuine "completed"
      // transition -- exactly once, never on a replay -- and only after
      // every guard above has passed. Service-role client, matching
      // /api/track's pattern.
      const { error: analyticsError } = await admin.from("workspace_analytics").insert({
        workspace_id: step.workspaceId,
        step_id: stepId,
        buyer_email: session.email,
        action_type: "step_complete",
      });
      if (analyticsError) {
        // The step write already succeeded and is never rolled back for an
        // analytics failure -- analytics is observability, not the source of
        // truth for completion. Logged with full context server-side; never
        // surfaced to the buyer as an error about a request that, from their
        // point of view, actually succeeded.
        console.error("[steps/complete] step_complete analytics insert failed:", {
          stepId,
          workspaceId: step.workspaceId,
          message: analyticsError.message,
        });
      }
    }

    // Buyer-safe response, reusing the SAME allowlist toBuyerPayload uses
    // (lib/portal-payload.ts) -- this is the one other place a plan step is
    // ever serialized back to a buyer, and private_note is exactly as
    // seller-private here as it is on the page payload (T35-4: "return the
    // updated step" means the buyer-safe shape, not the raw row).
    return NextResponse.json(
      { data: toBuyerStep(outcome.step) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, stepId);
  }
}
