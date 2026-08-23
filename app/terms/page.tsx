import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/legal/legal-page-layout";

export const metadata: Metadata = {
  title: "Terms of service — Brava",
};

/**
 * T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Draft, generic
 * B2B SaaS terms of service. The legal entity name is an obvious
 * [PLACEHOLDER — legal entity name] rather than a guessed real one: this
 * copy is explicitly unapproved (see the layout's banner) and must never
 * read as if it were finished.
 */
export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of service" updatedLabel="Draft — no effective date yet">
      <p className="lg-body">
        Brava is operated by [PLACEHOLDER — legal entity name] (&quot;Brava&quot;, &quot;we&quot;, &quot;us&quot;).
        These terms govern your access to and use of Brava. By creating an account or using Brava, you agree to
        these terms.
      </p>

      <h2 className="lg-section-title">Your account</h2>
      <p className="lg-body">
        You&apos;re responsible for the accuracy of the information you provide and for anything that happens
        under your account. Tell us right away if you think your account has been accessed without your
        permission.
      </p>

      <h2 className="lg-section-title">Acceptable use</h2>
      <p className="lg-body">
        Use Brava only for its intended purpose — running a shared success plan with your buyer. Don&apos;t
        misuse Brava, attempt to disrupt it, or use it to store or share anything you don&apos;t have the right
        to share.
      </p>

      <h2 className="lg-section-title">Subscriptions and billing</h2>
      <p className="lg-body">
        Paid plans renew automatically each billing cycle until cancelled. You can cancel at any time; access
        continues until the end of the current billing cycle. See our{" "}
        <a href="/refunds">refund policy</a> for details on refunds.
      </p>

      <h2 className="lg-section-title">Termination</h2>
      <p className="lg-body">
        You may stop using Brava at any time. We may suspend or terminate accounts that violate these terms or
        put other users&apos; data at risk.
      </p>

      <h2 className="lg-section-title">Changes to these terms</h2>
      <p className="lg-body">
        We may update these terms from time to time. We&apos;ll let you know about material changes before they
        take effect.
      </p>

      <h2 className="lg-section-title">Contact</h2>
      <p className="lg-body">
        Questions about these terms? Reach us at{" "}
        <span className="lg-placeholder">[PLACEHOLDER — legal contact email]</span>.
      </p>
    </LegalPageLayout>
  );
}
