import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/legal/legal-page-layout";

export const metadata: Metadata = {
  title: "Refund policy — Brava",
};

const PADDLE_BUYER_TERMS_URL = "https://www.paddle.com/legal/checkout-buyer-terms";

/**
 * T47 (Sprint 9, Ticket 47). Founder-approved refund policy — verbatim from
 * the approved draft (source: coordinator-supplied
 * brava-legal-pages-draft.md, "Page 3").
 */
export default function RefundsPage() {
  return (
    <LegalPageLayout title="Refund policy">
      <h2 className="lg-section-title">While Brava is free</h2>
      <p className="lg-body">
        Brava is currently in early access and free of charge, so there&apos;s nothing to refund. This policy
        takes effect when paid subscriptions launch.
      </p>

      <h2 className="lg-section-title">When paid plans launch</h2>
      <ul className="lg-list">
        <li>
          Payments for Brava are processed by <strong>Paddle.com</strong>, our merchant of record. Your invoice
          and card statement will show Paddle, and refunds are issued through Paddle.
        </li>
        <li>
          <strong>14-day guarantee:</strong> if Brava isn&apos;t right for you, contact us within 14 days of your
          first purchase and we&apos;ll refund it in full — no questions, no hoops.
        </li>
        <li>
          <strong>Renewals:</strong> we don&apos;t generally refund renewal charges, but if you cancel within 14
          days of an accidental renewal and haven&apos;t materially used the service in the new period, contact
          us and we&apos;ll make it right.
        </li>
        <li>
          <strong>Cancelling:</strong> you can cancel any time; your plan stays active until the end of the
          period you&apos;ve paid for, and you won&apos;t be charged again.
        </li>
      </ul>

      <h2 className="lg-section-title">How to ask</h2>
      <p className="lg-body">
        Email dimas@getbrava.tech from the address on your account with your invoice number (it&apos;s on the
        Paddle receipt). We aim to respond within 2 business days. Refunds are returned to your original payment
        method by Paddle, usually within 5–10 business days.
      </p>

      <h2 className="lg-section-title">The fine print</h2>
      <p className="lg-body">
        Refunds under this policy don&apos;t limit any rights you have under the consumer laws of your country,
        or under Paddle&apos;s own{" "}
        <a href={PADDLE_BUYER_TERMS_URL} target="_blank" rel="noopener noreferrer">
          buyer terms
        </a>
        .
      </p>

      <p className="lg-body">
        <strong>Questions:</strong> dimas@getbrava.tech
      </p>
    </LegalPageLayout>
  );
}
