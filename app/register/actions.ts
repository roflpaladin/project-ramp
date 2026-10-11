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
import { parseSafeNext } from "@/lib/navigation/safe-next";
import { REGISTRATION_RATE_LIMIT } from "@/lib/rate-limit";
import { checkDurableRateLimit } from "@/lib/rate-limit-durable";

// `next` (T67) is carried through error redirects only once it has passed
// parseSafeNext, so an unsafe value is dropped rather than echoed back.
function redirectWithError(code: string, next: string | null): never {
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";
  redirect(`/register?error=${encodeURIComponent(code)}${nextParam}`);
}

export async function registerSeller(formData: FormData): Promise<void> {
  const companyName = String(formData.get("companyName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = parseSafeNext(formData.get("next"));

  if (!companyName || !email || !password) {
    redirectWithError("invalid_input", next);
  }
  if (!EMAIL_PATTERN.test(email)) {
    redirectWithError("invalid_email", next);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirectWithError("password_too_short", next);
  }

  const headerList = await headers();
  const { allowed } = await checkDurableRateLimit(
    `register:${clientIp(headerList)}`,
    REGISTRATION_RATE_LIMIT,
  );
  if (!allowed) {
    redirectWithError("rate_limited", next);
  }

  const result = await provisionSeller({ email, password, companyName });
  if (!result.ok) {
    redirectWithError(result.code, next);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // The account exists (provisionSeller already succeeded) but the
    // immediate sign-in failed — send them to the normal login form rather
    // than stranding them on a broken redirect loop back to /register.
    // `next` is not carried: /admin/login has no `next` support yet.
    redirect(
      `/admin/login?error=${encodeURIComponent("Your account was created — sign in to continue.")}`,
    );
  }

  // T41 (Sprint 8, Ticket 41) — a freshly self-served seller now lands on
  // the guided onboarding flow rather than a bare, possibly-empty /admin.
  // Not asserted by tests/components/register-page.dom.spec.tsx (that suite
  // only renders the page's own JSX and never invokes this action), so
  // nothing there pins the old target.
  redirect(next ?? "/admin/onboarding");
}
