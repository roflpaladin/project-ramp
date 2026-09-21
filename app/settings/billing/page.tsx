import Link from "next/link";
import { redirect } from "next/navigation";

import { activeDealsAllowanceLabel } from "@/lib/billing/active-deals-label";
import type { Entitlement } from "@/lib/billing/entitlement";
import { resolveEntitlement } from "@/lib/billing/entitlement";
import { findByTenantId } from "@/lib/billing/subscription-repository";
import type { SubscriptionState } from "@/lib/billing/subscription-reducer";
import { countActiveDealsForTenant } from "@/lib/plans/active-deal-count";
import { requireSeller } from "@/lib/plans/require-seller";
import { openBillingPortalAction } from "./actions";
import { messageForBillingErrorCode } from "./billing-errors";
import { activeDealsUsedLabel, describeBillingStatus, formatBillingDate, planDisplayName } from "./billing-status";
import "./billing.css";

// Sprint 12, Ticket 59 (slice 2 — seller-facing billing surface). Reads the
// tenant's stored Paddle subscription (if any) and renders the plan the
// seller is entitled to RIGHT NOW via the same resolveEntitlement the
// paywall lane uses — this page never re-derives an entitlement rule of its
// own. The signed-out guard mirrors app/settings/integrations/page.tsx's own
// exactly (redirect("/admin/login"); middleware.ts's "/settings/:path*"
// matcher already enforces this — this is defense in depth, same as the
// integrations page's own comment on the point).
//
// The `?error=` query param is a CLOSED SET of codes (billing-errors.ts) —
// this page never renders the raw searchParams value (code review fix,
// HIGH: a free-text param would let an attacker-crafted URL display a
// phishing message inside this trusted page).
const BILLING_CONTACT_EMAIL = "dimas@getbrava.tech";
const BILLING_CONTACT_SUBJECT = "Brava billing";
const BILLING_CONTACT_HREF = `mailto:${BILLING_CONTACT_EMAIL}?subject=${encodeURIComponent(BILLING_CONTACT_SUBJECT)}`;

const LOG_PREFIX = "[billing-page]";

/**
 * T60. The usage line is informational, so it is never allowed to take the
 * page down: a failed count omits the line and says so in the server log.
 * countActiveDealsForTenant throws rather than returning 0 precisely so a
 * failure cannot be mistaken here for "you are using none of your plan".
 */
async function readActiveDealCount(tenantId: string | null): Promise<number | null> {
  if (!tenantId) return null;

  try {
    return await countActiveDealsForTenant(tenantId);
  } catch (error) {
    console.error(`${LOG_PREFIX} could not count active deals for tenant ${tenantId}`, error);
    return null;
  }
}

function billingCycleLabel(cycle: "month" | "year" | null): string | null {
  if (cycle === "month") return "Billed monthly";
  if (cycle === "year") return "Billed yearly";
  return null;
}

interface BillingActionsProps {
  readonly isManual: boolean;
  readonly isCanceled: boolean;
  readonly canManageBilling: boolean;
}

/**
 * The card's action row — at most one Signal, always.
 *   - Manual/invoiced: no button here at all (the contact mailto above this
 *     component is the card's only action, and it is deliberately plain).
 *   - Canceled (code review fix, MEDIUM): "See plans" is the one Signal
 *     (re-subscribing is a fresh Paddle checkout, not this portal session);
 *     "View invoices" is a plain secondary action alongside it, for a
 *     tenant who still has a real Paddle customer id and past invoices to
 *     see — same server action as "Manage billing", just a different label
 *     and never Signal-styled.
 *   - A real Paddle customer/subscription otherwise: "Manage billing", the
 *     one Signal.
 *   - Free (never subscribed) or no Paddle customer at all: "See plans".
 */
