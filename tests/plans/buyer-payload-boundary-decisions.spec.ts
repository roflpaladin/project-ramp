// Sprint 7 · Ticket 33, T33-8 (plans/sprint-6-7-replan.md §7, decision 6).
//
// This file is documentation that executes. It exists so the next engineer who
// touches lib/portal-payload.ts or components/buyer/buyer-workspace-view.tsx
// meets three RULINGS already made, instead of re-discovering the asymmetry
// mid-debug (as T33-2's header on the renderer explains it once already —
// this file is what makes that explanation a compile-time and run-time
// guarantee rather than a comment someone can stop believing).
//
// THE THREE DECISIONS
//
//   1. The ROOT `BuyerPayload` is structurally INCOMPATIBLE with a raw
//      workspace row, by design. Assigning a raw row where a BuyerPayload is
//      expected is a compile error. Ticket 25 built this; this file re-proves
//      it as a positive control (`@ts-expect-error` — the test FAILS to
//      typecheck, i.e. `npm run typecheck` breaks, the day someone widens
//      BuyerPayload enough to make the two compatible).
//
//   2. The SUB-SHAPES — BuyerStep, BuyerStage, BuyerPlan, BuyerWorkspace —
//      ARE structurally assignable FROM their raw counterparts, by design,
//      and TypeScript's structural typing cannot prevent that at this level:
//      extra (private) fields on a wider raw type never break a narrower
//      assignment. These are POSITIVE assertions (no @ts-expect-error) that
//      fail to typecheck the day someone "fixes" this by adding a branded /
//      nominal field to a Buyer* type without it being a real decision — that
//      would be a silent, undiscussed change to a documented ruling.
//
//   3. The MODULE BOUNDARY closes the gap decision 2 leaves open:
//      components/buyer/buyer-workspace-view.tsx exports exactly one thing
//      (`BuyerWorkspaceView`); every subcomponent that could accept a bare
//      Buyer* sub-shape as a prop is unexported, so the unsafe assignment in
//      decision 2 has no call site anyone outside this file can ever write.
//      Asserted two ways: a compile-time check on the module's export-surface
//      TYPE, and a run-time check on its actual exported keys — both without
//      importing the .tsx module's JSX at run time (see the note above that
//      assertion).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { BuyerPayload, BuyerPlan, BuyerStage, BuyerStep, BuyerWorkspace, WorkspaceRow } from "@/lib/portal-payload";
import type { PlanStage, PlanStageRow, PlanStepRow, PlanTree } from "@/lib/plans/types";
// Type-only import, deliberately: `import type` is erased by the TS
// transform before this file ever reaches Vitest's module loader, so this
// spec never actually EXECUTES buyer-workspace-view.tsx's JSX. That matters
// because this file runs under the "security" Vitest project (plain Node
// environment, no @vitejs/plugin-react — see vitest.config.ts), which is the
// same reason tests/security/crm-import-boundary.spec.ts reads source files
// as text instead of importing them. `typeof` on a type-only namespace
// import still gives TypeScript the module's real export-surface type,
// computed by static analysis, which is exactly what decision 3's
// compile-time assertion needs.
import type * as BuyerWorkspaceViewModule from "@/components/buyer/buyer-workspace-view";

// ── A minimal, local type-equality check ───────────────────────────────────
// No type-testing library exists in this repo (grepped for
// Assignable/Expect/type Equal/ts-expect-error under tests/ and lib/ before
// writing this) and pulling one in for two assertions would be exactly the
// speculative-generality YAGNI warns against. This is the standard
// "distributive conditional" equality trick (tsd/expect-type use the same
// shape); kept local and undocumented-beyond-this-comment on purpose.
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// ── Fixture builders — plain data, no Supabase, no I/O ─────────────────────
// This file tests TYPES, not the database. Every "row" below is a hand-built
// object literal satisfying the raw types in lib/plans/types.ts and
// lib/portal-payload.ts, immutable (a fresh object per call, nothing
// mutated) and disposable.

function makeRawWorkspaceRow(): WorkspaceRow {
  return {
    id: "workspace-1",
    tenant_id: "tenant-1",
    target_company_name: "Acme Corp",
    target_domain: "acme.example.com",
    created_by: "seller-user-1",
    approved_emails: ["buyer@acme.example.com"],
    chat_url: "https://chat.example.com/room",
    internal_chat_url: "https://chat.example.com/internal-war-room",
    crm_source: "salesforce",
    crm_object_id: "opp-1",
    crm_stage: "negotiation",
    crm_amount: 50_000,
    crm_close_date: "2026-09-01",
    crm_forecast_category: "commit",
    crm_synced_at: "2026-08-01T00:00:00+00:00",
  };
}

function makeRawPlanStepRow(): PlanStepRow {
  return {
    id: "step-1",
    stage_id: "stage-1",
    label: "Provision sandbox",
    owner_side: "seller",
    owner_name: "Dana",
    owner_email: "dana@vendor.example.com",
    due_date: "2026-08-20",
    status: "open",
    display_order: 0,
    completed_at: null,
    completed_by_email: null,
    private_note: "Buyer is price-sensitive — do not discount below list.",
  };
}

