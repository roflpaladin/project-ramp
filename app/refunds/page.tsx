import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/legal/legal-page-layout";

export const metadata: Metadata = {
  title: "Refund policy — Brava",
};

/**
 * T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Draft refund
 * policy aligned with a subscription product (billing-cycle framing, not a
 * one-off purchase). The legal entity name is an obvious
 * [PLACEHOLDER — legal entity name] rather than a guessed real one: this
 * copy is explicitly unapproved (see the layout's banner) and must never
 * read as if it were finished.
 */
export default function RefundsPage() {
  return (
    <LegalPageLayout title="Refund policy" updatedLabel="Draft — no effective date yet">
      <p className="lg-body">
        Brava is a subscription product, billed by [PLACEHOLDER — legal entity name] on a recurring billing
        cycle. This policy explains how refunds and cancellations work.
      </p>

      <h2 className="lg-section-title">Cancelling your subscription</h2>
      <p className="lg-body">
        You can cancel your subscription at any time. Cancelling stops future billing cycles; you keep access
        to your current billing cycle&apos;s paid features until it ends.
      </p>

      <h2 className="lg-section-title">Refunds</h2>
      <p className="lg-body">
        If you believe you were charged in error, contact us within 14 days of the charge and we&apos;ll review
        it. We don&apos;t offer partial refunds for unused time within an active billing cycle, except where
        required by law.
      </p>

      <h2 className="lg-section-title">Trials</h2>
      <p className="lg-body">
        If Brava offers a free trial at the time you sign up, you won&apos;t be charged until the trial ends,
        and you can cancel before then at no cost.
      </p>

      <h2 className="lg-section-title">Changes to this policy</h2>
      <p className="lg-body">
        We may update this policy from time to time. We&apos;ll let you know about material changes before they
        take effect.
      </p>

      <h2 className="lg-section-title">Contact</h2>
      <p className="lg-body">
        Questions about a charge or a refund? Reach us at{" "}
        <span className="lg-placeholder">[PLACEHOLDER — legal contact email]</span>.
      </p>
    </LegalPageLayout>
  );
}
