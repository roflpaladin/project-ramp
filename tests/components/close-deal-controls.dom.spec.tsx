// Sprint 12, Ticket 60 — "Close deal"
// (app/admin/workspaces/[id]/plan/close-deal-controls.tsx). Runs under the
// "components" Vitest project (happy-dom) — see vitest.config.ts.
//
// plan-actions.ts is a "use server" module, mocked wholesale (house style,
// same as activation-checklist.dom.spec.tsx) so this file exercises only the
// component's own disclosure/confirm/pending/error behaviour. The real
// action body is covered DB-free by tests/plans/closed-plan-actions.spec.ts.
//
// Covers: nothing renders for an already-closed plan; the disclosure is a
// real <details>/<summary> (keyboard-operable, no custom widget); Won and
// Lost each reach a confirm step BEFORE the action fires and then call it
// with the right outcome; no browser confirm()/alert() is ever used; pending
// and error states; focus is handed to the confirm button rather than
// dropped; and the whole control carries ZERO Signal — closing a deal is a
// quiet action, never the page's shout.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockClosePlanAction } = vi.hoisted(() => ({ mockClosePlanAction: vi.fn() }));

vi.mock("@/app/admin/workspaces/[id]/plan/plan-actions", () => ({
  closePlanAction: mockClosePlanAction,
}));

import { CloseDealControls } from "@/app/admin/workspaces/[id]/plan/close-deal-controls";
import type { PlanStatus } from "@/lib/plans/types";

const WORKSPACE_ID = "ws-1";
const PLAN_ID = "plan-1";

interface RenderOptions {
  readonly onClosed?: () => void;
}

function renderControls(planStatus: PlanStatus = "active", options: RenderOptions = {}) {
  return render(
    <CloseDealControls
      workspaceId={WORKSPACE_ID}
      planId={PLAN_ID}
      planStatus={planStatus}
      onClosed={options.onClosed}
    />,
  );
}

/** Opens the <details> the way a keyboard or mouse user would. */
function openDisclosure() {
  fireEvent.click(screen.getByText("Close this deal"));
}

beforeEach(() => {
  mockClosePlanAction.mockResolvedValue({ ok: true, data: { id: PLAN_ID, status: "won" } });
});

afterEach(() => {
  cleanup();
  mockClosePlanAction.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CloseDealControls — an already-closed deal", () => {
  it("renders nothing at all for a won plan", () => {
    const { container } = renderControls("won");

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing at all for a lost plan", () => {
    const { container } = renderControls("lost");

    expect(container).toBeEmptyDOMElement();
  });

  it("renders for an open plan (draft and active alike)", () => {
    renderControls("draft");

    expect(screen.getByTestId("close-deal-controls")).toBeInTheDocument();
  });
});

describe("CloseDealControls — the disclosure", () => {
  it("is a real details/summary, so it is keyboard-operable with no custom widget", () => {
    renderControls();

    const summary = screen.getByText("Close this deal");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")).not.toBeNull();
  });

  it("offers Won and Lost as plain buttons once opened", () => {
    renderControls();
    openDisclosure();

    expect(screen.getByRole("button", { name: "Won" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lost" })).toBeInTheDocument();
  });
});

describe("CloseDealControls — the confirm step", () => {
  it("does NOT call the action on the first press — it explains what closing does first", () => {
    // Arrange
    renderControls();
    openDisclosure();

    // Act
    fireEvent.click(screen.getByRole("button", { name: "Won" }));

    // Assert
    expect(mockClosePlanAction).not.toHaveBeenCalled();
    expect(screen.getByText(/makes this plan read-only and frees a slot on your plan/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is deleted/i)).toBeInTheDocument();
  });

  it("never uses a browser confirm() or alert() dialog", () => {
    // happy-dom ships neither, so they are stubbed in rather than spied on —
    // which also proves the component doesn't merely get away with calling a
    // function that happens not to exist here.
    const confirmStub = vi.fn(() => true);
    const alertStub = vi.fn();
    vi.stubGlobal("confirm", confirmStub);
    vi.stubGlobal("alert", alertStub);

    renderControls();
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Lost" }));
    fireEvent.click(screen.getByRole("button", { name: "Close as lost" }));

    expect(confirmStub).not.toHaveBeenCalled();
    expect(alertStub).not.toHaveBeenCalled();
  });

  it("moves focus onto the confirm button, so keyboard focus is never dropped", () => {
    renderControls();
    openDisclosure();

    fireEvent.click(screen.getByRole("button", { name: "Won" }));

    expect(screen.getByRole("button", { name: "Close as won" })).toHaveFocus();
  });

  it("goes back to the Won/Lost choice without ever calling the action", () => {
    renderControls();
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Won" }));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("button", { name: "Won" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close as won" })).not.toBeInTheDocument();
    expect(mockClosePlanAction).not.toHaveBeenCalled();
  });
});

