import { createAdminClient } from "@/lib/supabase/admin";

// Sprint 8, Ticket 39 — seller self-serve registration core. Registration and
// tenant provisioning are ONE atomic deliverable (poker ruling): a signup
// without a tenant_id claim fails every RLS-gated query, so no code path may
// ever create a seller user without its tenant.
//
// Ordering is the atomicity mechanism: the tenants row is created FIRST, so
// the GoTrue user can be created WITH app_metadata.tenant_id already attached
// — no post-hoc Admin API metadata write, which is the JWT-claim propagation
// race the poker flagged. On user-creation failure the tenant row is
// compensatingly deleted (safe: nothing references a tenant this young).
// Email uniqueness is enforced by GoTrue itself, mirroring the provisioner's
// unique-index race pattern (lib/crm/provisioner.ts).

const MIN_PASSWORD_LENGTH = 8;

// Deliberately shallow: GoTrue is the authority on address validity; this
// only rejects obvious non-addresses before any DB write happens.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ProvisionSellerError = "email_taken" | "invalid_input" | "provisioning_failed";

export type ProvisionSellerResult =
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; code: ProvisionSellerError; message: string };

export interface ProvisionSellerInput {
  email: string;
  password: string;
  companyName: string;
}

function invalidInput(message: string): ProvisionSellerResult {
  return { ok: false, code: "invalid_input", message };
}

function isDuplicateEmailError(error: { code?: string; message: string }): boolean {
  return error.code === "email_exists" || /already.+registered/i.test(error.message);
}

export async function provisionSeller(input: ProvisionSellerInput): Promise<ProvisionSellerResult> {
  const email = input.email.trim().toLowerCase();
  const companyName = input.companyName.trim();

  if (!EMAIL_PATTERN.test(email)) {
    return invalidInput("Enter a valid email address.");
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return invalidInput(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (!companyName) {
    return invalidInput("Company name is required.");
  }

  const admin = createAdminClient();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ company_name: companyName })
    .select("id")
    .single();

  if (tenantError || !tenant) {
    return {
      ok: false,
      code: "provisioning_failed",
      message: "We couldn't set up your account. Please try again.",
    };
  }

  // email_confirm: true — sellers are sign-in-able immediately. A real
  // confirmation-email flow needs the deliverability work in Ticket 57
  // (Sprint 11); shipping an unconfirmed-limbo state before that exists
  // would strand every signup.
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    app_metadata: { tenant_id: tenant.id },
  });

  if (userError || !created?.user) {
    await admin.from("tenants").delete().eq("id", tenant.id);

    if (userError && isDuplicateEmailError(userError)) {
      return {
        ok: false,
        code: "email_taken",
        message: "That email already has an account.",
      };
    }
    return {
      ok: false,
      code: "provisioning_failed",
      message: "We couldn't set up your account. Please try again.",
    };
  }

  return { ok: true, userId: created.user.id, tenantId: tenant.id };
}
