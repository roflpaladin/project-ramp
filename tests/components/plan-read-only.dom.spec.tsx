// Sprint 12, Ticket 60 — a closed deal's plan is READ-ONLY.
//
// Two halves, both under the "components" Vitest project (happy-dom):
//   1. PlanBuilder with isReadOnly — every edit/add/reorder/delete control is
//      gone, the outcome badge and the plan's content are not.
//   2. app/admin/workspaces/[id]/plan/page.tsx itself, rendered as an async
//      Server Component (the `render(await Page(...))` precedent from
//      billing-page.dom.spec.tsx) — the `live ?? closed` fallback, the
//      one-line note, and the plain way to start a new plan.
//
// Hiding buttons is NOT the boundary and this file does not pretend it is:
// lib/plans/closed-plans.ts's ensurePlanIsOpen refuses every mutation
// server-side, and tests/plans/closed-plan-actions.spec.ts covers that. This
// file only asserts the seller is never shown a control that cannot work.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import type { PlanStage, PlanStepRow, PlanStatus, SuccessPlanRow } from "@/lib/plans/types";

const { mockGetPlanForSeller, mockGetClosedPlanForSeller } = vi.hoisted(() => ({
  mockGetPlanForSeller: vi.fn(),
  mockGetClosedPlanForSeller: vi.fn(),
}));

vi.mock("@/lib/plans/queries", () => ({
  getPlanForSeller: mockGetPlanForSeller,
  getClosedPlanForSeller: mockGetClosedPlanForSeller,
}));

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

const { mockNotFound } = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mockNotFound }));

const { PlanBuilder } = await import("@/app/admin/workspaces/[id]/plan/plan-builder");
const { default: PlanBuilderPage } = await import("@/app/admin/workspaces/[id]/plan/page");

const WORKSPACE_ID = "ws-1";
const COMPANY_NAME = "Meridian Retail Group";

function makeStep(overrides: Partial<PlanStepRow> & Pick<PlanStepRow, "id" | "label">): PlanStepRow {
  return {
    stage_id: "stage-1",
    owner_side: "seller",
    owner_name: null,
    owner_email: null,
    due_date: null,
    status: "open",
    display_order: 0,
    completed_at: null,
    completed_by_email: null,
    private_note: null,
    ...overrides,
  };
}

function makePlan(status: PlanStatus): SuccessPlanRow {
  return {
    id: "plan-1",
    workspace_id: WORKSPACE_ID,
    title: "Onboarding plan",
    start_date: null,
    target_date: null,
    status,
    created_at: "2026-01-01T00:00:00+00:00",
  };
}

const STAGES: PlanStage[] = [
  {
    id: "stage-1",
    plan_id: "plan-1",
    title: "Kickoff",
    display_order: 0,
    status: "current",
    steps: [
      makeStep({ id: "step-1", label: "Send contract", status: "done" }),
      makeStep({ id: "step-2", label: "Schedule kickoff call", status: "open" }),
    ],
  },
  {
    id: "stage-2",
    plan_id: "plan-1",
    title: "Rollout",
    display_order: 1,
    status: "upcoming",
    steps: [makeStep({ id: "step-3", label: "Train the team", status: "open" })],
  },
];

/** The minimal PostgREST chain plan/page.tsx uses for its workspace lookup. */
function stubWorkspaceClient(workspace: { id: string; target_company_name: string } | null) {
  mockCreateClient.mockResolvedValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: workspace, error: null }),
        }),
      }),
    }),
  });
}

function renderPage() {
  return PlanBuilderPage({ params: Promise.resolve({ id: WORKSPACE_ID }) });
}

afterEach(() => {
  cleanup();
  mockGetPlanForSeller.mockReset();
  mockGetClosedPlanForSeller.mockReset();
  mockCreateClient.mockReset();
  mockNotFound.mockClear();
});

