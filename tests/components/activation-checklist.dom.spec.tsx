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
//
// Sprint 12, Ticket 60 extends this file with the upgrade wall: when the
// tenant is at their active-deal cap (or past due), the "Make it live"
// button is REPLACED by deal-limit-notice.tsx and nothing else in the card
// is touched. Two rules are load-bearing and asserted below — an
// infrastructure failure never renders as the wall (the button stays
// enabled), and the wall's CTA drops to a plain link when the page's one
// Signal is already spoken for. Error-message expectations changed in the
// same ticket: the card's local describeChecklistError was replaced by the
// shared describePlanError (plan/error-messages.ts), so codes now read in
// the plan builder's wording rather than this card's own.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ActivationState } from "@/lib/plans/activation";
import type { DealLimitState } from "@/app/admin/workspaces/[id]/deal-limit-state";

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

/** A tenant with room to spare — the default for every pre-T60 case below. */
const WITHIN_LIMIT: DealLimitState = Object.freeze({
  activeCount: 0,
  maxActiveDeals: 3,
  isAtLimit: false,
  isBlockedFromNewDeals: false,
  isUnknown: false,
});

const AT_LIMIT: DealLimitState = Object.freeze({
  activeCount: 3,
  maxActiveDeals: 3,
  isAtLimit: true,
  isBlockedFromNewDeals: false,
  isUnknown: false,
});

const PAST_DUE: DealLimitState = Object.freeze({
  activeCount: 1,
  maxActiveDeals: 3,
  isAtLimit: false,
  isBlockedFromNewDeals: true,
  isUnknown: false,
});

const UNKNOWN: DealLimitState = Object.freeze({
  activeCount: null,
  maxActiveDeals: null,
  isAtLimit: false,
  isBlockedFromNewDeals: false,
  isUnknown: true,
});

interface RenderOptions {
  readonly plan?: ActivationChecklistPlanSummary | null;
  readonly activation: ActivationState;
  readonly isDismissed?: boolean;
  readonly dealLimit?: DealLimitState;
  readonly canUseSignal?: boolean;
}

function renderChecklist({
  plan = null,
  activation,
  isDismissed = false,
  dealLimit = WITHIN_LIMIT,
  canUseSignal = true,
}: RenderOptions) {
  return render(
    <ActivationChecklist
      workspaceId={WORKSPACE_ID}
      plan={plan}
      activation={activation}
      isDismissed={isDismissed}
      planHref={PLAN_HREF}
      dealLimit={dealLimit}
      canUseSignal={canUseSignal}
    />,
  );
}

const DRAFT_PLAN: ActivationChecklistPlanSummary = { id: "plan-1", status: "draft" };

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
    expect(alert).toHaveTextContent("That item is no longer here. Refresh the page to see the current plan.");
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
    expect(alert).toHaveTextContent("Your session has expired. Sign in again to keep editing this plan.");
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

  it("disables the button when the plan exists but isn't in draft and isn't closed (e.g. 'active')", () => {
    renderChecklist({ plan: { id: "plan-1", status: "active" }, activation: makeActivation({}) });
    expect(screen.getByRole("button", { name: "Make it live" })).toBeDisabled();
  });

  it("hides the whole card once the plan is closed (won) — there is nothing left to activate (T60 HIGH fix)", () => {
    renderChecklist({ plan: { id: "plan-1", status: "won" }, activation: makeActivation({}) });
    expect(screen.queryByTestId("activation-checklist")).not.toBeInTheDocument();
  });

  it("hides the whole card once the plan is closed (lost) too", () => {
    renderChecklist({ plan: { id: "plan-1", status: "lost" }, activation: makeActivation({}) });
    expect(screen.queryByTestId("activation-checklist")).not.toBeInTheDocument();
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
    expect(alert).toHaveTextContent("This workspace already has a live plan. Archive it before starting a new one.");
  });

  it("shows a generic inline error rather than throwing when the action call itself rejects", async () => {
    mockMarkPlanLiveAction.mockRejectedValueOnce(new Error("network down"));
    renderChecklist({ plan: { id: "plan-1", status: "draft" }, activation: makeActivation({}) });

    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
  });
});

