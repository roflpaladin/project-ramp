import type { Metadata } from "next";
import Link from "next/link";
import "./welcome.css";

// Sprint 12, Ticket 67 (slice 1, founder scope amendment — Paddle overlay
// checkout). Paddle.Checkout.open's settings.successUrl target
// (pricing-tiers.tsx) — the page a seller lands on right after completing
// payment in the overlay. Deliberately does NOT claim the subscription is
// active: Paddle's webhook (a separate backend lane, out of this ticket's
// scope) is what actually flips the tenant's plan, and that can happen a
// few seconds after the overlay closes. Claiming "your plan is active" here
// would be a lie the moment the webhook hasn't landed yet.
//
// T59 slice 2 adds a secondary "View your plan" link to the new
// app/settings/billing page, alongside (never replacing) the existing
// workspace link — plain/secondary styling, never Signal: "Go to your
// workspace" remains this page's one Signal-styled action.
export const metadata: Metadata = {
  title: "Welcome — Brava",
  description: "Your Brava subscription is being activated.",
};

export default function WelcomePage() {
  return (
    <main data-surface="welcome" data-testid="welcome-page" className="wc-page">
      <div className="wc-card">
        <p className="wc-kicker">Thanks!</p>
        <h1 className="wc-title">We&apos;re setting up your subscription</h1>
        <p className="wc-body">
          Your payment went through. We&apos;re finishing activation on our side, which usually takes just a
          moment — your plan will unlock automatically as soon as it&apos;s done.
        </p>
        <div className="wc-actions">
          <Link href="/admin" className="wc-btn wc-btn-primary" data-signal="true">
            Go to your workspace
          </Link>
          <Link href="/settings/billing" className="wc-btn wc-btn-secondary">
            View your plan
          </Link>
        </div>
      </div>
    </main>
  );
}
