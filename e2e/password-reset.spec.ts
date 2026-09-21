// Sprint 12, Ticket 65 — "Password Reset Flow". LOCAL-RUN ONLY, not a CI job
// — see playwright.config.ts's header comment. Drives the seller's whole
// path through a real browser and a real build: sign-in page -> "Forgot
// password?" -> neutral confirmation -> recovery link -> set a new password
// -> signed in on /admin -> the used link and the old password both stop
// working. The vitest specs pin each piece; this is the only file that
// proves they hold together across real redirects and a real cookie jar
// (the session cookie AND the path-scoped recovery marker).
//
// The recovery link is minted by e2e/support/seed-password-reset-seller.ts,
// not read from an inbox — see that file's header.

import { test, expect } from "@playwright/test";
import {
  NEW_PASSWORD,
  OLD_PASSWORD,
  SELLER_EMAIL,
  mintRecoveryLinkPath,
  seedPasswordResetSeller,
  teardownPasswordResetSeller,
} from "./support/seed-password-reset-seller";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await teardownPasswordResetSeller();
  await seedPasswordResetSeller();
});

test.afterAll(async () => {
  await teardownPasswordResetSeller();
});

test("a seller asks for a reset link from the sign-in page and gets the neutral confirmation", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();

  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Email").fill(SELLER_EMAIL);
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(page).toHaveURL(/\/forgot-password\?sent=1$/);
  await expect(page.getByRole("status")).toContainText("If an account exists for that email");
});

test("an unknown email gets the exact same confirmation", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("t65-nobody-e2e@projectramp.invalid");
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(page).toHaveURL(/\/forgot-password\?sent=1$/);
  await expect(page.getByRole("status")).toContainText("If an account exists for that email");
});

test("the reset page refuses a visitor who did not come through a reset link", async ({ page }) => {
  await page.goto("/auth/reset");

  await expect(page).toHaveURL(/\/forgot-password\?error=link_expired$/);
  await expect(page.getByRole("alert")).toContainText("expired or was already used");
});

test("the recovery link sets a new password, signs the seller in, and cannot be reused", async ({ page }) => {
  const linkPath = await mintRecoveryLinkPath();

  // A caller-supplied destination must be ignored (no open redirect).
  await page.goto(`${linkPath}&next=https://example.org/`);
  await expect(page).toHaveURL(/\/auth\/reset$/);

  // A mismatch keeps the seller on the page with the marker intact.
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(`${NEW_PASSWORD}-typo`);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("alert")).toContainText("do not match");

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set new password" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(`Signed in as ${SELLER_EMAIL}`)).toBeVisible();

  // The marker is spent: still signed in, but the reset page is closed again.
  await page.goto("/auth/reset");
  await expect(page).toHaveURL(/\/forgot-password\?error=link_expired$/);

  // The link is single-use.
  await page.goto(linkPath);
  await expect(page).toHaveURL(/\/forgot-password\?error=link_expired$/);
});

test("the old password is rejected and the new one signs in", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").first().fill(SELLER_EMAIL);
  await page.getByLabel("Password").fill(OLD_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login/);

  await page.getByLabel("Email").first().fill(SELLER_EMAIL);
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});
