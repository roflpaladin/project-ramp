import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPricingModel } from "@/lib/billing/plans";
import { resolveVercelCountryCode } from "@/lib/billing/country";
import { requireSeller } from "@/lib/plans/require-seller";
import { MarketingFooterNav } from "@/components/marketing/marketing-footer-nav";
import { PricingTiers } from "./pricing-tiers";
import "./pricing.css";

// Sprint 12, Ticket 67 (slice 1 — Paddle onboarding step 1, "build your
// pricing page"). Brava, never getbrava.io (that domain isn't ours — see
// CLAUDE.md) — matches every other user-facing surface's metadata pattern
// (app/page.tsx, app/terms/page.tsx).
export const metadata: Metadata = {
  title: "Pricing — Brava",
  description:
    "Brava pricing: start with one free active deal, then choose a flat-priced plan — Starter, Pro or Advanced.",
};

const COUNTRY_HEADER_NAME = "x-vercel-ip-country";

/**
 * The founder has not confirmed real Paddle price IDs yet (see the ticket
 * report) — getPricingModel().isPublishable is false until every tier's
 * PADDLE_PRICE_<TIER>_MONTH env var and the Paddle client env/token pair
 * are all set, so this page 404s rather than ever rendering a placeholder
 * price. No numbers in this file are hard-coded: everything the JSX below
 * renders comes from the resolved `pricing` model or PricingTiers' own
 * Paddle.PricePreview call.
 *
 * requireSeller() (lib/plans/require-seller.ts) determines whether Subscribe
 * opens the Paddle overlay (signed in) or routes to /register first (signed
 * out) — see pricing-tiers.tsx. Only the seller's EMAIL is threaded down
 * (for Paddle's prefill): as of Sprint 12, Ticket 59 the browser is never
 * told, and never sends, a tenant id — the tenant behind a checkout comes
 * from a server-issued reference (./checkout-actions.ts) that the webhook
 * looks up itself. The country header is read here (server-
 * side, per Vercel's own x-vercel-ip-country convention) and normalised by
 * resolveVercelCountryCode before ever reaching the client bundle, so no
 * internal "unknown" sentinel can leak into a Paddle.PricePreview call.
 */
export default async function PricingPage() {
  const pricing = getPricingModel();
  if (!pricing.isPublishable || pricing.paddle === null) {
    notFound();
  }

  const [headerList, seller] = await Promise.all([headers(), requireSeller()]);
  const countryCode = resolveVercelCountryCode(headerList.get(COUNTRY_HEADER_NAME));

  return (
    <main data-surface="pricing" data-testid="pricing-page" className="pr-page">
      <header className="pr-header">
        <Link href="/" className="pr-mark">
          brava
        </Link>
      </header>

      <section className="pr-hero">
        <p className="pr-kicker">Pricing</p>
        <h1 className="pr-headline">Simple pricing that scales with you</h1>
        <p className="pr-subline">
          Every plan starts with <span className="pr-mono">{pricing.freeActiveDeals}</span> free active deal — the
          full Brava experience, no credit card required. One fixed price per billing period after that — no usage
          charges, no surprise bill.
        </p>
      </section>

      <PricingTiers
        tiers={pricing.tiers}
        hasYearlyPricing={pricing.hasYearlyPricing}
        paddleEnvironment={pricing.paddle.environment}
        paddleClientToken={pricing.paddle.clientToken}
        countryCode={countryCode}
        signedInEmail={seller?.email ?? null}
      />

      <MarketingFooterNav isPricingPublishable={pricing.isPublishable} />
    </main>
  );
}