function BillingActions({ isManual, isCanceled, canManageBilling }: BillingActionsProps) {
  if (isManual) return null;

  const seePlans = (
    <Link href="/pricing" className="bl-btn bl-btn-primary" data-signal="true">
      See plans
    </Link>
  );

  if (isCanceled) {
    return (
      <div className="bl-actions">
        {seePlans}
        {canManageBilling ? (
          <form action={openBillingPortalAction}>
            <button type="submit" className="bl-btn bl-btn-secondary">
              View invoices
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  if (!canManageBilling) return seePlans;

  return (
    <>
      <form action={openBillingPortalAction}>
        <button type="submit" className="bl-btn bl-btn-primary" data-signal="true">
          Manage billing
        </button>
      </form>
      <p className="bl-note">Opens Paddle&apos;s secure page to update your card, see invoices or cancel.</p>
    </>
  );
}

interface BillingCardBodyProps {
  readonly isManual: boolean;
  readonly subscription: SubscriptionState | null;
  readonly entitlement: Entitlement;
}

function BillingCardBody({ isManual, subscription, entitlement }: BillingCardBodyProps) {
  if (isManual) {
    return (
      <>
        <p className="bl-invoiced">Invoiced plan — managed by our team</p>
        <a href={BILLING_CONTACT_HREF} className="bl-btn bl-btn-secondary">
          Contact us
        </a>
      </>
    );
  }

  const isCanceled = subscription?.status === "canceled";
  const status = describeBillingStatus(subscription, entitlement);
  const cycleLabel = billingCycleLabel(subscription?.billingCycle ?? null);
  const renewalDate =
    subscription?.status === "active" && !subscription.scheduledChange ? subscription.currentPeriodEndsAt : null;
  const canManageBilling = subscription?.paddleCustomerId != null && subscription?.paddleSubscriptionId != null;

  return (
    <>
      <span className="bl-status" data-tone={status.tone} data-testid="billing-status">
        <span className="bl-status-dot" aria-hidden="true" />
        <span>{status.label}</span>
      </span>
      {status.helpText ? <p className="bl-help">{status.helpText}</p> : null}
      {cycleLabel ? <p className="bl-cycle">{cycleLabel}</p> : null}
      {renewalDate ? <p className="bl-renewal bl-mono">Renews {formatBillingDate(renewalDate)}</p> : null}
      <BillingActions isManual={false} isCanceled={isCanceled} canManageBilling={canManageBilling} />
    </>
  );
}

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error: rawError } = await searchParams;
  const errorMessage = messageForBillingErrorCode(rawError);

  const seller = await requireSeller();
  if (!seller) {
    redirect("/admin/login");
  }

  const subscription = seller.tenantId ? await findByTenantId(seller.tenantId) : null;
  const entitlement = resolveEntitlement(subscription, new Date());
  const isManual = entitlement.source === "manual";

  const planName = planDisplayName(entitlement);
  const allowanceLabel = activeDealsAllowanceLabel(entitlement.maxActiveDeals);

  const activeDealCount = await readActiveDealCount(seller.tenantId);

  return (
    <main data-surface="settings-billing" data-testid="billing-page" className="bl-page">
      <div className="bl-header">
        <p className="bl-back">
          <Link href="/admin">← Back to dashboard</Link>
        </p>
        <h1 className="bl-title">Billing</h1>
        <p className="bl-subtitle">Manage your Brava plan and payment details.</p>
      </div>

      {errorMessage ? (
        <p className="bl-error" role="status" data-testid="billing-error">
          {errorMessage}
        </p>
      ) : null}

      <section className="bl-card" data-testid="billing-plan-card">
        <p className="bl-plan-name">{planName}</p>
        <p className="bl-mono bl-allowance">{allowanceLabel}</p>
        {/* T60: what the plan includes, then what is in use. Omitted rather
            than guessed at when the count could not be read. */}
        {activeDealCount === null ? null : (
          <p className="bl-mono bl-deals-used" data-testid="billing-deals-used">
            {activeDealsUsedLabel(activeDealCount, entitlement.maxActiveDeals)}
          </p>
        )}
        <BillingCardBody isManual={isManual} subscription={subscription} entitlement={entitlement} />
      </section>
    </main>
  );
}
