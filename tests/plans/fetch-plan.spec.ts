// T36-1 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Unit coverage
// for fetchPlanForWorkspace's outcome mapping — the seller dashboard's
// consumption of GET /api/plans/[ws] (T28-11). A fake `fetchImpl` is
// injected so this never touches a live server or the demo tenant.

import { describe, expect, it, vi } from "vitest";

import { fetchPlanForWorkspace } from "@/lib/plans/fetch-plan";
import type { PlanTree } from "@/lib/plans/types";

const SAMPLE_PLAN: PlanTree = {
  id: "plan-1",
  workspace_id: "ws-1",
  title: "Sample plan",
  start_date: "2026-01-01",
  target_date: "2026-06-01",
  status: "active",
  created_at: "2026-01-01T00:00:00+00:00",
  stages: [],
};

function fakeFetch(response: Response): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

describe("fetchPlanForWorkspace", () => {
  it("returns kind:'ok' with the plan on a 200 response", async () => {
    const response = new Response(JSON.stringify({ data: SAMPLE_PLAN }), { status: 200 });
    const outcome = await fetchPlanForWorkspace("ws-1", fakeFetch(response));

    expect(outcome).toEqual({ kind: "ok", plan: SAMPLE_PLAN });
  });

  it("calls the route with a relative, cache-busting fetch", async () => {
    const response = new Response(JSON.stringify({ data: SAMPLE_PLAN }), { status: 200 });
    const fetchImpl = fakeFetch(response);
    await fetchPlanForWorkspace("ws-42", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("/api/plans/ws-42", { cache: "no-store" });
  });

  it("maps 401 to kind:'unauthenticated' — the route's explicit no-session branch", async () => {
    const response = new Response(JSON.stringify({ error: "Unauthenticated" }), { status: 401 });
    const outcome = await fetchPlanForWorkspace("ws-1", fakeFetch(response));

    expect(outcome).toEqual({ kind: "unauthenticated" });
  });

  it("maps 404 to kind:'no-plan' — the route's explicit no-live-plan branch", async () => {
    const response = new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    const outcome = await fetchPlanForWorkspace("ws-1", fakeFetch(response));

    expect(outcome).toEqual({ kind: "no-plan" });
  });

  it("maps any other non-2xx status to kind:'error' carrying that status", async () => {
    const response = new Response(JSON.stringify({ error: "UNKNOWN_ERROR" }), { status: 500 });
    const outcome = await fetchPlanForWorkspace("ws-1", fakeFetch(response));

    expect(outcome).toEqual({ kind: "error", status: 500 });
  });

  it("maps a 2xx response with an unexpected body shape to kind:'error'", async () => {
    const response = new Response(JSON.stringify({ oops: true }), { status: 200 });
    const outcome = await fetchPlanForWorkspace("ws-1", fakeFetch(response));

    expect(outcome).toEqual({ kind: "error", status: 200 });
  });

  it("maps a 2xx response with invalid JSON to kind:'error'", async () => {
    const response = new Response("not json", { status: 200 });
    const outcome = await fetchPlanForWorkspace("ws-1", fakeFetch(response));

    expect(outcome).toEqual({ kind: "error", status: 200 });
  });

  it("maps a thrown network failure to kind:'error' with status 0, never throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const outcome = await fetchPlanForWorkspace("ws-1", fetchImpl);

    expect(outcome).toEqual({ kind: "error", status: 0 });
  });
});
