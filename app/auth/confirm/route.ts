import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

// Sprint 8, Ticket 39 — the emailRedirectTo target for both the magic-link
// sign-in (app/admin/login/actions.ts's sendMagicLink) and Supabase's own
// confirmation emails. GET only: this is the link a seller clicks from
// their inbox, not an API called from app code.
const INVALID_LINK_MESSAGE = "That sign-in link is invalid or has expired. Request a new one.";

export async function GET(request: Request): Promise<never> {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (!tokenHash || !type) {
    redirect(`/admin/login?error=${encodeURIComponent(INVALID_LINK_MESSAGE)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) {
    redirect(`/admin/login?error=${encodeURIComponent(INVALID_LINK_MESSAGE)}`);
  }

  redirect("/admin");
}
