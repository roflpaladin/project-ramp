// Sprint 12, Ticket 65 — "Password Reset Flow". Seeds one seller for
// e2e/password-reset.spec.ts and mints the recovery link for them.
//
// The link is minted here with the same Admin API call
// lib/auth/password-reset.ts makes (admin.generateLink, type "recovery") and
// built into the same /auth/confirm URL shape — rather than read out of an
// inbox, which a local run has no access to. The email transport itself is
// covered by tests/email/send-password-reset.spec.ts; the link contract by
// tests/security/password-reset.spec.ts.
//
// A service-role client is built directly (not lib/supabase/admin.ts's
// createAdminClient, which imports "server-only" and cannot load in
// Playwright's Node process) — same reasoning as the other e2e seed helpers.

import { createClient as createServiceClient } from "@supabase/supabase-js";

const COMPANY_NAME = "T65 password reset E2E";
export const SELLER_EMAIL = "t65-password-reset-e2e@projectramp.invalid";
export const OLD_PASSWORD = "e2e-old-correct-horse-9";
export const NEW_PASSWORD = "e2e-new-battery-staple-7";

const USER_PAGE_SIZE = 1000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`seed-password-reset-seller: missing required env var ${name}`);
  }
  return value;
}

function adminClient() {
  return createServiceClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

export async function teardownPasswordResetSeller(): Promise<void> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: USER_PAGE_SIZE });
  if (error) throw new Error(`teardownPasswordResetSeller: listing users failed: ${error.message}`);

  const seller = data.users.find((user) => user.email === SELLER_EMAIL);
  if (seller) await admin.auth.admin.deleteUser(seller.id);
  await admin.from("tenants").delete().eq("company_name", COMPANY_NAME);
}

export async function seedPasswordResetSeller(): Promise<void> {
  const admin = adminClient();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ company_name: COMPANY_NAME })
    .select("id")
    .single();
  if (tenantError || !tenant) throw new Error(`seedPasswordResetSeller: tenant insert failed: ${tenantError?.message}`);

  const { error: userError } = await admin.auth.admin.createUser({
    email: SELLER_EMAIL,
    password: OLD_PASSWORD,
    email_confirm: true,
    app_metadata: { tenant_id: tenant.id },
  });
  if (userError) throw new Error(`seedPasswordResetSeller: user create failed: ${userError.message}`);
}

/** A relative /auth/confirm link carrying a fresh one-time recovery token. */
export async function mintRecoveryLinkPath(): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "recovery", email: SELLER_EMAIL });
  const tokenHash = data.properties?.hashed_token;
  if (error || !tokenHash) throw new Error(`mintRecoveryLinkPath: generateLink failed: ${error?.message}`);

  const query = new URLSearchParams({ token_hash: tokenHash, type: "recovery" });
  return `/auth/confirm?${query.toString()}`;
}