describe("PlanBuilder — read-only rendering", () => {
  it("hides every edit, delete, reorder and add control", () => {
    // Arrange / Act
    render(<PlanBuilder workspaceId={WORKSPACE_ID} plan={makePlan("won")} initialStages={STAGES} isReadOnly />);

    // Assert
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete stage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save plan details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add stage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add step" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Reorder / })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("still shows the plan, its outcome badge, and everything the seller built", () => {
    render(<PlanBuilder workspaceId={WORKSPACE_ID} plan={makePlan("won")} initialStages={STAGES} isReadOnly />);

    expect(screen.getByRole("heading", { name: "Onboarding plan" })).toBeInTheDocument();
    expect(screen.getByText("Won")).toBeInTheDocument();
    expect(screen.getByText("Send contract")).toBeInTheDocument();
    expect(screen.getByText("Train the team")).toBeInTheDocument();
  });

  it("shows 'Lost' for a lost deal, still as dot + text rather than colour alone", () => {
    const { container } = render(
      <PlanBuilder workspaceId={WORKSPACE_ID} plan={makePlan("lost")} initialStages={STAGES} isReadOnly />,
    );

    expect(screen.getByText("Lost")).toBeInTheDocument();
    expect(container.querySelector('.plan-status-badge[data-tone="risk"]')).not.toBeNull();
  });

  it("offers no way to close a deal that is already closed", () => {
    render(<PlanBuilder workspaceId={WORKSPACE_ID} plan={makePlan("won")} initialStages={STAGES} isReadOnly />);

    expect(screen.queryByTestId("close-deal-controls")).not.toBeInTheDocument();
  });

  it("keeps every control, and mounts Close deal, for an open plan", () => {
    render(<PlanBuilder workspaceId={WORKSPACE_ID} plan={makePlan("active")} initialStages={STAGES} />);

    expect(screen.getAllByRole("button", { name: "Edit" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add stage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save plan details" })).toBeInTheDocument();
    expect(screen.getByTestId("close-deal-controls")).toBeInTheDocument();
  });
});

describe("PlanBuilderPage — a workspace whose only plan is closed", () => {
  it("falls back to the closed plan rather than pretending no plan exists", async () => {
    // Arrange
    stubWorkspaceClient({ id: WORKSPACE_ID, target_company_name: COMPANY_NAME });
    mockGetPlanForSeller.mockResolvedValue(null);
    mockGetClosedPlanForSeller.mockResolvedValue({ ...makePlan("won"), stages: STAGES });

    // Act
    render(await renderPage());

    // Assert
    expect(screen.getByRole("heading", { name: "Onboarding plan" })).toBeInTheDocument();
    expect(screen.getByText("Won")).toBeInTheDocument();
  });

  it("says in one line what is going on", async () => {
    stubWorkspaceClient({ id: WORKSPACE_ID, target_company_name: COMPANY_NAME });
    mockGetPlanForSeller.mockResolvedValue(null);
    mockGetClosedPlanForSeller.mockResolvedValue({ ...makePlan("lost"), stages: STAGES });

    render(await renderPage());

    expect(screen.getByTestId("closed-plan-note")).toHaveTextContent(
      "This deal is closed. Its plan is read-only.",
    );
  });

  it("offers an obvious, plain way to start a new plan — never a Signal", async () => {
    stubWorkspaceClient({ id: WORKSPACE_ID, target_company_name: COMPANY_NAME });
    mockGetPlanForSeller.mockResolvedValue(null);
    mockGetClosedPlanForSeller.mockResolvedValue({ ...makePlan("won"), stages: STAGES });

    const { container } = render(await renderPage());

    expect(screen.getByRole("button", { name: "Create plan" })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });

  it("renders the read-only plan, so no edit control reaches the seller", async () => {
    stubWorkspaceClient({ id: WORKSPACE_ID, target_company_name: COMPANY_NAME });
    mockGetPlanForSeller.mockResolvedValue(null);
    mockGetClosedPlanForSeller.mockResolvedValue({ ...makePlan("won"), stages: STAGES });

    render(await renderPage());

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save plan details" })).not.toBeInTheDocument();
  });
});

describe("PlanBuilderPage — a workspace with an open plan", () => {
  it("never pays for the closed-plan read when a live plan was found", async () => {
    stubWorkspaceClient({ id: WORKSPACE_ID, target_company_name: COMPANY_NAME });
    mockGetPlanForSeller.mockResolvedValue({ ...makePlan("active"), stages: STAGES });

    render(await renderPage());

    expect(mockGetClosedPlanForSeller).not.toHaveBeenCalled();
    expect(screen.queryByTestId("closed-plan-note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save plan details" })).toBeInTheDocument();
  });
});

describe("PlanBuilderPage — a workspace with no plan at all", () => {
  it("shows the ordinary create-plan empty state", async () => {
    stubWorkspaceClient({ id: WORKSPACE_ID, target_company_name: COMPANY_NAME });
    mockGetPlanForSeller.mockResolvedValue(null);
    mockGetClosedPlanForSeller.mockResolvedValue(null);

    render(await renderPage());

    expect(screen.getByRole("heading", { name: "Start a success plan" })).toBeInTheDocument();
    expect(screen.queryByTestId("closed-plan-note")).not.toBeInTheDocument();
  });

  it("degrades to that same empty state, rather than breaking, when the closed-plan read fails", async () => {
    stubWorkspaceClient({ id: WORKSPACE_ID, target_company_name: COMPANY_NAME });
    mockGetPlanForSeller.mockResolvedValue(null);
    mockGetClosedPlanForSeller.mockRejectedValue(new Error("supabase down"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    render(await renderPage());

    expect(screen.getByRole("heading", { name: "Start a success plan" })).toBeInTheDocument();
    // Never swallowed silently — the server still says what happened.
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