describe("ActivationChecklist — focus hand-off after going live (T60 HIGH fix)", () => {
  // The "Make it live" button doesn't unmount synchronously with the click's
  // own promise resolving — it unmounts later, when the PARENT re-renders
  // this card with the new `activation` prop (steps.live: true) once the
  // page revalidates. That later prop flip is simulated here via `rerender`;
  // an effect watching that same transition redirects focus onto the card's
  // own heading before the button's removal can drop it to <body>.
  it("moves focus onto the card's heading once activation.steps.live flips true", async () => {
    mockMarkPlanLiveAction.mockResolvedValueOnce({
      ok: true,
      data: {
        id: "plan-1",
        workspace_id: WORKSPACE_ID,
        title: "Plan",
        start_date: null,
        target_date: null,
        status: "active",
        created_at: "2026-01-01T00:00:00+00:00",
      },
    });
    const activationBeforeLive = makeActivation({ populated: true, invited: false, live: false });
    const { rerender } = renderChecklist({ plan: DRAFT_PLAN, activation: activationBeforeLive });

    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));
    await waitFor(() => expect(mockMarkPlanLiveAction).toHaveBeenCalled());

    // Simulate the page's later re-render with the server's new activation
    // state — the card stays visible (isComplete is still false: invited
    // hasn't happened) so its heading remains a valid focus target.
    const activationAfterLive = makeActivation({ populated: true, invited: false, live: true });
    rerender(
      <ActivationChecklist
        workspaceId={WORKSPACE_ID}
        plan={{ id: "plan-1", status: "active" }}
        activation={activationAfterLive}
        isDismissed={false}
        planHref={PLAN_HREF}
        dealLimit={WITHIN_LIMIT}
        canUseSignal
      />,
    );

    const heading = screen.getByRole("heading", { name: "Get this deal room moving" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("never steals focus on first paint", () => {
    renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}) });

    const heading = screen.getByRole("heading", { name: "Get this deal room moving" });
    expect(document.activeElement).not.toBe(heading);
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

describe("ActivationChecklist — the upgrade wall replaces the go-live button (T60)", () => {
  it("replaces 'Make it live' with the at-your-limit notice when the tenant is at their cap", () => {
    // Arrange / Act
    renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}), dealLimit: AT_LIMIT });

    // Assert
    expect(screen.queryByRole("button", { name: "Make it live" })).not.toBeInTheDocument();
    expect(screen.getByTestId("deal-limit-notice")).toHaveAttribute("data-reason", "limit");
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");
  });

  it("shows the payment-failed notice, with a billing destination, for a past-due tenant", () => {
    renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}), dealLimit: PAST_DUE });

    expect(screen.queryByRole("button", { name: "Make it live" })).not.toBeInTheDocument();
    expect(screen.getByTestId("deal-limit-notice")).toHaveAttribute("data-reason", "past-due");
    expect(screen.getByRole("link", { name: "Update payment details" })).toHaveAttribute("href", "/settings/billing");
  });

  it("locks NOTHING else in the card — the nav links and dismiss stay exactly as they were", () => {
    renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}), dealLimit: AT_LIMIT });

    expect(screen.getByRole("button", { name: "Dismiss" })).not.toBeDisabled();
    expect(screen.getByRole("link", { name: "Open plan builder" })).toHaveAttribute("href", PLAN_HREF);
    expect(screen.getByRole("link", { name: "Open invite panel" })).toHaveAttribute("href", "#invite-panel");
  });

  it("keeps the button ENABLED and offers no CTA when the billing check itself failed", () => {
    // Fails honest, not closed: the server is the authority and will answer
    // properly when the seller presses it.
    const { container } = renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}), dealLimit: UNKNOWN });

    expect(screen.getByRole("button", { name: "Make it live" })).not.toBeDisabled();
    expect(screen.getByTestId("deal-limit-notice")).toHaveAttribute("data-reason", "unknown");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });

  it("shows no notice at all for a tenant with room to spare", () => {
    renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}), dealLimit: WITHIN_LIMIT });

    expect(screen.queryByTestId("deal-limit-notice")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make it live" })).not.toBeDisabled();
  });

  it("shows no notice once the plan is already live — there is no button to wall off", () => {
    renderChecklist({
      plan: { id: "plan-1", status: "active" },
      activation: makeActivation({ populated: true, live: true }),
      dealLimit: AT_LIMIT,
    });

    expect(screen.queryByTestId("deal-limit-notice")).not.toBeInTheDocument();
  });

  it("renders the wall's CTA as a plain link when the page's one Signal is already spoken for", () => {
    const { container } = renderChecklist({
      plan: DRAFT_PLAN,
      activation: makeActivation({}),
      dealLimit: AT_LIMIT,
      canUseSignal: false,
    });

    expect(screen.getByRole("link", { name: "See plans" })).not.toHaveAttribute("data-signal");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });

  it("renders exactly one Signal, and only one, when the wall owns it", () => {
    const { container } = renderChecklist({
      plan: DRAFT_PLAN,
      activation: makeActivation({}),
      dealLimit: AT_LIMIT,
      canUseSignal: true,
    });

    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });
});

