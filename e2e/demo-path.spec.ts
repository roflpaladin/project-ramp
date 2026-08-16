// T44 (Sprint 8, Ticket 44 — Sep-1 demo-readiness QA gate). The demo path,
// driven through the REAL browser surfaces end-to-end, now including the T41
// guided onboarding (Ticket 41, Session B — selector contract handed over
// 2026-08-16): registration → /admin/onboarding → either population path →
// own-inbox buyer invite → the one-click flip into the live buyer portal.
// This is the exact sequence the founder performs live on Sep 1; it must
// pass on a prod-like environment every few days, freeze Aug 28.
//
// Local-run only, NOT a CI job (playwright.config.ts's header; decision 10).
// Run: npx playwright test e2e/demo-path.spec.ts
//
// Prerequisites treated as part of the gate, not skippable env noise (a demo
// env missing them fails the demo too): SMTP_* configured (the invite is a
// REAL email; per-run @example.com recipients bounce harmlessly), T39/T41/
// T43 surfaces live on the server under test.
//
// Each journey registers a FRESH seller (T41's onboarding actions are
// rate-limited 5/15min per seller; fresh-seller-per-run never hits it — per
// the T41 handoff). Seeding: NONE — self-serve provisioning is itself under
// test. Cleanup reconstructs the service-role client inline (same reason as
// e2e/support/seed-plan-builder-workspace.ts: lib/supabase/admin.ts's
// `server-only` guard can't be imported under Playwright's transform).

import { randomUUID } from "node:crypto";

import { test, expect, type Page } from "@playwright/test";
import { createClient as createServiceClient } from "@supabase/supabase-js";

test.describe.configure({ mode: "serial" });

const runId = randomUUID().slice(0, 8);

interface JourneySeller {
  readonly email: string;
  readonly password: string;
  readonly company: string;
}

const manualSeller: JourneySeller = {
  email: `t44-manual-${runId}@example.com`,
  password: `demo-path-${runId}-x9`,
  company: `T44 manual seller ${runId}`,
};
const sampleSeller: JourneySeller = {
  email: `t44-sample-${runId}@example.com`,
  password: `demo-path-${runId}-y7`,
  company: `T44 sample seller ${runId}`,
};

const targetCompany = `T44 demo target ${runId}`;
const targetDomain = `t44-${runId}.example.com`;

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } },
  );
}

/** Registers a fresh seller through the real /register form and lands on the
 * T41 onboarding chooser (fresh registrations redirect there — T41). */
async function registerAndReachOnboarding(page: Page, seller: JourneySeller): Promise<void> {
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your Brava account" })).toBeVisible();
  await page.locator('input[name="companyName"]').fill(seller.company);
  await page.locator('input[name="email"]').fill(seller.email);
  await page.locator('input[name="password"]').fill(seller.password);
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL("**/admin/onboarding");
  await expect(page.locator('main[data-testid="onboarding-flow"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up your first deal" })).toBeVisible();
}

test.afterAll(async () => {
  // Everything both journeys created is reachable from the two per-run
  // sellers: their claim → tenant → workspaces → plan tree/links/tokens/
  // analytics. Each delete independent (shared dev DB; see handover §1).
  const admin = serviceClient();
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

  for (const seller of [manualSeller, sampleSeller]) {
    const user = users?.users.find((u) => u.email?.toLowerCase() === seller.email);
    if (!user) continue;
    const tenantId = user.app_metadata?.tenant_id as string | undefined;

    if (tenantId) {
      const { data: workspaces } = await admin
        .from("workspaces")
        .select("id")
        .eq("tenant_id", tenantId);

      for (const workspace of workspaces ?? []) {
        const { data: plans } = await admin
          .from("success_plans")
          .select("id")
          .eq("workspace_id", workspace.id);
        for (const plan of plans ?? []) {
          const { data: stages } = await admin.from("plan_stages").select("id").eq("plan_id", plan.id);
          const stageIds = (stages ?? []).map((stage) => stage.id);
          if (stageIds.length > 0) await admin.from("plan_steps").delete().in("stage_id", stageIds);
          await admin.from("plan_stages").delete().eq("plan_id", plan.id);
          await admin.from("success_plans").delete().eq("id", plan.id);
        }
        for (const table of ["portal_access_tokens", "workspace_analytics", "links"]) {
          await admin.from(table).delete().eq("workspace_id", workspace.id);
        }
        await admin.from("workspaces").delete().eq("id", workspace.id);
      }
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    await admin.auth.admin.deleteUser(user.id);
  }
});

test("manual path: registration → onboarding → first workspace → own-inbox invite → flip into the buyer portal", async ({
  page,
}) => {
  await registerAndReachOnboarding(page, manualSeller);

  // T41 manual population path (advances client-side, no route change).
  await page.getByRole("button", { name: "Set up manually" }).click();
  await expect(page.getByRole("heading", { name: "Create your first workspace" })).toBeVisible();
  await page.getByLabel("Company name").fill(targetCompany);
  await page.getByLabel("Their website domain").fill(targetDomain);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL(/\/admin\/workspaces\/[0-9a-f-]+$/);

  // Own-inbox invite (T43) — a REAL SMTP send.
  await expect(page.getByRole("heading", { name: "Invite your buyer" })).toBeVisible();
  await page.getByRole("button", { name: "Use my email" }).click();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(
    page.getByText(`Invite sent to ${manualSeller.email}`),
    "invite send failed — if the message shows a send error, check SMTP_* env on the environment under test (that is itself a demo blocker)",
  ).toBeVisible({ timeout: 20_000 });

  // The flip — one click, REAL /portal/[id], no simulated preview. Post-#40
  // the flip is restricted to the seller's own inbox, which is exactly what
  // was invited above.
  await page.getByRole("button", { name: "Open buyer view" }).click();
  await page.waitForURL(/\/portal\/[0-9a-f-]+$/);

  await expect(page.getByRole("heading", { name: "Deal Room Access" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Enter your code" })).toHaveCount(0);
  await expect(page.getByText(targetCompany).first()).toBeVisible();
});

test("sample path: registration → onboarding → 'Start with a sample deal' lands in the populated Meridian workspace", async ({
  page,
}) => {
  await registerAndReachOnboarding(page, sampleSeller);

  // The chooser's sole Signal element per the T41 contract.
  const sampleButton = page.getByRole("button", { name: "Start with a sample deal" });
  await expect(sampleButton).toHaveAttribute("data-signal", "true");

  const startedAt = Date.now();
  await sampleButton.click();

  // Server redirect straight into the freshly seeded sample workspace.
  await page.waitForURL(/\/admin\/workspaces\/[0-9a-f-]+$/);
  await expect(page.getByText("Sample deal — Meridian Retail Group").first()).toBeVisible();

  // T42's AC is <10s for the seed itself; the whole click→rendered-workspace
  // round trip staying inside it is a stricter, demo-realistic bound.
  expect(Date.now() - startedAt).toBeLessThan(10_000);
});
