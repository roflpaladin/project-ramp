// T36-1 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). The seller
// dashboard's consumption of GET /api/plans/[ws] (T28-11) — that route's own
// comment already names this as its intended consumer ("Its real consumer is
// Ticket 36's dashboard poller").
//
// Deliberately does NOT touch /api/demo/pulse: that endpoint is session-less
// and scoped to the demo tenant only ("Do not widen this without an auth
// model" — its own file), so it is never a valid data source for a REAL
// seller's dashboard. This module is the other half of that separation: the
// real, authenticated path, which relies on the seller's own Supabase
// session cookie being sent automatically on a same-origin relative fetch —
// the same pattern app/demo-sandbox/live-pulse.tsx already uses against the
// session-less route.
//
// A plain function, not a React hook or a component: when to call this, how
// often to poll, and what to render for each outcome is UI behaviour and
// belongs to Ticket 36's FE row (T36-5). This file is only the typed
// request/response contract a poller (or a server-side caller) calls into.

import type { PlanTree } from "./types";

export type FetchPlanOutcome =
  | { readonly kind: "ok"; readonly plan: PlanTree }
  | { readonly kind: "no-plan" }
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "error"; readonly status: number };

interface PlanApiSuccessBody {
  readonly data: PlanTree;
}

function isPlanApiSuccessBody(value: unknown): value is PlanApiSuccessBody {
  return typeof value === "object" && value !== null && "data" in value;
}

/**
 * Fetches GET /api/plans/{workspaceId} and narrows its envelope into a
 * closed outcome union, so a caller never has to re-derive "what does a 404
 * vs a 401 mean here" from a raw Response — 401 is the route's explicit
 * "no session" branch, 404 is its explicit "no live plan for this
 * workspace" branch (T28-11), and anything else is treated as an
 * unexpected error rather than guessed at.
 *
 * `fetchImpl` is injectable so this is testable without a live server or a
 * global fetch mock leaking into other test files — the same reason
 * lib/plans/queries.ts's read paths take an injectable client.
 */
export async function fetchPlanForWorkspace(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchPlanOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/plans/${workspaceId}`, { cache: "no-store" });
  } catch {
    // Transient network failure — surfaced as a typed outcome (status 0)
    // rather than thrown, so a poller can retry on its own schedule without
    // wrapping every call in try/catch. Mirrors live-pulse.tsx's existing
    // "the next tick retries" tolerance for the same class of failure.
    return { kind: "error", status: 0 };
  }

  if (response.status === 401) return { kind: "unauthenticated" };
  if (response.status === 404) return { kind: "no-plan" };
  if (!response.ok) return { kind: "error", status: response.status };

  try {
    const body: unknown = await response.json();
    if (!isPlanApiSuccessBody(body)) {
      return { kind: "error", status: response.status };
    }
    return { kind: "ok", plan: body.data };
  } catch {
    // A 2xx response that isn't valid JSON is itself an error condition —
    // never surfaced as a plan.
    return { kind: "error", status: response.status };
  }
}
