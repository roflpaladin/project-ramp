import Link from "next/link";
import { redirect } from "next/navigation";

import { activeDealsAllowanceLabel } from "@/lib/billing/active-deals-label";
import { resolveEntitlement } from "@/lib/billing/entitlement";
import { findByTenantId } from "@/lib/billing/subscription-repository";
import { requireSeller } from "@/lib/plans/require-seller";
import { openBillingPortalAction } from "./actions";
import { describeBillingStatus, formatBillingDate, planDisplayName } from "./billing-status";
import "./billing.css";

// Sprint 12, Ticket 59 (slice 2 — seller-facing billing surface). Reads the
// tenant's stored Paddle subscription (if any) and renders the plan the
// seller is entitled to RIGHT NOW via the same resolveEntitlement the
// paywall lane uses — this page never re-derives an entitlement rule of its
// own. The signed-out guard mirrors app/settings/integrations/page.tsx's own
// exactly (redirect("/admin/login"); middleware.ts's "/settings/:path*"
// matcher already enforces this — this is defense in depth, same as the
// integrations page's own comment on the point).
const BILLING_CONTACT_EMAIL = "dimas@getbrava.tech";
const BILLING_CONTACT_SUBJECT = "Brava billing";
const BILLING_CONTACT_HREF = `mailto:${BILLING_CONTACT_EMAIL}?subject=${encodeURIComponent(BILLING_CONTACT_SUBJECT)}`;

function billingCycleLabel(cycle: "month" | "year" | null): string | null {
  if (cycle === "month") return "Billed monthly";
  if (cycle === "year") return "Billed yearly";
  return null;
}

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const seller = await requireSeller();
  if (!seller) {
    redirect("/admin/login");
  }

  const subscription = seller.tenantId ? await findByTenantId(seller.tenantId) : null;
  const entitlement = resolveEntitlement(subscription, new Date());
  const isManual = entitlement.source === "manual";

  const planName = planDisplayName(entitlement);
  const allowanceLabel = activeDealsAllowanceLabel(entitlement.maxActiveDeals);
  const status = isManual ? null : describeBillingStatus(subscription, entitlement);
  const cycleLabel = isManual ? null : billingCycleLabel(subscription?.billingCycle ?? null);

  const canManageBilling =
    !isManual && subscription?.paddleCustomerId != null && subscription?.paddleSubscriptionId != null;
  const renewalDate =
    !isManual && subscription?.status === "active" && !subscription.scheduledChange
      ? subscription.currentPeriodEndsAt
      : null;

  return (
    <main data-surface="settings-billing" data-testid="billing-page" className="bl-page">
      <div className="bl-header">
        <p className="bl-back">
          <Link href="/admin">← Back to dashboard</Link>
        </p>
        <h1 className="bl-title">Billing</h1>
      </div>

      {error ? (
        <p className="bl-error" role="status" data-testid="billing-error">
          {error}
        </p>
      ) : null}

      <section className="bl-card" data-testid="billing-plan-card">
        <p className="bl-plan-name">{planName}</p>
        <p className="bl-mono bl-allowance">{allowanceLabel}</p>

        {isManual ? (
          <>
            <p className="bl-invoiced">Invoiced plan — managed by our team</p>
            <a href={BILLING_CONTACT_HREF} className="bl-btn bl-btn-secondary">
              Contact us
            </a>
          </>
        ) : (
          <>
            {status ? (
              <span className="bl-status" data-tone={status.tone} data-testid="billing-status">
                <span className="bl-status-dot" aria-hidden="true" />
                <span>{status.label}</span>
              </span>
            ) : null}
            {status?.helpText ? <p className="bl-help">{status.helpText}</p> : null}
            {cycleLabel ? <p className="bl-cycle">{cycleLabel}</p> : null}
            {renewalDate ? <p className="bl-renewal bl-mono">Renews {formatBillingDate(renewalDate)}</p> : null}

            {canManageBilling ? (
              <>
                <form action={openBillingPortalAction}>
                  <button type="submit" className="bl-btn bl-btn-primary" data-signal="true">
                    Manage billing
                  </button>
                </form>
                <p className="bl-note">Opens Paddle&apos;s secure page to update your card, see invoices or cancel.</p>
              </>
            ) : (
              <Link href="/pricing" className="bl-btn bl-btn-primary" data-signal="true">
                See plans
              </Link>
            )}
          </>
        )}
      </section>
    </main>
  );
}
