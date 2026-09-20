import Link from "next/link";
import { getPricingModel } from "@/lib/billing/plans";
import "./marketing-footer-nav.css";

/**
 * Sprint 12, Ticket 67 (slice 1 — Paddle onboarding step 1, "build your
 * pricing page"). Shared marketing nav+footer: Home, Pricing (only while
 * publishable), Terms, Privacy, Refunds. Security is deliberately omitted —
 * that page is a later slice, and a link to a route that doesn't exist yet
 * is a dead link.
 *
 * A plain (non-async) Server Component: getPricingModel() is a synchronous
 * env read, so there's no need for this to be a client component or to
 * accept the publishable flag as a prop — every caller gets the same
 * single source of truth automatically. Used on /pricing only this pass;
 * wiring it into the legal pages and landing page as well was judged out of
 * this slice's "small, low-risk" bar (see the ticket report) and left for a
 * follow-up.
 */
export function MarketingFooterNav() {
  const { isPublishable } = getPricingModel();

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
