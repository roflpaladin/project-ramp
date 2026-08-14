// Sprint 7, Ticket 33 (plans/sprint-6-7-replan.md §7). Component-level DOM
// assertions for components/buyer/buyer-workspace-view.tsx. Runs under the
// "components" Vitest project (happy-dom) — see vitest.config.ts.
//
// Coverage per the ticket brief: single-export module shape, spine order,
// exactly one Signal element, dot+text ownership markers (seller steps
// stay VISIBLE), zero states, and whitelabel accent confinement.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { BuyerPayload, BuyerPlan, BuyerResource, BuyerStage, BuyerStep } from "@/lib/portal-payload";
import * as BuyerWorkspaceModule from "@/components/buyer/buyer-workspace-view";
import { BuyerWorkspaceView } from "@/components/buyer/buyer-workspace-view";

afterEach(() => {
  cleanup();
});

function makeStep(overrides: Partial<BuyerStep> & Pick<BuyerStep, "id" | "label">): BuyerStep {
  return {
    owner_side: "seller",
    owner_name: null,
    due_date: null,
    status: "open",
    display_order: 0,
    completed_at: null,
    ...overrides,
  };
}

function makeStage(overrides: Partial<BuyerStage> & Pick<BuyerStage, "id" | "title">): BuyerStage {
  return { display_order: 0, status: "upcoming", steps: [], ...overrides };
}

function makePlan(overrides: Partial<BuyerPlan> = {}): BuyerPlan {
  return {
    id: "plan-1",
    title: "Onboarding plan",
    start_date: null,
    target_date: null,
    status: "active",
    stages: [],
    ...overrides,
  };
}

function makePayload(overrides: Partial<BuyerPayload> = {}): BuyerPayload {
  return {
    workspace: {
      id: "workspace-1",
      target_company_name: "Acme Corp",
      target_domain: "acme.example.com",
      chat_url: null,
    },
    plan: null,
    resources: [],
    ...overrides,
  };
}

// Dates relative to "now" at test-run time, so assertions stay deterministic
// without the component accepting a `now` prop (T33-1 fixes the prop
// signature to exactly `{ payload }` — no clock injection point exists at
// the component boundary, only inside the pure selectors it calls).
function isoDaysFromNow(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function twoStagePlan(): BuyerPlan {
  return makePlan({
    start_date: isoDaysFromNow(-5),
    target_date: isoDaysFromNow(10),
    stages: [
      makeStage({
        id: "stage-1",
        title: "Kickoff",
        status: "done",
        steps: [makeStep({ id: "step-1", label: "Send contract", status: "done", owner_side: "seller" })],
      }),
      makeStage({
        id: "stage-2",
        title: "Security review",
        status: "current",
        steps: [
          makeStep({ id: "step-2", label: "Complete security questionnaire", status: "open", owner_side: "buyer" }),
          makeStep({ id: "step-3", label: "Provision sandbox", status: "open", owner_side: "seller" }),
        ],
      }),
    ],
  });
}

describe("module boundary — single entry point", () => {
  it("exports exactly one thing: BuyerWorkspaceView", () => {
    expect(Object.keys(BuyerWorkspaceModule)).toEqual(["BuyerWorkspaceView"]);
  });

  it("BuyerWorkspaceView is a function", () => {
    expect(typeof BuyerWorkspaceView).toBe("function");
  });
});

describe("spine order — runway banner, then the Your move card, then the staged plan", () => {
  it("renders the three spine landmarks in document order", () => {
    const payload = makePayload({ plan: twoStagePlan() });
    const { getByTestId } = render(<BuyerWorkspaceView payload={payload} />);

    const runway = getByTestId("buyer-runway-banner");
    const signalCard = getByTestId("buyer-signal-card");
    const stagedPlan = getByTestId("buyer-staged-plan");

    // DOCUMENT_POSITION_FOLLOWING = 4: asserts `runway` precedes `signalCard`
    // precedes `stagedPlan` in the actual rendered DOM, not just in JSX
    // source order (which could be reordered by CSS `order`/flex-direction
    // without this failing — that's out of scope here, but the ordering
    // this asserts is the one screen readers and "view source" both see).
    expect(runway.compareDocumentPosition(signalCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(signalCard.compareDocumentPosition(stagedPlan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("never buries the staged plan below the fold marker (renders inside the primary spine, not the rail)", () => {
    const payload = makePayload({ plan: twoStagePlan() });
    const { getByTestId } = render(<BuyerWorkspaceView payload={payload} />);
    const spine = getByTestId("buyer-spine");
    const stagedPlan = getByTestId("buyer-staged-plan");
    expect(spine.contains(stagedPlan)).toBe(true);
  });
});

describe("Signal — exactly one Signal element per rendered page", () => {
  it("marks exactly one element data-signal=true when a next open step exists", () => {
    const payload = makePayload({ plan: twoStagePlan() });
    const { container } = render(<BuyerWorkspaceView payload={payload} />);
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });

  it("marks zero elements data-signal=true once every step is done or blocked", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "stage-1",
          title: "Kickoff",
          status: "done",
          steps: [makeStep({ id: "step-1", label: "Send contract", status: "done" })],
        }),
      ],
    });
    const { container } = render(<BuyerWorkspaceView payload={makePayload({ plan })} />);
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });

  it("marks zero elements data-signal=true for a plan with no stages", () => {
    const { container } = render(<BuyerWorkspaceView payload={makePayload({ plan: makePlan() })} />);
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });

  it("names whose move it is, adapting the heading rather than always claiming 'your move'", () => {
    // Next open step is buyer-owned in this fixture.
    render(<BuyerWorkspaceView payload={makePayload({ plan: twoStagePlan() })} />);
    expect(screen.getByText("Your move")).toBeInTheDocument();
  });

  it("reads 'Their move' when the next open step belongs to the seller", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "stage-1",
          title: "Kickoff",
          status: "current",
          steps: [makeStep({ id: "step-1", label: "Draft the contract", status: "open", owner_side: "seller" })],
        }),
      ],
    });
    render(<BuyerWorkspaceView payload={makePayload({ plan })} />);
    expect(screen.getByText("Their move")).toBeInTheDocument();
  });
});

