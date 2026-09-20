import Link from "next/link";
import { getPricingModel } from "@/lib/billing/plans";
import "./marketing-footer-nav.css";

export interface MarketingFooterNavProps {
  /**
   * Code-review fix (post T67 slice 1): app/pricing/page.tsx already calls
   * getPricingModel() itself to decide whether to 404 — rendering this
   * component with no prop made every /pricing request evaluate the model
   * (and, while unpublishable, log its misconfiguration console.error)
   * TWICE. Callers that already have the answer should pass it here;
   * getPricingModel() is only called when this prop is omitted entirely
   * (`undefined`, not `false` — `isPricingPublishable={false}` is a real,
   * intentional answer, not "no answer given").
   */
  isPricingPublishable?: boolean;
}

/**
 * Sprint 12, Ticket 67 (slice 1 — Paddle onboarding step 1, "build your
 * pricing page"). Shared marketing nav+footer: Home, Pricing (only while
 * publishable), Terms, Privacy, Refunds. Security is deliberately omitted —
 * that page is a later slice, and a link to a route that doesn't exist yet
 * is a dead link.
 *
 * A plain (non-async) Server Component: getPricingModel() is a synchronous
 * env read, so there's no need for this to be a client component. Used on
 * /pricing only this pass; wiring it into the legal pages and landing page
 * as well was judged out of this slice's "small, low-risk" bar (see the
 * ticket report) and left for a follow-up.
 */
export function MarketingFooterNav({ isPricingPublishable }: MarketingFooterNavProps = {}) {
  const isPublishable = isPricingPublishable ?? getPricingModel().isPublishable;

  return (
    <nav className="mkt-footer-nav" aria-label="Site">
      <Link href="/">Home</Link>
      {isPublishable ? <Link href="/pricing">Pricing</Link> : null}
      <Link href="/terms">Terms</Link>
      <Link href="/privacy">Privacy</Link>
      <Link href="/refunds">Refunds</Link>
    </nav>
  );
}