function makeRawPlanStage(): PlanStage {
  return {
    id: "stage-1",
    plan_id: "plan-1",
    title: "Security review",
    display_order: 0,
    status: "current" as PlanStageRow["status"],
    steps: [makeRawPlanStepRow()],
  };
}

function makeRawPlanTree(): PlanTree {
  return {
    id: "plan-1",
    workspace_id: "workspace-1",
    title: "Onboarding plan",
    start_date: "2026-08-01",
    target_date: "2026-09-15",
    status: "active",
    created_at: "2026-07-05T14:00:00+00:00",
    stages: [makeRawPlanStage()],
  };
}

describe("decision 1 — BuyerPayload is INCOMPATIBLE with a raw workspace row (positive control)", () => {
  it("fails to typecheck when a raw workspace row is assigned where a BuyerPayload is expected", () => {
    const rawWorkspaceRow = makeRawWorkspaceRow();

    // POSITIVE CONTROL: if BuyerPayload is ever widened enough for a raw row
    // to satisfy it, this directive becomes unused and `npm run typecheck`
    // fails on THIS line — that is the intended failure mode, not a bug in
    // the test. Mirrors tests/plans/portal-payload.spec.ts's own control for
    // the same root type.
    // @ts-expect-error — DECISION 1: a raw workspace row has no `workspace` /
    // `plan` / `resources` keys at all and must never satisfy BuyerPayload.
    const incompatible: BuyerPayload = rawWorkspaceRow;

    expect(incompatible).toBeDefined();
  });
});

describe("decision 2 — the sub-shapes ARE assignable FROM their raw counterparts (documented, not a bug)", () => {
  // Every assertion below is the POSITIVE case: no @ts-expect-error. Each one
  // fails to typecheck — a real, visible break, not a silent one — the day a
  // Buyer* type gains a field the raw row cannot supply (a brand, a nominal
  // tag) without that being a deliberate, reviewed decision.

  it("BuyerStep is assignable from a raw PlanStepRow", () => {
    const rawStep = makeRawPlanStepRow();
    // `private_note`, `owner_email` and `completed_by_email` ride along on
    // `rawStep` — TypeScript's structural typing does not care that they are
    // seller-private; extra fields never break a narrower assignment. That is
    // exactly the gap the module boundary (decision 3) has to close.
    const asBuyerStep: BuyerStep = rawStep;

    expect(asBuyerStep.id).toBe(rawStep.id);
  });

  it("BuyerStage is assignable from a raw PlanStage (private_note reachable through .steps)", () => {
    const rawStage = makeRawPlanStage();
    const asBuyerStage: BuyerStage = rawStage;

    expect(asBuyerStage.steps).toHaveLength(1);
  });

  it("BuyerPlan is assignable from a raw PlanTree", () => {
    const rawPlan = makeRawPlanTree();
    const asBuyerPlan: BuyerPlan = rawPlan;

    expect(asBuyerPlan.stages).toHaveLength(1);
  });

  it("BuyerWorkspace is assignable from a raw workspace row (crm_*, internal_chat_url and all)", () => {
    const rawWorkspaceRow = makeRawWorkspaceRow();
    const asBuyerWorkspace: BuyerWorkspace = rawWorkspaceRow;

    expect(asBuyerWorkspace.target_company_name).toBe(rawWorkspaceRow.target_company_name);
  });
});

describe("decision 3 — the module boundary closes the gap decision 2 leaves open", () => {
  it("[compile-time] components/buyer/buyer-workspace-view.tsx's export-surface type is exactly { BuyerWorkspaceView }", () => {
    // If this line fails to typecheck, either a new export was added to the
    // module (widening what an external caller could import and hand a raw
    // sub-shape to) or BuyerWorkspaceView was renamed — either way, a
    // decision the next engineer needs to see, not silently accept.
    type ModuleExportKeys = keyof typeof BuyerWorkspaceViewModule;
    type _ExportSurfaceIsExactlyOneEntryPoint = Expect<Equal<ModuleExportKeys, "BuyerWorkspaceView">>;
    const assertion: _ExportSurfaceIsExactlyOneEntryPoint = true;

    expect(assertion).toBe(true);
  });

  it("[run-time] the module's only top-level `export` statement declares BuyerWorkspaceView", () => {
    // Reads the file as TEXT rather than importing it — this project has no
    // JSX transform (see the header note above the type-only import), and
    // the run-time "exports exactly one thing" check on the ACTUAL executed
    // module already lives in
    // tests/components/buyer-workspace-view.dom.spec.tsx, which does run
    // under the happy-dom/react project. This assertion is deliberately
    // independent of that one: it reads the source directly, so it still
    // catches a second export even in a hypothetical world where the
    // component test above stopped enumerating Object.keys correctly.
    const modulePath = fileURLToPath(
      new URL("../../components/buyer/buyer-workspace-view.tsx", import.meta.url),
    );
    const source = readFileSync(modulePath, "utf8");

    // Top-level (column-zero) `export` statements only — deliberately not
    // matching indented text inside a template literal or comment.
    const topLevelExports = source.match(/^export\s+.+$/gm) ?? [];

    expect(topLevelExports).toHaveLength(1);
    expect(topLevelExports[0]).toMatch(/^export function BuyerWorkspaceView\b/);
  });
});
