// Sprint 11, Ticket 58 — "In-App Onboarding Checklist". Component-level DOM
// assertions for app/admin/workspaces/[id]/activation-checklist.tsx. Runs
// under the "components" Vitest project (happy-dom) — see vitest.config.ts.
//
// checklist-actions.ts and plan/plan-actions.ts are both "use server"
// modules — mocked wholesale (house style, same as invite-panel.dom.spec.tsx
// mocks invite-actions.ts) so this file only exercises the component's own
// rendering/state-transition logic, never the real action bodies (those are
// covered against a real Supabase project by tests/security/checklist-actions.spec.ts
// and tests/security/mark-plan-live-action.spec.ts instead).
//
// Coverage per the ticket brief: all 8 combinations of the three activation
// booleans render the correct dot+text state per row; dismiss calls the
// mocked action and surfaces a quiet inline error on failure; the card
// renders nothing when dismissed or complete; the "make it live" button is
// enabled only when a plan exists and is still 'draft', and disappears
// entirely once live; a static grep proves the stylesheet carries no
// hardcoded hex colour; and the component never renders a Signal element.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ActivationState } from "@/lib/plans/activation";

const { mockDismissActivationChecklist, mockMarkPlanLiveAction } = vi.hoisted(() => ({
  mockDismissActivationChecklist: vi.fn(),
  mockMarkPlanLiveAction: vi.fn(),
}));

vi.mock("@/app/admin/workspaces/[id]/checklist-actions", () => ({
  dismissActivationChecklist: mockDismissActivationChecklist,
}));

vi.mock("@/app/admin/workspaces/[id]/plan/plan-actions", () => ({
  markPlanLiveAction: mockMarkPlanLiveAction,
}));

import * as ActivationChecklistModule from "@/app/admin/workspaces/[id]/activation-checklist";
import {
  ActivationChecklist,
  type ActivationChecklistPlanSummary,
} from "@/app/admin/workspaces/[id]/activation-checklist";

afterEach(() => {
  cleanup();
  mockDismissActivationChecklist.mockReset();
  mockMarkPlanLiveAction.mockReset();
});

const WORKSPACE_ID = "ws-1";
const PLAN_HREF = `/admin/workspaces/${WORKSPACE_ID}/plan`;

function makeActivation(overrides: Partial<ActivationState["steps"]>): ActivationState {
  const steps = { populated: false, invited: false, live: false, ...overrides };
  return { steps, isComplete: steps.populated && steps.invited && steps.live };
}

interface RenderOptions {
  readonly plan?: ActivationChecklistPlanSummary | null;
  readonly activation: ActivationState;
  readonly isDismissed?: boolean;
}

function renderChecklist({ plan = null, activation, isDismissed = false }: RenderOptions) {
  return render(
    <ActivationChecklist
      workspaceId={WORKSPACE_ID}
      plan={plan}
      activation={activation}
      isDismissed={isDismissed}
      planHref={PLAN_HREF}
    />,
  );
}

describe("module boundary — single entry point", () => {
  it("exports exactly one runtime value: ActivationChecklist", () => {
    expect(Object.keys(ActivationChecklistModule)).toEqual(["ActivationChecklist"]);
  });
});

describe("ActivationChecklist — dot+text state across all 8 boolean combinations", () => {
  const BOOLEAN_VALUES = [false, true];

  for (const populated of BOOLEAN_VALUES) {
    for (const invited of BOOLEAN_VALUES) {
      for (const live of BOOLEAN_VALUES) {
        const isComplete = populated && invited && live;
        const description = `populated=${populated} invited=${invited} live=${live}`;

        it(`renders the correct dot+text for each row (${description})`, () => {
          const activation = makeActivation({ populated, invited, live });
          // isComplete auto-hides the whole card (T58's render rule) — that
          // branch is covered on its own below, so here a plan is supplied
          // whenever `live` is true, keeping row assertions reachable for
          // every non-complete combination.
          if (isComplete) return;

          const plan: ActivationChecklistPlanSummary | null = live
            ? { id: "plan-1", status: "active" }
            : { id: "plan-1", status: "draft" };

          renderChecklist({ plan, activation });

          const populatedRow = screen.getByTestId("ac-row-populated");
          expect(populatedRow).toHaveAttribute("data-tone", populated ? "done" : "wait");
          expect(populatedRow).toHaveTextContent(populated ? "Plan steps added" : "Add steps to your plan");
          expect(populatedRow.querySelector("[data-status-dot]")).not.toBeNull();

          const invitedRow = screen.getByTestId("ac-row-invited");
          expect(invitedRow).toHaveAttribute("data-tone", invited ? "done" : "wait");
          expect(invitedRow).toHaveTextContent(invited ? "Buyer invited" : "Invite your buyer");
          expect(invitedRow.querySelector("[data-status-dot]")).not.toBeNull();

          const liveRow = screen.getByTestId("ac-row-live");
          expect(liveRow).toHaveAttribute("data-tone", live ? "done" : "wait");
          expect(liveRow).toHaveTextContent(live ? "Plan is live" : "Make the plan live");
          expect(liveRow.querySelector("[data-status-dot]")).not.toBeNull();
        });
      }
    }
  }
});

