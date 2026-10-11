import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/legal/legal-page-layout";

export const metadata: Metadata = {
  title: "Refund policy — Brava",
};

const PADDLE_BUYER_TERMS_URL = "https://www.paddle.com/legal/checkout-buyer-terms";
const PADDLE_ORDER_LOOKUP_URL = "https://paddle.net";

/**
 * T47 (Sprint 9, Ticket 47). Founder-approved refund policy — originally
 * verbatim from the approved draft (source: coordinator-supplied
 * brava-legal-pages-draft.md, "Page 3").
 *
 * Revised 2026-10-11 for Paddle's KYB website review: paid plans are live,
 * and the founder ruled a 14-day full refund on ANY payment (renewals
 * included) — Paddle requires a 14–90 day window with no "no refunds"
 * qualifiers, and a refund route via paddle.net.
 */
export default function RefundsPage() {
  return (
    <LegalPageLayout title="Refund policy">
      <h2 className="lg-section-title">Our 14-day refund promise</h2>
      <p className="lg-body">
        If Brava isn&apos;t right for you, ask us within 14 days of any payment — your first purchase and
        renewals included — and we&apos;ll refund that payment in full. No questions, no hoops.
      </p>

      <h2 className="lg-section-title">Who processes your payment</h2>
      <p className="lg-body">
        Payments for Brava are processed by <strong>Paddle.com</strong>, our merchant of record. Your invoice and
        card statement will show Paddle, and refunds are issued through Paddle.
      </p>

      <h2 className="lg-section-title">Cancelling</h2>
      <p className="lg-body">
        You can cancel your subscription at any time from Settings → Billing. Your plan stays active until the end
        of the period you&apos;ve paid for, and you won&apos;t be charged again.
      </p>

      <h2 className="lg-section-title">How to ask for a refund</h2>
      <ul className="lg-list">
        <li>
          Email dimas@getbrava.tech from the address on your account with your invoice number (it&apos;s on the
          Paddle receipt). We aim to respond within 2 business days.
        </li>
        <li>
          Or go to{" "}
          <a href={PADDLE_ORDER_LOOKUP_URL} target="_blank" rel="noopener noreferrer">
            paddle.net
          </a>
          , look up your order with the email you paid with, and request a refund there.
        </li>
      </ul>
      <p className="lg-body">
        Refunds go back to your original payment method, usually within 5–10 business days.
      </p>

      <h2 className="lg-section-title">The fine print</h2>
      <p className="lg-body">
        This policy doesn&apos;t limit any rights you have under the consumer laws of your country, or under
        Paddle&apos;s own{" "}
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
