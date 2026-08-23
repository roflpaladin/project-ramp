import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/legal/legal-page-layout";

export const metadata: Metadata = {
  title: "Terms of service — Brava",
};

const PADDLE_BUYER_TERMS_URL = "https://www.paddle.com/legal/checkout-buyer-terms";

/**
 * T47 (Sprint 9, Ticket 47). Founder-approved terms of service — verbatim
 * from the approved draft (source: coordinator-supplied
 * brava-legal-pages-draft.md, "Page 1"). No paraphrasing; markdown
 * structure (headings, lists) carried over 1:1 into this surface's existing
 * .lg-section-title / .lg-body / .lg-list classes.
 */
export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of service">
      <h2 className="lg-section-title">Who we are</h2>
      <p className="lg-body">
        Brava is a shared workspace where a seller and a buyer commit to a mutual success plan and act on it
        together. Brava is operated by PT Arasaka Global Consulting (&quot;we&quot;, &quot;us&quot;). By creating
        an account or using Brava, you agree to these terms.
      </p>

      <h2 className="lg-section-title">Your account</h2>
      <ul className="lg-list">
        <li>
          You need an account to use Brava as a seller. You&apos;re responsible for keeping your login
          credentials safe and for everything done under your account.
        </li>
        <li>
          Buyers you invite access a limited portal through a personal invitation link. They don&apos;t need an
          account, and their access is controlled by you.
        </li>
        <li>You must provide accurate information and be legally able to enter into contracts.</li>
      </ul>

      <h2 className="lg-section-title">Your content</h2>
      <ul className="lg-list">
        <li>
          The deal information, plans, and other content you put into Brava belong to you or your organization.
          We don&apos;t claim ownership of it.
        </li>
        <li>
          You give us permission to store and process that content solely to provide the service to you and the
          people you share it with.
        </li>
        <li>
          You&apos;re responsible for having the right to upload the content you upload — including any
          information about your customers or prospects.
        </li>
      </ul>

      <h2 className="lg-section-title">Acceptable use</h2>
      <p className="lg-body">You agree not to:</p>
      <ul className="lg-list">
        <li>use Brava to store or share anything unlawful, or to violate anyone else&apos;s rights;</li>
        <li>
          attempt to access other customers&apos; data, probe or overload our systems, or bypass usage limits;
        </li>
        <li>upload malicious files or content designed to harm us or other users;</li>
        <li>resell or white-label Brava without a written agreement with us.</li>
      </ul>
      <p className="lg-body">We may suspend or close accounts that break these rules.</p>

      <h2 className="lg-section-title">Free period, plans and payment</h2>
      <ul className="lg-list">
        <li>
          Brava is currently offered free of charge while in early access. Paid subscriptions will be introduced
          later.
        </li>
        <li>
          When paid plans launch, payments will be handled by Paddle.com, our merchant of record. Paddle handles
          checkout, billing, invoices, and sales tax, and their{" "}
          <a href={PADDLE_BUYER_TERMS_URL} target="_blank" rel="noopener noreferrer">
            buyer terms
          </a>{" "}
          apply to purchases alongside these terms.
        </li>
        <li>
          Prices and what each plan includes will be shown clearly before you pay. We&apos;ll give reasonable
          notice of price changes, which take effect at your next renewal.
        </li>
      </ul>

      <h2 className="lg-section-title">Service availability and changes</h2>
      <ul className="lg-list">
        <li>
          We work hard to keep Brava available and fast, but we don&apos;t promise uninterrupted or error-free
          service, especially during early access.
        </li>
        <li>
          We may add, change, or remove features. If we ever discontinue Brava entirely, we&apos;ll give you
          reasonable notice and a way to export your data.
        </li>
      </ul>

      <h2 className="lg-section-title">Ending the relationship</h2>
      <ul className="lg-list">
        <li>
          You can stop using Brava and ask us to delete your account and data at any time by emailing
          dimas@getbrava.tech.
        </li>
        <li>We can suspend or terminate accounts that violate these terms, with notice where reasonable.</li>
      </ul>

      <h2 className="lg-section-title">The legal essentials</h2>
      <ul className="lg-list">
        <li>
          Brava is provided &quot;as is&quot;. To the maximum extent the law allows, we disclaim implied
          warranties and our total liability to you is limited to the amount you paid us in the twelve months
          before the claim (or, if you haven&apos;t paid anything, USD 100).
        </li>
        <li>Nothing in these terms limits liability that can&apos;t legally be limited.</li>
        <li>
          These terms are governed by the laws of the Republic of Indonesia. If a dispute arises, we&apos;ll
          first try in good faith to resolve it directly with you.
        </li>
      </ul>

      <h2 className="lg-section-title">Changes to these terms</h2>
      <p className="lg-body">
        We may update these terms as Brava evolves. For meaningful changes we&apos;ll notify you by email or in
        the product before they take effect. Continuing to use Brava after that means you accept the updated
        terms.
      </p>

      <p className="lg-body">
        <strong>Questions:</strong> dimas@getbrava.tech
      </p>
    </LegalPageLayout>
  );
}