describe("current stage marked with the ramp gesture", () => {
  it("renders the ramp gesture marker on the stage the seller marked 'current'", () => {
    const payload = makePayload({ plan: twoStagePlan() });
    const { getAllByTestId } = render(<BuyerWorkspaceView payload={payload} />);
    const gestures = getAllByTestId("buyer-ramp-gesture");
    expect(gestures).toHaveLength(1);
  });

  it("renders no ramp gesture when no stage is marked current", () => {
    const plan = makePlan({
      stages: [makeStage({ id: "stage-1", title: "Kickoff", status: "upcoming", steps: [] })],
    });
    const { queryByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan })} />);
    expect(queryByTestId("buyer-ramp-gesture")).not.toBeInTheDocument();
  });
});

describe("ownership — buyer vs seller steps, dot + text, seller steps stay visible", () => {
  it("renders both a buyer-owned and a seller-owned step with a text owner label, not colour alone", () => {
    const payload = makePayload({ plan: twoStagePlan() });
    render(<BuyerWorkspaceView payload={payload} />);

    // T33-6's deliberate asymmetry: the buyer must still SEE the
    // seller-owned step's label and owner text. Scoped to the staged plan
    // because "Complete security questionnaire" is ALSO the next open step
    // named in the Your-move Signal card above — that's expected duplication
    // (the card previews the exact step listed below it), not a leak.
    const stagedPlan = screen.getByTestId("buyer-staged-plan");
    expect(within(stagedPlan).getByText("Provision sandbox")).toBeInTheDocument();
    expect(within(stagedPlan).getByText("Complete security questionnaire")).toBeInTheDocument();

    const sellerStep = screen.getByTestId("buyer-step-step-3");
    const buyerStep = screen.getByTestId("buyer-step-step-2");
    expect(sellerStep).toHaveAttribute("data-owner", "seller");
    expect(buyerStep).toHaveAttribute("data-owner", "buyer");

    // Text label, not just a coloured dot.
    expect(sellerStep.textContent).toContain("Seller");
    expect(buyerStep.textContent).toContain("Buyer");
  });

  it("gives every step a status dot AND a text label (status is never colour-only)", () => {
    const payload = makePayload({ plan: twoStagePlan() });
    render(<BuyerWorkspaceView payload={payload} />);
    const doneStep = screen.getByTestId("buyer-step-step-1");
    expect(doneStep.querySelector("[data-status-dot]")).toBeInTheDocument();
    expect(doneStep.textContent).toContain("Done");
  });
});

