"use server";

import { redirect } from "next/navigation";

import { revokeRefreshToken } from "@/lib/hubspot/token-exchange";
import { deleteTenantTokens, getTenantRefreshToken } from "@/lib/crm-connections/token-store";
import { requireSeller } from "@/lib/plans/require-seller";
import { checkRateLimit, CRM_OAUTH_RATE_LIMIT } from "@/lib/rate-limit";

// Sprint 10, Ticket 52 — disconnects the tenant's HubSpot connection.
// Named hubspot-actions.ts, not appended to the existing actions.ts (T45's
// import-actions.ts precedent, restated in that file's own header): the
// server-action auth coverage probe (tests/security/support/route-probe.ts's
// listActionFiles) only walks files whose basename ends in "-actions.ts" —
// actions.ts itself sits outside that probe already (a pre-existing gap this
// ticket's test-scan widening flags separately, see
// tests/security/server-action-auth.spec.ts's allowlist entry for it), so a
// NEW action belongs in a file the probe is guaranteed to cover from day one.
//
// Ordering is deliberate: revoke on HubSpot's side FIRST (best-effort — a
// revoke failure must not leave the local row behind, since that row is
// what lib/hubspot/get-client.ts uses to silently keep working), THEN
// delete the local row UNCONDITIONALLY. A user who clicks "disconnect"
// expects this tenant to stop working against their HubSpot account
// locally regardless of whether the revoke call itself succeeded — leaving
// the row in place because revoke failed would keep the encrypted refresh
// token around and get-client.ts still functional, which is not what
// "disconnect" means from the seller's point of view. The revoke outcome is
// still surfaced (as a `?warning=` query param, not a hard error) so a
// still-live HubSpot-side grant that the user may want to clean up manually
// isn't silently hidden from them.
export async function disconnectHubSpot(_formData: FormData): Promise<void> {
  const seller = await requireSeller();
  if (!seller) redirect("/admin/login");
  if (!seller.tenantId) {
    redirect(`/settings/integrations?error=${encodeURIComponent("missing_tenant")}`);
  }

  // T52 code review (MEDIUM) — keyed per seller, after the cheap auth checks
  // above and before this action does any real work (the revoke call or the
  // local delete).
  const limit = checkRateLimit(
    `hubspot-disconnect:${seller.userId}`,
    CRM_OAUTH_RATE_LIMIT.limit,
    CRM_OAUTH_RATE_LIMIT.windowMs,
  );
  if (!limit.allowed) {
    redirect(`/settings/integrations?error=${encodeURIComponent("rate_limited")}`);
  }

  // T52 code review (MEDIUM) — getTenantRefreshToken now throws on a real
  // query error rather than folding it into "no stored token"
  // (lib/crm-connections/token-store.ts). Left uncaught, that would previously have
  // meant a transient DB read failure silently skipped the HubSpot-side
  // revoke below (read the comment on the ordering above: revoke-then-
  // delete is deliberate specifically so a failure never leaves a live
  // HubSpot grant this seller thinks is gone). Caught here and routed
  // through this action's normal failure redirect instead.
  let refreshToken: string | null;
  try {
    refreshToken = await getTenantRefreshToken(seller.tenantId);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- server-side diagnostics only
    console.error("[hubspot disconnect] reading stored refresh token failed:", error);
    redirect(`/settings/integrations?error=${encodeURIComponent("disconnect_failed")}`);
  }
  let revokeSucceeded = true;

  if (refreshToken) {
    try {
      await revokeRefreshToken(refreshToken);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console -- server-side diagnostics only; never surfaced raw to the caller.
      console.error("[hubspot disconnect] revoke failed:", error);
      revokeSucceeded = false;
    }
  }

  try {
    await deleteTenantTokens(seller.tenantId);
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- server-side diagnostics only
    console.error("[hubspot disconnect] local delete failed:", error);
    redirect(`/settings/integrations?error=${encodeURIComponent("disconnect_failed")}`);
  }

  if (!revokeSucceeded) {
    redirect(`/settings/integrations?warning=${encodeURIComponent("revoke_failed")}`);
  }
  redirect("/settings/integrations?disconnected=1");
}