describe("ActivationChecklist — a stale page refused by the server (T60)", () => {
  it("surfaces the same wall inline when the action comes back DEAL_LIMIT_REACHED", async () => {
    mockMarkPlanLiveAction.mockResolvedValueOnce({ ok: false, code: "DEAL_LIMIT_REACHED" });
    renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}), dealLimit: WITHIN_LIMIT });

    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));

    const notice = await screen.findByTestId("deal-limit-notice");
    expect(notice).toHaveAttribute("data-reason", "limit");
    expect(screen.queryByRole("button", { name: "Make it live" })).not.toBeInTheDocument();
    // The wall carries the message — no duplicate raw error line beside it.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces the payment-failed wall when the action comes back BILLING_PAST_DUE", async () => {
    mockMarkPlanLiveAction.mockResolvedValueOnce({ ok: false, code: "BILLING_PAST_DUE" });
    renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}), dealLimit: WITHIN_LIMIT });

    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));

    expect(await screen.findByTestId("deal-limit-notice")).toHaveAttribute("data-reason", "past-due");
  });

  it("keeps the button available when the action comes back BILLING_CHECK_FAILED", async () => {
    mockMarkPlanLiveAction.mockResolvedValueOnce({ ok: false, code: "BILLING_CHECK_FAILED" });
    renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}), dealLimit: WITHIN_LIMIT });

    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));

    expect(await screen.findByTestId("deal-limit-notice")).toHaveAttribute("data-reason", "unknown");
    // The notice can render while the transition is still pending (label
    // "Making it live…"), so wait for the button to settle back.
    expect(await screen.findByRole("button", { name: "Make it live" })).not.toBeDisabled();
  });

  it("never offers an upgrade for the locked sample deal — a plain line, no CTA, no Signal", async () => {
    // Upgrading changes nothing about the sample deal, so treating this as a
    // paywall would be selling a fix that does not exist.
    mockMarkPlanLiveAction.mockResolvedValueOnce({ ok: false, code: "SAMPLE_DEAL_LOCKED" });
    const { container } = renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}), dealLimit: WITHIN_LIMIT });

    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The sample deal is for practice, so it can't go live. Create a real deal when you're ready to go live with a buyer.",
    );
    expect(screen.queryByTestId("deal-limit-notice")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See plans" })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });

  it("still uses the ordinary inline error for a code that is not about billing", async () => {
    mockMarkPlanLiveAction.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
    renderChecklist({ plan: DRAFT_PLAN, activation: makeActivation({}), dealLimit: WITHIN_LIMIT });

    fireEvent.click(screen.getByRole("button", { name: "Make it live" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That item is no longer here. Refresh the page to see the current plan.");
    expect(screen.queryByTestId("deal-limit-notice")).not.toBeInTheDocument();
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