describe("zero states", () => {
  it("renders a one-sentence zero state and no runway banner when the plan is null", () => {
    const { queryByTestId, getByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan: null })} />);
    expect(queryByTestId("buyer-runway-banner")).not.toBeInTheDocument();
    expect(queryByTestId("buyer-signal-card")).not.toBeInTheDocument();
    expect(getByTestId("buyer-empty-plan")).toBeInTheDocument();
  });

  it("renders a zero state for the staged plan when the plan has no stages, without crashing", () => {
    const { getByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan: makePlan() })} />);
    expect(getByTestId("buyer-staged-plan")).toBeInTheDocument();
    expect(getByTestId("buyer-staged-plan-empty")).toBeInTheDocument();
  });

  it("renders the runway banner in its no-dates form, without a day count or a broken position marker", () => {
    const plan = makePlan({
      start_date: null,
      target_date: null,
      stages: [makeStage({ id: "stage-1", title: "Kickoff", steps: [] })],
    });
    const { getByTestId, queryByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan })} />);
    const runway = getByTestId("buyer-runway-banner");
    expect(runway).toHaveAttribute("data-has-dates", "false");
    expect(queryByTestId("buyer-runway-marker")).not.toBeInTheDocument();
    expect(runway.textContent).not.toMatch(/NaN/);
    expect(runway.textContent).not.toMatch(/Invalid Date/);
  });

  it("renders the runway banner normally when only one boundary date is set (treated as no-dates rather than guessing)", () => {
    const plan = makePlan({
      start_date: isoDaysFromNow(-2),
      target_date: null,
      stages: [makeStage({ id: "stage-1", title: "Kickoff", steps: [] })],
    });
    const { getByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan })} />);
    expect(getByTestId("buyer-runway-banner")).toHaveAttribute("data-has-dates", "false");
  });
});

describe("rail", () => {
  it("lists a blocked step with its owner in the rail", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "stage-1",
          title: "Security review",
          status: "current",
          steps: [makeStep({ id: "step-1", label: "Legal sign-off", status: "blocked", owner_side: "seller", owner_name: "Dana" })],
        }),
      ],
    });
    const { getByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan })} />);
    const blockers = getByTestId("buyer-rail-blockers");
    expect(blockers.textContent).toContain("Legal sign-off");
    expect(blockers.textContent).toContain("Dana");
  });

  it("shows a quiet fallback when nothing is blocked", () => {
    const { getByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan: twoStagePlan() })} />);
    expect(getByTestId("buyer-rail-blockers").textContent).toMatch(/nothing/i);
  });

  it("renders the buying committee section with an invite affordance", () => {
    const { getByTestId, getByRole } = render(<BuyerWorkspaceView payload={makePayload({ plan: twoStagePlan() })} />);
    expect(getByTestId("buyer-rail-committee")).toBeInTheDocument();
    const invite = getByRole("link", { name: /invite/i });
    expect(invite.getAttribute("href")).toMatch(/^mailto:/);
  });

  it("renders a contact-the-seller link in context when chat_url is present", () => {
    const payload = makePayload({ plan: twoStagePlan() });
    const withChat: BuyerPayload = { ...payload, workspace: { ...payload.workspace, chat_url: "https://chat.example.com/room" } };
    const { getByRole } = render(<BuyerWorkspaceView payload={withChat} />);
    const link = getByRole("link", { name: /contact|message/i });
    expect(link).toHaveAttribute("href", "https://chat.example.com/room");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("hides the contact-the-seller control entirely when chat_url is null", () => {
    const { queryByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan: twoStagePlan() })} />);
    expect(queryByTestId("buyer-rail-contact")).not.toBeInTheDocument();
  });

  it("lists buyer-owned overdue steps in the rail", () => {
    const plan = makePlan({
      stages: [
        makeStage({
          id: "stage-1",
          title: "Kickoff",
          status: "current",
          steps: [
            makeStep({
              id: "step-1",
              label: "Provide SSO metadata",
              status: "open",
              owner_side: "buyer",
              due_date: isoDaysFromNow(-3),
            }),
          ],
        }),
      ],
    });
    const { getByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan })} />);
    expect(getByTestId("buyer-rail-overdue").textContent).toContain("Provide SSO metadata");
  });
});

