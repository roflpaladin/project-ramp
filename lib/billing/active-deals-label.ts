// T59 slice 2. The single wording for "how many active deals does this tier
// allow" — app/pricing/pricing-tiers.tsx's tier cards and
// app/settings/billing/page.tsx's plan summary must say the exact same
// thing for the exact same cap, so this is a shared, framework-free helper
// (no React, no "use client"/"server-only") rather than two independently
// maintained copies of the same string. Importers: app/pricing/pricing-tiers.tsx
// (client) and app/settings/billing/billing-status.ts (server). Not a
// duplicate of anything — pricing-tiers.tsx's own local `tierCapLabel`
// (Sprint 12, Ticket 67) is being replaced by this call in the same change
// that adds the billing page's need for the identical wording.

/** `maxActiveDeals` — null means unlimited (lib/billing/plans.ts's TierCommon). */
export function activeDealsAllowanceLabel(maxActiveDeals: number | null): string {
  if (maxActiveDeals === null) return "Unlimited active deals";
  return `Up to ${maxActiveDeals} active ${maxActiveDeals === 1 ? "deal" : "deals"}`;
}
