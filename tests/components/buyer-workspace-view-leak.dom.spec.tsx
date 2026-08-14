// Sprint 7 · Ticket 33 — T33-9 / T33-10 (plans/sprint-6-7-replan.md §7).
//
// §C extension, PLAN FIELDS. Sprint 5's green (tests/security/buyer-boundary.spec.ts,
// tests/plans/portal-payload.spec.ts) covers workspace and resource fields —
// Ticket 33 is the first sprint in which PLAN data (stages/steps, including
// `private_note`) reaches buyer-facing HTML through a real component at all.
// This file proves the pipeline a buyer's browser actually receives from:
// raw seller rows -> toBuyerPayload() -> BuyerWorkspaceView -> rendered HTML.
//
// T33-9: private_note is value-level ABSENT from the rendered HTML, for both
//        a seller-owned AND a buyer-owned step.
// T33-10: THE ASYMMETRY — a seller-owned step's LABEL and OWNER NAME are
//        value-level PRESENT in the rendered HTML (the product guarantee:
//        buyers must still see what the seller committed to) while that same
//        step's private_note is absent. This is the test that fails if a
//        future "fix" hides seller-owned steps entirely instead of only
//        stripping their private metadata (T33-6's warning,
//        plans/sprint-6-7-replan.md row T33-6).
//
// Reuses (does not re-declare) the Sprint 5 §C leak-assertion idioms:
// FORBIDDEN_FIELD_PATTERNS and the LEAK_TOKEN/VISIBLE_TOKEN sentinel
// convention from tests/fixtures/seed-leaky-workspace.ts — the same module
// tests/security/buyer-boundary.spec.ts and tests/plans/portal-payload.spec.ts
// already depend on. No Supabase, no live server: only the constant literals
// and the pattern array are imported, never seedLeakyWorkspace()/
// teardownLeakyWorkspace() (which need a real database) — this file's fixture
// is a plain in-memory raw row, built to the SAME sentinel-token convention so
// a grep for either token proves the same thing it proves in the security
// suite.
//
// Runs under the "components" Vitest project (happy-dom + real JSX) — see
// vitest.config.ts. `render()` + `container.innerHTML` is this project's
// equivalent of tests/security/buyer-boundary.spec.ts's raw HTTP response
// body grep, minus the network round trip.
//
// DEFERRED TO TICKET 34 (documented, not faked): the RSC *flight* payload
// (`self.__next_f.push([...])`) is a Next.js server-rendering artifact of a
// real page response — app/portal/[id]/page.tsx and app/view/[id]/page.tsx
// currently hardcode `plan: null` and do not yet mount BuyerWorkspaceView
// (plans/sprint-6-7-replan.md §7 Ticket 34, T34-2). A plain
// @testing-library/react `render()` into happy-dom never produces that script
// tag — there is no flight payload to extract at the component level, so
// asserting on tests/security/support/rsc-flight.ts's extractRscFlightPayload()
// here would be vacuous (checking an empty string against forbidden values
// always passes, proving nothing). The `it.todo` below names this explicitly
// rather than silently omitting it or faking a pass.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { PlanTree } from "@/lib/plans/types";
import { toBuyerPayload, type LinkRow, type WorkspaceRow } from "@/lib/portal-payload";
import { BuyerWorkspaceView } from "@/components/buyer/buyer-workspace-view";
import {
  BUYER_STEP_LABEL,
  BUYER_STEP_PRIVATE_NOTE,
  CRM_AMOUNT,
  CRM_CLOSE_DATE,
  CRM_FORECAST_CATEGORY,
  CRM_OBJECT_ID,
  CRM_SOURCE,
  CRM_STAGE,
  CRM_SYNCED_AT,
  FORBIDDEN_FIELD_PATTERNS,
  INTERNAL_CHAT_URL,
  SELLER_PRIVATE_NOTE,
  SELLER_STEP_LABEL,
  SELLER_STEP_OWNER_NAME,
  TEST_APPROVED_EMAIL,
} from "../fixtures/seed-leaky-workspace";

afterEach(() => {
  cleanup();
});

const SELLER_OWNER_EMAIL = "dana@seller-test.invalid";

/** A raw seller-side workspace row, private CRM/chat fields fully populated. */
function makeRawWorkspaceRow(): WorkspaceRow {
  return {
    id: "leak-ws-1",
    tenant_id: "leak-tenant-1",
    target_company_name: "Acme Test Co",
    target_domain: "acme-test.invalid",
    created_by: "seller-user-1",
    approved_emails: [TEST_APPROVED_EMAIL],
    chat_url: "https://chat.example.com/shared/acme-ramp",
    internal_chat_url: INTERNAL_CHAT_URL,
    crm_source: CRM_SOURCE,
    crm_object_id: CRM_OBJECT_ID,
    crm_stage: CRM_STAGE,
    crm_amount: CRM_AMOUNT,
    crm_close_date: CRM_CLOSE_DATE,
    crm_forecast_category: CRM_FORECAST_CATEGORY,
    crm_synced_at: CRM_SYNCED_AT,
  };
}

/**
 * A raw plan tree carrying a populated `private_note` on BOTH a seller-owned
 * and a buyer-owned step — T33-9 requires the leak assertion to hold
 * symmetrically across ownership, not only for the side that happens to get
 * more attention.
 */