describe("CloseDealControls — closing", () => {
  it("calls closePlanAction with the won outcome", async () => {
    renderControls();
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Won" }));

    fireEvent.click(screen.getByRole("button", { name: "Close as won" }));

    await waitFor(() => expect(mockClosePlanAction).toHaveBeenCalledWith(WORKSPACE_ID, PLAN_ID, "won"));
  });

  it("calls closePlanAction with the lost outcome", async () => {
    renderControls();
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Lost" }));

    fireEvent.click(screen.getByRole("button", { name: "Close as lost" }));

    await waitFor(() => expect(mockClosePlanAction).toHaveBeenCalledWith(WORKSPACE_ID, PLAN_ID, "lost"));
  });

  it("shows a pending state that is announced, not just drawn", async () => {
    // Held open so the pending state is observable, then released at the end
    // — an unresolved promise would leak into the next test.
    let release = () => {};
    mockClosePlanAction.mockImplementationOnce(
      () =>
        new Promise<{ ok: true; data: { id: string; status: string } }>((resolve) => {
          release = () => resolve({ ok: true, data: { id: PLAN_ID, status: "won" } });
        }),
    );

    renderControls();
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Won" }));
    fireEvent.click(screen.getByRole("button", { name: "Close as won" }));

    const pending = await screen.findByRole("status");
    expect(pending).toHaveTextContent(/closing this deal/i);
    expect(screen.getByRole("button", { name: "Closing…" })).toBeDisabled();

    release();
  });
});

describe("CloseDealControls — focus hand-off on success (T60 HIGH fix)", () => {
  // The confirm button unmounts once the PARENT (plan-builder.tsx) later
  // re-renders with the plan's new closed status — by then this component is
  // gone and cannot manage focus itself. It notifies the parent instead, via
  // onClosed, called exactly once, synchronously with the resolved result —
  // well before that later unmount — so the parent can move focus onto
  // something that survives it (see plan-builder.tsx's own heading ref).
  it("calls onClosed exactly once after the action resolves ok", async () => {
    const onClosed = vi.fn();
    renderControls("draft", { onClosed });
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Won" }));

    fireEvent.click(screen.getByRole("button", { name: "Close as won" }));

    await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
  });

  it("does NOT call onClosed when the action refuses", async () => {
    mockClosePlanAction.mockResolvedValueOnce({ ok: false, code: "PLAN_CLOSED" });
    const onClosed = vi.fn();
    renderControls("draft", { onClosed });
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Won" }));

    fireEvent.click(screen.getByRole("button", { name: "Close as won" }));

    await screen.findByRole("alert");
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("does NOT call onClosed when the round trip itself rejects", async () => {
    mockClosePlanAction.mockRejectedValueOnce(new Error("network down"));
    const onClosed = vi.fn();
    renderControls("draft", { onClosed });
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Lost" }));

    fireEvent.click(screen.getByRole("button", { name: "Close as lost" }));

    await screen.findByRole("alert");
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("tolerates a missing onClosed prop (optional)", async () => {
    renderControls("draft");
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Won" }));

    fireEvent.click(screen.getByRole("button", { name: "Close as won" }));

    await waitFor(() => expect(mockClosePlanAction).toHaveBeenCalled());
  });
});

describe("CloseDealControls — failures", () => {
  it("surfaces the shared plan-error copy when the action refuses", async () => {
    mockClosePlanAction.mockResolvedValueOnce({ ok: false, code: "PLAN_CLOSED" });

    renderControls();
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Won" }));
    fireEvent.click(screen.getByRole("button", { name: "Close as won" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This deal is closed, so its plan is read-only.");
  });

  it("surfaces a quiet message rather than throwing when the round trip itself rejects", async () => {
    mockClosePlanAction.mockRejectedValueOnce(new Error("network down"));

    renderControls();
    openDisclosure();
    fireEvent.click(screen.getByRole("button", { name: "Lost" }));
    fireEvent.click(screen.getByRole("button", { name: "Close as lost" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
  });
});

describe("CloseDealControls — zero Signal elements (design system MUST)", () => {
  it("never renders data-signal=\"true\", in any step", () => {
    const { container } = renderControls();
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);

    openDisclosure();
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Won" }));
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });
});

describe("CloseDealControls — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(
      new NodeURL("../../app/admin/workspaces/[id]/plan/close-deal-controls.css", import.meta.url),
    );
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
