import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Server-only, service-role client. Buyer /portal sessions are validated via a
// magic-link token (Security Gate ticket), not Supabase Auth, so they can't satisfy
// the tenant_id RLS policies on workspaces/links — portal routes read through this
// client instead, after the token check passes. Never import from a Client Component.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
