"use server";

// Sprint 8, Ticket 39 — seller self-serve registration. Mirrors the existing
// sign-in flow in app/admin/login/actions.ts: a plain "use server" action
// bound directly to a <form action={...}>, errors surfaced by redirecting
// back to the same page with a short, mappable error CODE in the query
// string (never a raw Supabase/internal message — app/register/page.tsx
// owns turning a code into human copy).
//
// provisionSeller (lib/auth/provision-seller.ts) and checkRateLimit
// (lib/rate-limit.ts) are owned by the session lead and land alongside this
// ticket — see the contracts in the ticket brief. This file only consumes
// them.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { provisionSeller } from "@/lib/auth/provision-seller";
import { EMAIL_PATTERN, MIN_PASSWORD_LENGTH } from "@/lib/auth/validation";
import { clientIp } from "@/lib/client-ip";
import { REGISTRATION_RATE_LIMIT } from "@/lib/rate-limit";
import { checkDurableRateLimit } from "@/lib/rate-limit-durable";

function redirectWithError(code: string): never {
  redirect(`/register?error=${encodeURIComponent(code)}`);
}

export async function registerSeller(formData: FormData): Promise<void> {
  const companyName = String(formData.get("companyName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!companyName || !email || !password) {
    redirectWithError("invalid_input");
  }
  if (!EMAIL_PATTERN.test(email)) {
    redirectWithError("invalid_email");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirectWithError("password_too_short");
  }

  const headerList = await headers();
  const { allowed } = await checkDurableRateLimit(
    `register:${clientIp(headerList)}`,
    REGISTRATION_RATE_LIMIT,
  );
  if (!allowed) {
    redirectWithError("rate_limited");
  }

  const result = await provisionSeller({ email, password, companyName });
  if (!result.ok) {
    redirectWithError(result.code);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // The account exists (provisionSeller already succeeded) but the
    // immediate sign-in failed — send them to the normal login form rather
    // than stranding them on a broken redirect loop back to /register.
    redirect(
      `/admin/login?error=${encodeURIComponent("Your account was created — sign in to continue.")}`,
    );
  }

  // T41 (Sprint 8, Ticket 41) — a freshly self-served seller now lands on
  // the guided onboarding flow rather than a bare, possibly-empty /admin.
  // Not asserted by tests/components/register-page.dom.spec.tsx (that suite
  // only renders the page's own JSX and never invokes this action), so
  // nothing there pins the old target.
  redirect("/admin/onboarding");
}