function makeRawPlanTree(): PlanTree {
  return {
    id: "leak-plan-1",
    workspace_id: "leak-ws-1",
    title: "Acme x Ramp mutual success plan",
    start_date: "2026-07-01",
    target_date: "2026-09-30",
    status: "active",
    created_at: "2026-07-01T00:00:00+00:00",
    stages: [
      {
        id: "leak-stage-1",
        plan_id: "leak-plan-1",
        title: "Product & proof",
        display_order: 0,
        status: "current",
        steps: [
          {
            id: "leak-seller-step-1",
            stage_id: "leak-stage-1",
            label: SELLER_STEP_LABEL,
            owner_side: "seller",
            owner_name: SELLER_STEP_OWNER_NAME,
            owner_email: SELLER_OWNER_EMAIL,
            due_date: "2026-08-14",
            status: "open",
            display_order: 0,
            completed_at: null,
            completed_by_email: null,
            private_note: SELLER_PRIVATE_NOTE,
          },
          {
            id: "leak-buyer-step-1",
            stage_id: "leak-stage-1",
            label: BUYER_STEP_LABEL,
            owner_side: "buyer",
            owner_name: "Priya Raman",
            owner_email: TEST_APPROVED_EMAIL,
            due_date: "2026-08-20",
            status: "open",
            display_order: 1,
            completed_at: null,
            completed_by_email: null,
            private_note: BUYER_STEP_PRIVATE_NOTE,
          },
        ],
      },
    ],
  };
}

const NO_LINKS: LinkRow[] = [];

/** Raw rows in, rendered HTML string out — mirrors what a real buyer's
 *  browser receives once Ticket 34 mounts this component on a real page. */
function renderBuyerHtml(): string {
  const payload = toBuyerPayload(makeRawWorkspaceRow(), makeRawPlanTree(), NO_LINKS);
  const { container } = render(<BuyerWorkspaceView payload={payload} />);
  return container.innerHTML;
}

describe("T33-9 — private_note is value-level absent from rendered HTML", () => {
  it("omits the seller-owned step's private_note value from the rendered HTML", () => {
    const html = renderBuyerHtml();
    expect(html).not.toContain(SELLER_PRIVATE_NOTE);
  });

  it("omits the buyer-owned step's private_note value from the rendered HTML", () => {
    const html = renderBuyerHtml();
    expect(html).not.toContain(BUYER_STEP_PRIVATE_NOTE);
  });

  it("matches no forbidden field-name pattern anywhere in the rendered HTML (imported, not re-declared)", () => {
    // Reuses the same pattern array tests/security/buyer-boundary.spec.ts and
    // tests/plans/portal-payload.spec.ts assert with — including /private_note/i,
    // /crm_/i, /internal_chat/i, /tenant_id/i, /approved_emails/i, /created_by/i.
    const html = renderBuyerHtml();
    for (const pattern of FORBIDDEN_FIELD_PATTERNS) {
      expect(html).not.toMatch(pattern);
    }
  });

  it("omits every other seller-private value from the rendered HTML (CRM fields, internal chat, owner emails)", () => {
    const html = renderBuyerHtml();
    const forbiddenValues = [
      INTERNAL_CHAT_URL,
      CRM_SOURCE,
      CRM_OBJECT_ID,
      CRM_STAGE,
      CRM_FORECAST_CATEGORY,
      SELLER_OWNER_EMAIL,
      String(CRM_AMOUNT),
      CRM_CLOSE_DATE,
    ];
    for (const forbidden of forbiddenValues) {
      expect(html).not.toContain(forbidden);
    }
  });

  // [Ticket 34, T34-2] DONE, not deferred: BuyerWorkspaceView is now mounted
  // on /portal/[id] and /view/[id] (both loaders no longer hardcode
  // plan: null), so the RSC-flight check this it.todo named is live in
  // tests/security/buyer-boundary.spec.ts's "rendered HTML and RSC flight
  // payload — /portal/[id]" describe block — same fetchHtml() +
  // extractRscFlightPayload() idiom, run against the seeded leaky
  // workspace's populated private_note fields via forbiddenValuesFor(),
  // rather than duplicated here.
});

describe("T33-10 — the asymmetry: seller-owned step LABEL and OWNER survive, private_note does not", () => {
  it("keeps the seller-owned step's label and owner name visible in the rendered HTML", () => {
    // THE PRODUCT GUARANTEE (T33-6): a buyer must still see what the seller
    // has committed to. A renderer that stripped seller-owned steps entirely
    // would pass every leak assertion in this file and be the wrong fix.
    const html = renderBuyerHtml();
    expect(html).toContain(SELLER_STEP_LABEL);
    expect(html).toContain(SELLER_STEP_OWNER_NAME);
  });

  it("marks the seller-owned step with its dot-plus-text ownership label ('Seller'), not colour alone", () => {
    const payload = toBuyerPayload(makeRawWorkspaceRow(), makeRawPlanTree(), NO_LINKS);
    const { getByTestId } = render(<BuyerWorkspaceView payload={payload} />);
    const sellerStepEl = getByTestId("buyer-step-leak-seller-step-1");
    expect(sellerStepEl).toHaveAttribute("data-owner", "seller");
    expect(sellerStepEl.textContent).toContain("Seller");
  });

  it("strips private_note from that same visible seller-owned step, in the same render pass", () => {
    // Same render, same step — proves the label/owner presence above and the
    // private_note absence are true of ONE step simultaneously, not of two
    // different renders that could each individually look correct.
    const html = renderBuyerHtml();
    expect(html).toContain(SELLER_STEP_LABEL);
    expect(html).not.toContain(SELLER_PRIVATE_NOTE);
  });

  it("holds the same asymmetry for the buyer-owned step (label present, private_note absent)", () => {
    const html = renderBuyerHtml();
    expect(html).toContain(BUYER_STEP_LABEL);
    expect(html).not.toContain(BUYER_STEP_PRIVATE_NOTE);
  });
});
