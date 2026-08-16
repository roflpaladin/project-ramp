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
import { checkRateLimit, REGISTRATION_RATE_LIMIT } from "@/lib/rate-limit";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function redirectWithError(code: string): never {
  redirect(`/register?error=${encodeURIComponent(code)}`);
}

function callerIp(headerList: Headers): string {
  const forwardedFor = headerList.get("x-forwarded-for");
  const firstEntry = forwardedFor?.split(",")[0]?.trim();
  return firstEntry || "unknown";
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
  const ip = callerIp(headerList);
  const { allowed } = checkRateLimit(
    `register:${ip}`,
    REGISTRATION_RATE_LIMIT.limit,
    REGISTRATION_RATE_LIMIT.windowMs,
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

  redirect("/admin");
}
