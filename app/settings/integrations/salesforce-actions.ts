"use server";

import { redirect } from "next/navigation";

import { revokeRefreshToken } from "@/lib/salesforce/token-exchange";
import { deleteTenantTokens, getTenantConnection } from "@/lib/crm-connections/token-store";
import { requireSeller } from "@/lib/plans/require-seller";
import { checkRateLimit, CRM_OAUTH_RATE_LIMIT } from "@/lib/rate-limit";

// Sprint 11, Ticket 55 — disconnects the tenant's Salesforce connection.
// Mirrors app/settings/integrations/hubspot-actions.ts's disconnectHubSpot()
// byte-for-byte in structure and ordering (revoke on the provider's side
// FIRST, best-effort, THEN delete the local row UNCONDITIONALLY — see that
// file's header for the full "why that order" reasoning, unchanged here).
// Named salesforce-actions.ts, not appended to hubspot-actions.ts or
// actions.ts, for the same reason hubspot-actions.ts gives for its own name:
// the server-action auth coverage probe (tests/security/server-action-auth.spec.ts,
// via tests/security/support/route-probe.ts's listActionFiles) only walks
// files whose basename ends in "-actions.ts".
//
// `?warning=`/`?error=` values are prefixed `sf_` — see
// app/api/integrations/salesforce/oauth/callback/route.ts's header for why
// this page's single shared `?error=`/`?warning=` query params need disjoint
// namespaces per provider.
export async function disconnectSalesforce(_formData: FormData): Promise<void> {
  const seller = await requireSeller();
  if (!seller) redirect("/admin/login");
  if (!seller.tenantId) {
    redirect(`/settings/integrations?error=${encodeURIComponent("sf_missing_tenant")}`);
  }

  const limit = checkRateLimit(
    `salesforce-disconnect:${seller.userId}`,
    CRM_OAUTH_RATE_LIMIT.limit,
    CRM_OAUTH_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) {
    redirect(`/settings/integrations?error=${encodeURIComponent("sf_rate_limited")}`);
  }

  // See lib/crm-connections/token-store.ts's T52 error-vs-absent-row
  // distinction (unchanged by this ticket): a real query error must not be
  // silently folded into "nothing stored" here, which would skip the
  // Salesforce-side revoke below for a tenant that actually has a live
  // connection.
  let refreshToken: string | null;
  try {
    const connection = await getTenantConnection(seller.tenantId, "salesforce");
    refreshToken = connection?.refreshToken ?? null;
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- server-side diagnostics only
    console.error("[salesforce disconnect] reading stored connection failed:", error);
    redirect(`/settings/integrations?error=${encodeURIComponent("sf_disconnect_failed")}`);
  }
  let revokeSucceeded = true;

  if (refreshToken) {
    try {
      await revokeRefreshToken(refreshToken);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- server-side diagnostics only; never surfaced raw to the caller.
      console.error("[salesforce disconnect] revoke failed:", error);
      revokeSucceeded = false;
    }
  }

  try {
    await deleteTenantTokens(seller.tenantId, "salesforce");
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- server-side diagnostics only
    console.error("[salesforce disconnect] local delete failed:", error);
    redirect(`/settings/integrations?error=${encodeURIComponent("sf_disconnect_failed")}`);
  }

  if (!revokeSucceeded) {
    redirect(`/settings/integrations?warning=${encodeURIComponent("sf_revoke_failed")}`);
  }
  redirect("/settings/integrations?disconnected=salesforce");
}
