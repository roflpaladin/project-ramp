import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/legal/legal-page-layout";

export const metadata: Metadata = {
  title: "Privacy policy — Brava",
};

/**
 * T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Draft, generic
 * B2B SaaS privacy policy. The legal entity name is an obvious
 * [PLACEHOLDER — legal entity name] rather than a guessed real one: this
 * copy is explicitly unapproved (see the layout's banner) and must never
 * read as if it were finished.
 */
export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy policy" updatedLabel="Draft — no effective date yet">
      <p className="lg-body">
        Brava is operated by [PLACEHOLDER — legal entity name] (&quot;Brava&quot;, &quot;we&quot;, &quot;us&quot;).
        This policy explains what data we collect, why we collect it, and how you can control it.
      </p>

      <h2 className="lg-section-title">What we collect</h2>
      <p className="lg-body">
        Account details you give us (name, work email, company), the plan and step data you and your buyer
        create inside a workspace, and basic usage data (like sign-in activity) that helps us keep Brava
        reliable and secure.
      </p>

      <h2 className="lg-section-title">How we use it</h2>
      <p className="lg-body">
        To run your workspace, keep your account secure, respond to support requests, and improve Brava. We
        don&apos;t sell your data.
      </p>

      <h2 className="lg-section-title">Who can see your data</h2>
      <p className="lg-body">
        A workspace&apos;s plan is visible to the seller and buyer on that deal, and to the people they invite
        into it. We use a small number of service providers (for example, hosting and email delivery) who
        process data on our behalf, under agreements that limit what they can do with it.
      </p>

      <h2 className="lg-section-title">Your choices</h2>
      <p className="lg-body">
        You can access, correct, or ask us to delete your account data at any time by contacting us using the
        details below.
      </p>

      <h2 className="lg-section-title">Changes to this policy</h2>
      <p className="lg-body">
        We may update this policy from time to time. We&apos;ll let you know about material changes before they
        take effect.
      </p>

      <h2 className="lg-section-title">Contact</h2>
      <p className="lg-body">
        Questions about this policy or your data? Reach us at{" "}
        <span className="lg-placeholder">[PLACEHOLDER — legal contact email]</span>.
      </p>
    </LegalPageLayout>
  );
}
