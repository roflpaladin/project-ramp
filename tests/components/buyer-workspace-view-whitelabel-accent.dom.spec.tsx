// Sprint 7 · Ticket 33 — T33-11 (plans/sprint-6-7-replan.md §7).
//
// Whitelabel accent grep: `--buyer-accent` (the buyer's own scraped brand
// colour, distinct from the fixed --seller-marker/--buyer-marker "side"
// tokens used for ownership everywhere else in this component) must appear
// ONLY on the identity-strip rule/underline. The favicon is browser chrome —
// it carries no `--buyer-accent` CSS at all, it is a plain <img>, so the
// allowed set inside THIS component's own CSS is exactly one selector,
// `.bw-identity-rule`. Never on a button, never replacing Signal
// (CLAUDE.md's non-negotiable UI rules; live source of truth is the Notion
// "UI/UX and Design Guidelines" page).
//
// Two grep passes, both required by the ticket brief:
//   1. Static — every occurrence of `--buyer-accent` in the component's OWN
//      CSS file belongs to the `.bw-identity-rule` rule block.
//   2. Rendered — every occurrence of the literal string `--buyer-accent` in
//      the actual rendered HTML (inline styles/attributes) lives on the
//      identity-rule element, across every state the component can render
//      (with a plan, with an empty plan, with a zero-stage plan) — a static
//      CSS-only check could miss a future inline-style regression that
//      bypasses the stylesheet entirely.
//
// "Prototype fidelity" itself (does it LOOK right) stays a human eye-check
// per plans/sprint-6-7-replan.md's Open Items table ("Renders identically to
// the prototype" -> design-intent sign-off by eye, default applied to T33-11).
// This file only proves the mechanical confinement claim.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { BuyerPayload, BuyerPlan } from "@/lib/portal-payload";
import { BuyerWorkspaceView } from "@/components/buyer/buyer-workspace-view";

afterEach(() => {
  cleanup();
});

const ACCENT_TOKEN = "--buyer-accent";
const ALLOWED_CLASS = "bw-identity-rule";

function makePayload(plan: BuyerPlan | null): BuyerPayload {
  return {
    workspace: {
      id: "accent-ws-1",
      target_company_name: "Acme Corp",
      target_domain: "acme.example.com",
      chat_url: "https://chat.example.com/room",
    },
    plan,
    resources: [],
  };
}

function planWithStages(): BuyerPlan {
  return {
    id: "plan-1",
    title: "Onboarding plan",
    start_date: "2026-07-01",
    target_date: "2026-09-30",
    status: "active",
    stages: [
      {
        id: "stage-1",
        title: "Kickoff",
        display_order: 0,
        status: "current",
        steps: [
          {
            id: "step-1",
            label: "Draft the contract",
            owner_side: "seller",
            owner_name: "Dana",
            due_date: null,
            status: "open",
            display_order: 0,
            completed_at: null,
          },
        ],
      },
    ],
  };
}

function emptyPlan(): BuyerPlan {
  return {
    id: "plan-2",
    title: "Empty plan",
    start_date: null,
    target_date: null,
    status: "active",
    stages: [],
  };
}

describe("T33-11 — static CSS grep: --buyer-accent confined to .bw-identity-rule", () => {
  const cssPath = fileURLToPath(
    new NodeURL("../../components/buyer/buyer-workspace-view.css", import.meta.url),
  );
  const css = readFileSync(cssPath, "utf8");

  it("actually declares --buyer-accent somewhere (positive control — an absent token would pass vacuously)", () => {
    expect(css).toContain(ACCENT_TOKEN);
  });

  it("every CSS rule block that references --buyer-accent is the .bw-identity-rule block, and no other", () => {
    // Matches "<selector> { <body> }" blocks, non-greedy, across the whole
    // file — this component's CSS has no nested @media block containing the
    // identity rule, so a flat block match is sufficient here.
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const blocksReferencingAccent = blocks.filter(([, , body]) => body.includes(ACCENT_TOKEN));

    expect(blocksReferencingAccent.length).toBeGreaterThan(0);
    for (const [, selector] of blocksReferencingAccent) {
      expect(selector).toContain(ALLOWED_CLASS);
    }
  });

  it("never pairs --buyer-accent with a button or link selector", () => {
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [, selector, body] of blocks) {
      if (!body.includes(ACCENT_TOKEN)) continue;
      expect(selector).not.toMatch(/\bbutton\b|\.bw-rail-link\b|\.bw-rail-invite\b/);
    }
  });
});

describe("T33-11 — rendered-output grep: --buyer-accent only ever lands on the identity rule element", () => {
  const scenarios: { readonly name: string; readonly plan: BuyerPlan | null }[] = [
    { name: "with a populated plan", plan: planWithStages() },
    { name: "with a zero-stage plan", plan: emptyPlan() },
    { name: "with no plan at all (empty-plan zero state)", plan: null },
  ];

  for (const { name, plan } of scenarios) {
    it(`confines every rendered --buyer-accent occurrence to the identity-rule element (${name})`, () => {
      const { container } = render(<BuyerWorkspaceView payload={makePayload(plan)} />);

      const elementsCarryingAccent = Array.from(
        container.querySelectorAll<HTMLElement>("[style]"),
      ).filter((el) => (el.getAttribute("style") ?? "").includes(ACCENT_TOKEN));

      for (const el of elementsCarryingAccent) {
        expect(el.getAttribute("data-testid")).toBe("buyer-identity-rule");
      }
    });

    it(`renders no <a> or <button> element carrying --buyer-accent (${name})`, () => {
      const { container } = render(<BuyerWorkspaceView payload={makePayload(plan)} />);
      const interactive = container.querySelectorAll<HTMLElement>("a, button");
      for (const el of Array.from(interactive)) {
        expect(el.getAttribute("style") ?? "").not.toContain(ACCENT_TOKEN);
      }
    });
  }

  it("renders exactly one identity-rule element regardless of plan state (single allowed accent surface)", () => {
    const { getAllByTestId } = render(<BuyerWorkspaceView payload={makePayload(planWithStages())} />);
    expect(getAllByTestId("buyer-identity-rule")).toHaveLength(1);
  });

  it("never lets --buyer-accent replace the Signal card's colouring (the Signal card carries no accent styling)", () => {
    const { getByTestId } = render(<BuyerWorkspaceView payload={makePayload(planWithStages())} />);
    const signalCard = getByTestId("buyer-signal-card");
    expect(signalCard.getAttribute("style") ?? "").not.toContain(ACCENT_TOKEN);
    for (const child of Array.from(signalCard.querySelectorAll<HTMLElement>("[style]"))) {
      expect(child.getAttribute("style") ?? "").not.toContain(ACCENT_TOKEN);
    }
  });
});
