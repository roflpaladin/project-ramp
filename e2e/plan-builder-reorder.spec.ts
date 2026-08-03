// Ticket 29, T29-8 (QA) — the two interaction specs Decision 10 calls for.
// Local-run only, NOT a CI job (see playwright.config.ts's header comment).
//
// Reuses startLiveServer() (tests/security/support/live-server.ts) rather
// than standing up a second boot mechanism — via
// playwright.config.ts's globalSetup (e2e/support/global-setup.ts), which
// calls it out-of-process (see that file's header comment for exactly why:
// live-server.ts's `import.meta.url` cannot be loaded through Playwright's
// own CJS-only TS transform, confirmed for both a static and a dynamic
// import()). This file itself never touches live-server.ts — by the time
// its beforeAll runs, globalSetup has already started the one real server
// the whole run shares, on the fixed baseURL below.
//
// Also reuses buildSellerCookieHeader
// (tests/security/support/seller-http-session.ts, via
// e2e/support/browser-auth.ts) for the seller sign-in itself. Seeding uses
// e2e/support/seed-plan-builder-workspace.ts instead of
// tests/fixtures/seed-leaky-workspace.ts — see that file's header comment
// for exactly why (the "server-only" import guard on lib/supabase/admin.ts
// blocks importing the real fixture outside Next's own bundler, the same
// family of problem as live-server.ts's import.meta.url).

import { test, expect, type BrowserContext } from "@playwright/test";
import { signInSellerInto } from "./support/browser-auth";
import {
  deleteStepDirectly,
  seedPlanBuilderWorkspace,
  teardownPlanBuilderWorkspace,
  STEP_A_LABEL,
  STEP_B_LABEL,
  STEP_C_LABEL,
  STEP_C_ID,
  type SeededPlanBuilderWorkspace,
} from "./support/seed-plan-builder-workspace";

test.describe.configure({ mode: "serial" });

let seeded: SeededPlanBuilderWorkspace;

test.beforeAll(async () => {
  await teardownPlanBuilderWorkspace();
  seeded = await seedPlanBuilderWorkspace();
});

test.afterAll(async () => {
  await teardownPlanBuilderWorkspace();
});

async function signInAndGoToPlan(context: BrowserContext, page: import("@playwright/test").Page, baseURL: string) {
  await signInSellerInto(context, baseURL, seeded.ownerEmail, seeded.ownerPassword);
  await page.goto(`/admin/workspaces/${seeded.workspaceId}/plan`);
}

test("keyboard-only reorder: tabbing to a step's move-down button and activating it with Enter reorders the list, and the new order survives a reload", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAndGoToPlan(context, page, baseURL!);

  const stageTwo = page.locator("section.plan-stage", { hasText: "Delivery" });
  await expect(stageTwo.locator(".plan-step-title")).toHaveText([STEP_A_LABEL, STEP_B_LABEL, STEP_C_LABEL]);

  const moveDownLabel = `Move '${STEP_A_LABEL}' down`;

  // Real Tab-key traversal from an unfocused page — this proves the button
  // is reachable by keyboard, not merely activatable once focused by other
  // means (e.g. .focus()).
  const MAX_TAB_PRESSES = 300;
  let reached = false;
  for (let i = 0; i < MAX_TAB_PRESSES; i++) {
    await page.keyboard.press("Tab");
    const activeLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
    if (activeLabel === moveDownLabel) {
      reached = true;
      break;
    }
  }
  expect(reached, `did not Tab-reach button aria-label="${moveDownLabel}" within ${MAX_TAB_PRESSES} presses`).toBe(
    true,
  );

  // No mouse from here on — keyboard activation only.
  await page.keyboard.press("Enter");

  await expect(stageTwo.locator(".plan-step-title")).toHaveText([STEP_B_LABEL, STEP_A_LABEL, STEP_C_LABEL]);

  // The authoritative order (not just client state) must have actually
  // changed server-side: reloading re-fetches the Server Component.
  await page.reload();
  await expect(stageTwo.locator(".plan-step-title")).toHaveText([STEP_B_LABEL, STEP_A_LABEL, STEP_C_LABEL]);
});

test("optimistic revert: a reorder the server rejects (REORDER_SET_MISMATCH) visibly reverts to the server order, not the optimistic one", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAndGoToPlan(context, page, baseURL!);

  const stageTwo = page.locator("section.plan-stage", { hasText: "Delivery" });
  const initialOrder = await stageTwo.locator(".plan-step-title").allTextContents();

  // Force a REORDER_SET_MISMATCH: delete a stage-two step directly in the DB
  // (bypassing the UI entirely) so the id set this already-rendered page
  // will submit (still containing the now-deleted step) no longer matches
  // 0007_plan_reorder.sql's server-side exact-set check for that stage. This
  // is the same "the plan changed elsewhere" race the AC exists to guard
  // against, produced for real rather than mocked.
  await deleteStepDirectly(STEP_C_ID);

  await page.getByRole("button", { name: `Move '${STEP_A_LABEL}' down`, exact: true }).click();

  // The rejection surfaces as a visible error...
  await expect(page.locator(".plan-error")).toHaveText(/plan changed elsewhere/i);

  // ...and the optimistic reorder is not left standing: the visible order
  // reverts to exactly what the page had before the click.
  await expect(stageTwo.locator(".plan-step-title")).toHaveText(initialOrder);
});