describe("ActivationChecklist — auto-hide rule", () => {
  it("renders nothing when isDismissed is true, even if incomplete", () => {
    renderChecklist({ activation: makeActivation({ populated: false, invited: false, live: false }), isDismissed: true });
    expect(screen.queryByTestId("activation-checklist")).not.toBeInTheDocument();
  });

  it("renders nothing when every step is satisfied (isComplete), even if not dismissed", () => {
    renderChecklist({
      plan: { id: "plan-1", status: "active" },
      activation: makeActivation({ populated: true, invited: true, live: true }),
      isDismissed: false,
    });
    expect(screen.queryByTestId("activation-checklist")).not.toBeInTheDocument();
  });

  it("renders when neither dismissed nor complete", () => {
    renderChecklist({ activation: makeActivation({}) });
    expect(screen.getByTestId("activation-checklist")).toBeInTheDocument();
  });
});

describe("ActivationChecklist — dismiss", () => {
  it("calls dismissActivationChecklist with the workspace id on click", async () => {
    mockDismissActivationChecklist.mockResolvedValueOnce({ ok: true });
    renderChecklist({ activation: makeActivation({}) });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(mockDismissActivationChecklist).toHaveBeenCalledWith(WORKSPACE_ID));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a quiet inline error and keeps the card visible when the action fails", async () => {
    mockDismissActivationChecklist.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
    renderChecklist({ activation: makeActivation({}) });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't find this workspace or plan — try refreshing the page.");
    expect(screen.getByTestId("activation-checklist")).toBeInTheDocument();
  });

  it("shows a generic inline error rather than throwing when the action call itself rejects", async () => {
    mockDismissActivationChecklist.mockRejectedValueOnce(new Error("network down"));
    renderChecklist({ activation: makeActivation({}) });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
  });

  it("shows the UNAUTHENTICATED-specific message when the seller's session has lapsed", async () => {
    mockDismissActivationChecklist.mockResolvedValueOnce({ ok: false, code: "UNAUTHENTICATED" });
    renderChecklist({ activation: makeActivation({}) });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You need to be signed in to do that — try refreshing the page.");
  });
});

describe("ActivationChecklist — make it live", () => {
  it("has no button and no CTA once the plan is already live", () => {
    renderChecklist({
      plan: { id: "plan-1", status: "active" },
      activation: makeActivation({ populated: true, invited: false, live: true }),
    });
    expect(screen.queryByRole("button", { name: /Make it live/ })).not.toBeInTheDocument();
  });

  it("disables the button when there is no plan yet", () => {
    renderChecklist({ plan: null, activation: makeActivation({}) });
    expect(screen.getByRole("button", { name: "Make it live" })).toBeDisabled();
  });

  it("disables the button when the plan exists but isn't in draft (e.g. 'won')", () => {
    renderChecklist({ plan: { id: "plan-1", status: "won" }, activation: makeActivation({}) });
    expect(screen.getByRole("button", { name: "Make it live" })).toBeDisabled();
  });

  it("enables the button when a plan exists and is still draft, and calls the action with workspace+plan id", async () => {
    mockMarkPlanLiveAction.mockResolvedValueOnce({
      ok: true,
      data: { id: "plan-1", workspace_id: WORKSPACE_ID, title: "Plan", start_date: null, target_date: null, status: "active", created_at: "2026-01-01T00:00:00+00:00" },
    });
    renderChecklist({ plan: { id: "plan-1", status: "draft" }, activation: makeActivation({}) });

    const button = screen.getByRole("button", { name: "Make it live" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => expect(mockMarkPlanLiveAction).toHaveBeenCalledWith(WORKSPACE_ID, "plan-1"));
  });

  it("shows a quiet inline error next to the button when the action fails", async () => {
    mockMarkPlanLiveAction.mockResolvedValueOnce({ ok: false, code: "PLAN_ALREADY_LIVE" });
    renderChecklist({ plan: { id: "plan-1", status: "draft" }, activation: makeActivation({}) });

    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
  });

  it("shows a generic inline error rather than throwing when the action call itself rejects", async () => {
    mockMarkPlanLiveAction.mockRejectedValueOnce(new Error("network down"));
    renderChecklist({ plan: { id: "plan-1", status: "draft" }, activation: makeActivation({}) });

    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
  });
});

describe("ActivationChecklist — nav links", () => {
  it("links 'Add steps to your plan' to the plan builder href", () => {
    renderChecklist({ activation: makeActivation({}) });
    expect(screen.getByRole("link", { name: "Open plan builder" })).toHaveAttribute("href", PLAN_HREF);
  });

  it("links 'Invite your buyer' to the same-page invite panel anchor", () => {
    renderChecklist({ activation: makeActivation({}) });
    expect(screen.getByRole("link", { name: "Open invite panel" })).toHaveAttribute("href", "#invite-panel");
  });
});

describe("ActivationChecklist — zero Signal elements (design system MUST)", () => {
  it("never renders data-signal=\"true\", in any state", () => {
    const { container, unmount } = renderChecklist({
      plan: { id: "plan-1", status: "draft" },
      activation: makeActivation({ populated: true, invited: false, live: false }),
    });
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
    unmount();

    const { container: liveContainer } = renderChecklist({
      plan: { id: "plan-1", status: "active" },
      activation: makeActivation({ populated: true, invited: true, live: false }),
    });
    expect(liveContainer.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });
});

describe("ActivationChecklist — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(
      new NodeURL("../../app/admin/workspaces/[id]/activation-checklist.css", import.meta.url),
    );
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
