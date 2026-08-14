// T35-9 (Sprint 7, Ticket 35; plans/sprint-6-7-replan.md §7 — QA, decision
// 10). LOCAL-RUN ONLY, not a CI job — see playwright.config.ts's header
// comment: this suite gets its own job if it is ever promoted to CI, never
// the secret-gated vitest "security" job. HIGH priority, not the merge
// blocker for Ticket 35 (T39-3 is).
//
// Every other test proving POST /api/steps/[id]/complete's contract
// (tests/security/step-completion.spec.ts, and the Tier 2 assertions in
// tests/security/buyer-boundary.spec.ts) builds its own signed session
// cookie by calling createPortalSessionValue() directly and attaching it by
// hand to a bare fetch(). That is the right tool for testing the ROUTE's own
// branch matrix, but it never proves the session a real buyer actually gets
// — minted by verifyAccess (app/portal/[id]/gate-actions.ts) after a real
// code-entry form submit, carried by a real browser cookie jar through a
// real redirect — is the SAME session the completion endpoint accepts. This
// file is the only one that drives that whole path for real: real
// verify-code form through /portal/[id], land authenticated, then complete a
// step using the browser's own cookie jar (never a hand-built cookie
// header), and confirm the row updates.
//
// KNOWN GAP, reported in this ticket's QA pass rather than silently worked
// around: components/buyer/buyer-workspace-view.tsx renders NO "mark
// complete" affordance yet — StepRow (that file) has no button and issues no
// fetch to /api/steps/[id]/complete anywhere in app/ or components/. The
// route's own gate-actions.ts comment ("...and later to
// /api/steps/[id]/complete") confirms this wiring is explicitly deferred to
// a future ticket, not an oversight. Until that UI ships, "complete a step
// through the actual UI" literally cannot be driven by a Playwright click —
// there is no button to click. What this spec does instead, and what it
// still proves: page.evaluate() issues `fetch(..., { credentials:
// "same-origin" })` from INSIDE the already-authenticated page's own
// JavaScript context, which sends the browser's REAL httpOnly session
// cookie automatically, exactly as a future "mark complete" button's own
// onClick handler would. This is the strongest available proof, today, that
// the session survives the full navigation -> API-call path; it is not yet
// a proof that a real button click drives it, because no such button exists.
// Re-point this spec's Act step at a real `getByRole("button", { name: /mark
// (this )?(step )?(as )?(complete|done)/i }).click()` the moment that UI
// lands, and delete this comment block.

import { test, expect } from "@playwright/test";
import {
  BUYER_STEP_LABEL,
  readStepRow,
  seedStepCompletionWorkspace,
  teardownStepCompletionWorkspace,
  type SeededStepCompletionWorkspace,
} from "./support/seed-step-completion-workspace";

test.describe.configure({ mode: "serial" });

let seeded: SeededStepCompletionWorkspace;

test.beforeAll(async () => {
  await teardownStepCompletionWorkspace();
  seeded = await seedStepCompletionWorkspace();
});

test.afterAll(async () => {
  await teardownStepCompletionWorkspace();
});

test("a buyer who verifies through the real code-entry gate can complete their own step, and the session survives the navigation -> API-call path", async ({
  page,
}) => {
  const before = await readStepRow(seeded.stepId);
  expect(before?.status).toBe("open");
  expect(before?.completed_by_email).toBeNull();

  // Real gate entry, exactly as e2e/portal-view-analytics.spec.ts drives it:
  // land on the code-entry step the emailed link would put a buyer on.
  await page.goto(`/portal/${seeded.workspaceId}?stage=verify&email=${encodeURIComponent(seeded.buyerEmail)}`);
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();

  // Real form, real Server Action, real click.
  await page.locator('input[name="token"]').fill(seeded.code);
  await page.getByRole("button", { name: "Verify" }).click();

  // Lands authenticated: verifyAccess redirects to the bare workspace URL on
  // success, and the granted render mounts BuyerWorkspaceView.
  await expect(page).toHaveURL(new RegExp(`/portal/${seeded.workspaceId}$`));
  await expect(page.locator('[data-testid="buyer-workspace"]')).toBeVisible();
  await expect(page.locator(`[data-testid="buyer-step-${seeded.stepId}"]`)).toContainText(BUYER_STEP_LABEL);

  // See this file's header comment for exactly why this is a page.evaluate()
  // fetch and not a button click: no completion affordance exists in the UI
  // yet. Deliberately NO cookie header is set by hand here — `fetch` from
  // inside the page's own context sends the browser's real httpOnly session
  // cookie automatically, the same mechanism a real button's onClick would
  // rely on.
  const result = await page.evaluate(async (stepId) => {
    const response = await fetch(`/api/steps/${stepId}/complete`, {
      method: "POST",
      credentials: "same-origin",
    });
    return { status: response.status, body: await response.json() };
  }, seeded.stepId);

  expect(result.status).toBe(200);
  expect(result.body.data.id).toBe(seeded.stepId);
  expect(result.body.data.status).toBe("done");

  const after = await readStepRow(seeded.stepId);
  expect(after?.status).toBe("done");
  // The SESSION's own email (the one just verified through the real gate),
  // never anything the test hand-supplied.
  expect(after?.completed_by_email).toBe(seeded.buyerEmail);
  expect(after?.completed_at).toBeTruthy();
});
