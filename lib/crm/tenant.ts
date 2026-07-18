import { createAdminClient } from "@/lib/supabase/admin";
import type { ResolvedOwner } from "@/lib/crm/types";

// Pillar 4 — Seller Instance Mapping (Sprint 3). An inbound webhook carries
// the deal owner's email; the matching AE account's `tenant_id` claim in
// app_metadata decides which tenant the workspace is locked to. This is the
// claim model from Sprint 1 — NOT auth.uid() (the 1.2 PRD's RLS snippet using
// auth.uid() is a known error). No match → the caller returns 401 and writes
// nothing (Multi-Tenant Isolation).
export async function resolveOwnerByEmail(ownerEmail: string): Promise<ResolvedOwner | null> {
  const admin = createAdminClient();
  const needle = ownerEmail.trim().toLowerCase();

  // GoTrue's admin API has no lookup-by-email; listing is fine at the current
  // scale (a handful of manually provisioned AE accounts — no self-serve
  // signup exists). Revisit with pagination if tenants ever onboard in bulk.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return null;

  const user = data.users.find((candidate) => candidate.email?.toLowerCase() === needle);
  if (!user) return null;

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  if (!tenantId) return null;

  return { userId: user.id, tenantId };
}
