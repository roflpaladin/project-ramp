// T34-9 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7). Proves, live
// end-to-end over HTTP via a real browser, what
// tests/security/portal-view-analytics.spec.ts only proves at the unit
// level (verifyAccess called directly, next/headers and @/lib/supabase/admin
// mocked): visiting /portal/[id] THROUGH THE REAL GATE writes exactly one
// portal_view analytics row, and — the part a unit test cannot show at all,
// since it never renders a page twice — that reloading the already-granted
// page does not add a second row.
//
// "Through the real gate" specifically means driving the real code-entry
// FORM (a genuine POST to the real Server Action, with the exact per-render
// encrypted action reference a hand-built fetch() cannot reliably
// reconstruct — see tests/security/buyer-boundary.spec.ts's own comment on
// why its oracle-normalisation strips exactly this), not injecting a signed
// session cookie directly the way tests/security/buyer-surface-parity.spec.ts
// does for ITS (unrelated) content-equality claim. requestAccess's own
// email-send step is deliberately NOT exercised here — e2e/support/
// seed-portal-view-workspace.ts seeds a known code directly — because
// that step is already covered by tests/api/send-token.spec.ts (T34-10) and
// exercising it live would burn nodemailer's ~2-minute connection timeout
// against this repo's placeholder .env.local SMTP_HOST for no assertion
// this file makes.
//
// Reuses the SAME live-server boot (playwright.config.ts's globalSetup) and
// the SAME "e2e/support/seed-*-workspace.ts reimplements the service-role
// client" idiom as e2e/plan-builder-reorder.spec.ts — see that file's header
// comment and e2e/support/seed-portal-view-workspace.ts's for why.

import { test, expect } from "@playwright/test";
import {
  countPortalViewRows,
  seedPortalViewWorkspace,
  teardownPortalViewWorkspace,
  type SeededPortalViewWorkspace,
} from "./support/seed-portal-view-workspace";

test.describe.configure({ mode: "serial" });

let seeded: SeededPortalViewWorkspace;

test.beforeAll(async () => {
  await teardownPortalViewWorkspace();
  seeded = await seedPortalViewWorkspace();
});

test.afterAll(async () => {
  await teardownPortalViewWorkspace();
});

test("visiting /portal/[id] through the real magic-link gate writes exactly one portal_view row, and reloading the granted page does not add another", async ({
  page,
}) => {
  expect(await countPortalViewRows()).toBe(0);

  // Land directly on the code-entry step, exactly as a buyer following the
  // emailed link would (app/portal/[id]/page.tsx renders this branch purely
  // off `?stage=verify&email=...`, independent of whether requestAccess was
  // the thing that put them there) — see this file's header comment for why
  // requestAccess's own POST is not driven here.
  await page.goto(`/portal/${seeded.workspaceId}?stage=verify&email=${encodeURIComponent(seeded.buyerEmail)}`);
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();

  // Real form, real Server Action, real click — the exact mechanism a
  // hand-built fetch() cannot reliably reproduce (see header comment).
  await page.locator('input[name="token"]').fill(seeded.code);
  await page.getByRole("button", { name: "Verify" }).click();

  // verifyAccess redirects to the bare workspace URL on success, which then
  // renders BuyerWorkspaceView (T34-2) — its root marker is the stable
  // signal the granted branch (not a re-shown, errored gate) is what
  // actually loaded.
  await expect(page).toHaveURL(new RegExp(`/portal/${seeded.workspaceId}$`));
  await expect(page.locator('[data-testid="buyer-workspace"]')).toBeVisible();

  expect(await countPortalViewRows()).toBe(1);

  // The part a unit test cannot show: an RSC render re-running, or a plain
  // browser refresh, on an ALREADY-granted page must not write a second row
  // — T34-4's whole point (portal_view moved to the gate action, fired once
  // per entry, specifically because the old render-time write could
  // duplicate on a re-run).
  await page.reload();
  await expect(page.locator('[data-testid="buyer-workspace"]')).toBeVisible();
  expect(await countPortalViewRows()).toBe(1);

  await page.reload();
  await expect(page.locator('[data-testid="buyer-workspace"]')).toBeVisible();
  expect(await countPortalViewRows()).toBe(1);
});