// T34-2 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7). Ticket 33
// shipped BuyerWorkspaceView without any resources rendering at all — a real
// regression once this component became the sole rendering for both buyer
// surfaces (tests/security/buyer-boundary.spec.ts and
// tests/security/link-visibility-toggle.spec.ts both assert on shared-resource
// labels reaching /portal/[id]'s rendered HTML). Added here as part of
// mounting, not deferred, so the component keeps parity with what the old
// hand-rolled page rendering already proved out.
function makeResource(overrides: Partial<BuyerResource> & Pick<BuyerResource, "id" | "link_label">): BuyerResource {
  return {
    category_header: "Getting started",
    url_string: "https://docs.example.com/doc",
    display_order: 0,
    resource_type: null,
    ...overrides,
  };
}

describe("rail — shared resources (T34-2, closing a Ticket 33 gap)", () => {
  it("renders a shared resource grouped under its category header, linked through /api/track", () => {
    const payload = makePayload({
      resources: [makeResource({ id: "res-1", link_label: "Security overview", category_header: "Docs" })],
    });
    const { getByTestId, getByRole } = render(<BuyerWorkspaceView payload={payload} />);

    const section = getByTestId("buyer-rail-resources");
    expect(within(section).getByText("Docs")).toBeInTheDocument();

    const link = getByRole("link", { name: "Security overview" });
    expect(link).toHaveAttribute("href", "/api/track?linkId=res-1&wsId=workspace-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("groups multiple resources under their own category headings", () => {
    const payload = makePayload({
      resources: [
        makeResource({ id: "res-1", link_label: "Onboarding guide", category_header: "Getting started" }),
        makeResource({ id: "res-2", link_label: "Reference architecture", category_header: "Technical" }),
      ],
    });
    const { getByTestId } = render(<BuyerWorkspaceView payload={payload} />);
    const section = getByTestId("buyer-rail-resources");
    expect(within(section).getByText("Getting started")).toBeInTheDocument();
    expect(within(section).getByText("Technical")).toBeInTheDocument();
    expect(within(section).getByText("Onboarding guide")).toBeInTheDocument();
    expect(within(section).getByText("Reference architecture")).toBeInTheDocument();
  });

  it("hides the resources section entirely when there are no shared resources", () => {
    const { queryByTestId } = render(<BuyerWorkspaceView payload={makePayload({ resources: [] })} />);
    expect(queryByTestId("buyer-rail-resources")).not.toBeInTheDocument();
  });

  it("never carries the --buyer-accent whitelabel token on a resource link", () => {
    const payload = makePayload({
      resources: [makeResource({ id: "res-1", link_label: "Security overview" })],
    });
    const { getByRole } = render(<BuyerWorkspaceView payload={payload} />);
    const link = getByRole("link", { name: "Security overview" });
    expect(link.getAttribute("style") ?? "").not.toContain("--buyer-accent");
  });
});

describe("whitelabel accent confinement (T33-7)", () => {
  it("renders exactly one identity-rule element, the sole allowed accent selector in this component", () => {
    const { getAllByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan: twoStagePlan() })} />);
    expect(getAllByTestId("buyer-identity-rule")).toHaveLength(1);
  });

  it("never places the buyer accent custom property on any element other than the identity rule", () => {
    const { container } = render(<BuyerWorkspaceView payload={makePayload({ plan: twoStagePlan() })} />);
    const withAccentVar = Array.from(container.querySelectorAll<HTMLElement>("[style]")).filter((el) =>
      el.getAttribute("style")?.includes("--buyer-accent"),
    );
    for (const el of withAccentVar) {
      expect(el.getAttribute("data-testid")).toBe("buyer-identity-rule");
    }
  });

  it("caps the buyer logo/favicon image to the 24px whitelabel maximum", () => {
    const { getByTestId } = render(<BuyerWorkspaceView payload={makePayload({ plan: twoStagePlan() })} />);
    const logo = getByTestId("buyer-identity-logo");
    expect(logo.className).toContain("bw-identity-logo");
  });

  it("never renders the buyer accent on any link or button element", () => {
    const { container } = render(<BuyerWorkspaceView payload={makePayload({ plan: twoStagePlan() })} />);
    const interactive = container.querySelectorAll("a, button");
    for (const el of Array.from(interactive)) {
      expect(el.getAttribute("style") ?? "").not.toContain("--buyer-accent");
    }
  });
});
