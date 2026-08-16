"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, SEND_TOKEN_RATE_LIMIT } from "@/lib/rate-limit";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect(`/admin/login?error=${encodeURIComponent("Email and password are required.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/admin/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/admin");
}

// Sprint 8, Ticket 39 — magic-link sign-in for sellers who already have an
// account (registration itself is password-based, via app/register).
// `origin` has no single reliable source in a server action (no NextRequest
// here), so it's derived the same way Next's own docs recommend: prefer the
// browser-sent Origin header on this POST, fall back to Host + a protocol
// guess for the rare client that omits it.
function resolveOrigin(headerList: Headers): string {
  const origin = headerList.get("origin");
  if (origin) return origin;

  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    redirect(`/admin/login?error=${encodeURIComponent("Enter your email to get a sign-in link.")}`);
  }

  const headerList = await headers();

  // Every call sends an email, so this is a "send endpoint" under T39's
  // interim rate-limit scope — same budget as /api/auth/send-token. The
  // uniform `sent=1` outcome below also covers the rate-limited case:
  // distinguishing it would hand back a probe signal.
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { allowed } = checkRateLimit(
    `send-magic-link:${ip}`,
    SEND_TOKEN_RATE_LIMIT.limit,
    SEND_TOKEN_RATE_LIMIT.windowMs,
  );
  if (!allowed) {
    redirect("/admin/login?sent=1");
  }

  const origin = resolveOrigin(headerList);

  const supabase = await createClient();
  // shouldCreateUser MUST stay false: a user created via OTP has no
  // tenant_id in app_metadata (provisionSeller is the only path that sets
  // one) and would fail every RLS query behind /admin. Magic link is for
  // sign-in, not account creation.
  await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });

  // `sent=1` is a flag, not the message itself — app/admin/login/page.tsx
  // owns the copy (same pattern as the error codes in app/register). Same
  // confirmation regardless of whether the account exists, and regardless
  // of whether Supabase reported an error — anything else would let an
  // attacker enumerate registered seller emails.
  redirect("/admin/login?sent=1");
}
