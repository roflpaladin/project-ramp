// T44 (Sprint 8, Ticket 44 — Sep-1 demo-readiness QA gate). The demo path,
// driven through the REAL browser surfaces end-to-end: self-serve
// registration → first-workspace creation → own-inbox buyer invite → the
// one-click flip into the live buyer portal. This is the exact sequence the
// founder performs live on Sep 1; it must pass on a prod-like environment
// every few days through the sprint, with an internal freeze on Aug 28.
//
// Local-run only, NOT a CI job (playwright.config.ts's header; decision 10).
// Run: npx playwright test e2e/demo-path.spec.ts
//
// Prerequisites this spec deliberately treats as part of the gate, not as
// skippable environment noise (a demo env missing them fails the demo too):
//   - SMTP_* configured (invite send is a REAL email; the address invited is
//     a per-run @example.com one, so the relay accept-then-bounces — the
//     flip never needs the inbox, only a successful send)
//   - the registration surface live (T39) and invite panel (T43) on the
//     server under test
//
// The onboarding/sample-deal step (T41, Session B, in flight) has a fixme
// placeholder at the bottom — wire it in when T41 merges rather than letting
// the gate silently under-cover the flow.
//
// Seeding: NONE. Registration through the real /register form creates the
// tenant/user this run uses — auto-provisioning is itself under test.
// Cleanup reconstructs the service-role client inline (same reason as
// e2e/support/seed-plan-builder-workspace.ts: lib/supabase/admin.ts's
// `server-only` guard can't be imported under Playwright's transform).

import { randomUUID } from "node:crypto";

import { test, expect } from "@playwright/test";
import { createClient as createServiceClient } from "@supabase/supabase-js";

test.describe.configure({ mode: "serial" });

const runId = randomUUID().slice(0, 8);
const sellerEmail = `t44-demo-${runId}@example.com`;
const sellerPassword = `demo-path-${runId}-x9`;
const sellerCompany = `T44 demo seller ${runId}`;
const targetCompany = `T44 demo target ${runId}`;
const targetDomain = `t44-${runId}.example.com`;

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } },
  );
}

test.afterAll(async () => {
  // Everything this run created is anchored on the per-run target_domain and
  // the per-run seller email; each delete is independent so one failure
  // can't strand the rest (shared dev DB — see the Session B handover §1).
  const admin = serviceClient();

  const { data: workspaces } = await admin
    .from("workspaces")
    .select("id, tenant_id")
    .eq("target_domain", targetDomain);

  for (const workspace of workspaces ?? []) {
    for (const table of ["portal_access_tokens", "workspace_analytics", "links"]) {
      await admin.from(table).delete().eq("workspace_id", workspace.id);
    }
    await admin.from("workspaces").delete().eq("id", workspace.id);
    await admin.from("tenants").delete().eq("id", workspace.tenant_id);
  }

  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const created = users?.users.find((u) => u.email?.toLowerCase() === sellerEmail);
  if (created) {
    // Registration creates the tenant before the workspace exists, so if the
    // run died before workspace creation the tenant is only reachable via
    // the user's claim.
    const claimTenant = created.app_metadata?.tenant_id as string | undefined;
    if (claimTenant) await admin.from("tenants").delete().eq("id", claimTenant);
    await admin.auth.admin.deleteUser(created.id);
  }
});

test("registration → first workspace → own-inbox invite → flip lands in the real buyer portal", async ({
  page,
}) => {
  // 1. Self-serve registration (T39) — creates tenant + claim-bearing user.
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your Brava account" })).toBeVisible();
  await page.locator('input[name="companyName"]').fill(sellerCompany);
  await page.locator('input[name="email"]').fill(sellerEmail);
  await page.locator('input[name="password"]').fill(sellerPassword);
  await page.getByRole("button", { name: "Create account" }).click();

  // Lands signed-in on /admin with the fresh-tenant empty state.
  await page.waitForURL("**/admin");
  const createFirst = page.getByRole("link", { name: "Create your first workspace" });
  await expect(createFirst, "fresh seller must land on the first-workspace prompt (T39 AC)").toBeVisible();

  // 2. First workspace.
  await createFirst.click();
  await page.locator('input[name="target_company_name"]').fill(targetCompany);
  await page.locator('input[name="target_domain"]').fill(targetDomain);
  await page.getByRole("button", { name: "Create Workspace" }).click();
  await page.waitForURL(/\/admin\/workspaces\/[0-9a-f-]+$/);

  // 3. Own-inbox invite (T43). "Use my email" pre-fills the signed-in
  // seller's address; the send is a REAL SMTP send (bounces harmlessly for
  // the @example.com run address).
  await expect(page.getByRole("heading", { name: "Invite your buyer" })).toBeVisible();
  await page.getByRole("button", { name: "Use my email" }).click();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(
    page.getByText(`Invite sent to ${sellerEmail}`),
    "invite send failed — if the message shows a send error, check SMTP_* env on the environment under test (that is itself a demo blocker)",
  ).toBeVisible({ timeout: 20_000 });

  // 4. The flip — one click, REAL /portal/[id], no simulated preview.
  await page.getByRole("button", { name: "Open buyer view" }).click();
  await page.waitForURL(/\/portal\/[0-9a-f-]+$/);

  // Buyer surface, not the code-entry gate: the flip minted the portal
  // session cookie, so the gate must not appear...
  await expect(page.getByRole("heading", { name: "Deal Room Access" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Enter your code" })).toHaveCount(0);
  // ...and the deal room renders the target company the seller just set up.
  await expect(page.getByText(targetCompany).first()).toBeVisible();
});

// T41 (Session B, in flight) — when the guided onboarding merges, replace
// this with the real steps: create workspace → choose "start with a sample
// deal" → assert the Meridian skeleton renders (<10s), then continue into
// the invite + flip above FROM the onboarding flow rather than the bare
// admin surface. A fixme (not skip) so the gate visibly reports the
// missing coverage on every run until it lands.
test.fixme("onboarding chooses the sample-deal path and lands in a populated workspace (T41)", async () => {
  // Blocked on Ticket 41 merging.
});
