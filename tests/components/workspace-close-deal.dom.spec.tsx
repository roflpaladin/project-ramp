// Sprint 12 — founder ruling 2026-10-11: "Close deal" ALSO sits at the top of
// the deal's main page (app/admin/workspaces/[id]/page.tsx), not only at the
// bottom of the plan builder. This mounts the page's client wrapper
// (workspace-close-deal.tsx) the way page.tsx does. "components" project,
// DB-free: plan-actions.ts is mocked wholesale.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { QUIET_DEAL_LINK_LABEL } from "@/app/admin/workspaces/[id]/engagement-copy";
import * as engagementCopy from "@/app/admin/workspaces/[id]/engagement-copy";
import type { PlanStatus } from "@/lib/plans/types";

const { mockClosePlanAction } = vi.hoisted(() => ({ mockClosePlanAction: vi.fn() }));

vi.mock("@/app/admin/workspaces/[id]/plan/plan-actions", () => ({
  closePlanAction: mockClosePlanAction,
}));

const { WorkspaceCloseDeal, CLOSE_DEAL_ANCHOR_ID, WORKSPACE_TITLE_ID } = await import(
  "@/app/admin/workspaces/[id]/workspace-close-deal"
);

beforeEach(() => {
  mockClosePlanAction.mockResolvedValue({ ok: true, data: { id: "plan-1", status: "won" } });
});

afterEach(() => {
  cleanup();
  mockClosePlanAction.mockReset();
});

function renderIt(plan: { id: string; status: PlanStatus } | null) {
  return render(
    <>
      <h1 id={WORKSPACE_TITLE_ID} tabIndex={-1}>
        Acme
      </h1>
      <WorkspaceCloseDeal workspaceId="ws-1" plan={plan} />
    </>,
  );
}

describe("WorkspaceCloseDeal", () => {
  it("renders Close deal for a live plan", () => {
    renderIt({ id: "plan-1", status: "active" });
    expect(screen.getByTestId("close-deal-controls")).toBeTruthy();
    expect(screen.getByText("Close this deal")).toBeTruthy();
  });

  it("renders for a draft plan, matching the plan builder's rule (anything not closed)", () => {
    renderIt({ id: "plan-1", status: "draft" });
    expect(screen.getByTestId("close-deal-controls")).toBeTruthy();
  });

  it("renders nothing when the workspace has no plan", () => {
    const { container } = renderIt(null);
    expect(container.querySelector('[data-surface="close-deal"]')).toBeNull();
    expect(screen.queryByText("Close this deal")).toBeNull();
  });

  it.each<PlanStatus>(["won", "lost"])("renders no active button for a %s plan", (status) => {
    const { container } = renderIt({ id: "plan-1", status });
    expect(container.querySelector('[data-surface="close-deal"]')).toBeNull();
    expect(screen.queryByText("Close this deal")).toBeNull();
  });

  it("carries no Signal", () => {
    const { container } = renderIt({ id: "plan-1", status: "active" });
    expect(container.querySelector('[data-signal="true"]')).toBeNull();
    expect(container.querySelector("[data-signal]")).toBeNull();
  });

  it("exposes the anchor the stall alert's pointer links to", () => {
    const { container } = renderIt({ id: "plan-1", status: "active" });
    expect(container.querySelector(`#${CLOSE_DEAL_ANCHOR_ID}`)).toBeTruthy();
  });

  it("moves focus to the page title after a successful close", async () => {
    renderIt({ id: "plan-1", status: "active" });
    fireEvent.click(screen.getByText("Close this deal"));
    fireEvent.click(screen.getByText("Won"));
    fireEvent.click(screen.getByText("Close as won"));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(WORKSPACE_TITLE_ID)));
    expect(mockClosePlanAction).toHaveBeenCalledWith("ws-1", "plan-1", "won");
  });

  it("does not move focus when the close is refused", async () => {
    mockClosePlanAction.mockResolvedValue({ ok: false, code: "RATE_LIMITED" });
    renderIt({ id: "plan-1", status: "active" });
    fireEvent.click(screen.getByText("Close this deal"));
    fireEvent.click(screen.getByText("Lost"));
    fireEvent.click(screen.getByText("Close as lost"));
    await screen.findByRole("alert");
    expect(document.activeElement).not.toBe(document.getElementById(WORKSPACE_TITLE_ID));
  });
});

describe("quiet-deal pointer copy", () => {
  it("no longer claims the plan page is where Close deal lives", () => {
    const source = Object.values(engagementCopy).filter((value) => typeof value === "string");
    expect(source.join(" ")).not.toMatch(/plan page/i);
    expect(QUIET_DEAL_LINK_LABEL).toBe("Close this deal");
  });
});
