import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/legal/legal-page-layout";

export const metadata: Metadata = {
  title: "Privacy policy — Brava",
};

const PADDLE_PRIVACY_URL = "https://www.paddle.com/legal/privacy";

/**
 * T47 (Sprint 9, Ticket 47). Founder-approved privacy policy — originally
 * verbatim from the approved draft (source: coordinator-supplied
 * brava-legal-pages-draft.md, "Page 2"). The providers table is a real
 * <table> (.lg-table).
 *
 * Revised 2026-10-11 for Paddle's KYB website review: paid plans are live,
 * and Paddle's privacy-notice checklist adds controller status, legal basis,
 * recipients beyond providers, retention, security, and a cookie notice.
 * Founder ruling: entity shown with its country (Indonesia), no street
 * address. Email moved from Google Workspace SMTP to Resend (lib/email).
 */
export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy policy">
      <p className="lg-body">
        PT Arasaka Global Consulting, a company registered in Indonesia, is the controller of the personal data
        described here and operates Brava (&quot;we&quot;, &quot;us&quot;). This page explains what we collect,
        why, and what your rights are — in plain language, because that&apos;s how we build everything.
      </p>
      <p className="lg-body">
        For the deal and plan content sellers put into Brava about their own customers, we process it on the
        seller&apos;s behalf and only to provide the service to them.
      </p>

      <h2 className="lg-section-title">What we collect</h2>
      <ul className="lg-list">
        <li>
          <strong>Account details</strong> — your email address and password (stored in hashed form), and your
          company name.
        </li>
        <li>
          <strong>Workspace content</strong> — the deal and plan information you and your invited buyers put into
          Brava: company names, contact details, plan steps, notes, and files you upload (for example CSV
          imports).
        </li>
        <li>
          <strong>Buyer portal activity</strong> — when an invited buyer views or completes plan steps, we record
          that activity so both sides can see progress. Buyers are identified by the email address the seller
          invited.
        </li>
        <li>
          <strong>Billing details</strong> — when you buy a plan, Paddle collects your payment details directly.
          We receive your name, email, country, plan, and subscription status from Paddle. We never see or store
          your full card number.
        </li>
        <li>
          <strong>Waitlist details</strong> — if you join our waitlist: your email and, optionally, your company
          name.
        </li>
        <li>
          <strong>Technical basics</strong> — logs and cookies needed to keep you signed in and keep the service
          secure (see &quot;Cookies&quot; below).
        </li>
      </ul>

      <h2 className="lg-section-title">What we use it for, and our legal basis</h2>
      <ul className="lg-list">
        <li>
          <strong>Providing Brava</strong> — storing your plans, showing progress to both sides, sending
          invitation and login emails. Basis: our contract with you.
        </li>
        <li>
          <strong>Managing your subscription</strong> — plans, billing status, and invoices. Basis: our contract
          with you, and our legal duty to keep tax and accounting records.
        </li>
        <li>
          <strong>Keeping the service secure</strong> — rate limiting, abuse prevention, debugging. Basis: our
          legitimate interest in keeping Brava safe for everyone.
        </li>
        <li>
          <strong>Contacting you</strong> — service messages always (basis: our contract); product news only
          with your consent, and you can opt out at any time.
        </li>
      </ul>
      <p className="lg-body">
        We don&apos;t sell your data. We don&apos;t use your workspace content to train AI models.
      </p>

      <h2 className="lg-section-title">Who else touches your data</h2>
      <p className="lg-body">We use a small number of service providers to run Brava:</p>
      <table className="lg-table">
        <thead>
          <tr>
            <th scope="col">Provider</th>
            <th scope="col">What they do for us</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Supabase</td>
            <td>Database and authentication hosting</td>
          </tr>
          <tr>
            <td>Vercel</td>
            <td>Application hosting and content delivery</td>
          </tr>
          <tr>
            <td>Resend</td>
            <td>Sending transactional emails (invitations, login codes, password resets)</td>
          </tr>
          <tr>
            <td>Google Workspace</td>
            <td>Our business email, when you write to us</td>
          </tr>
          <tr>
            <td>Paddle</td>
            <td>Payments, billing, invoices, and sales tax, as our merchant of record</td>
          </tr>
        </tbody>
      </table>
      <p className="lg-body">
        Each provider processes data only to provide their service to us. Paddle also acts as an independent
        controller for the payment data it collects — see{" "}
        <a href={PADDLE_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
          Paddle&apos;s privacy policy
        </a>
        . We may also share data with our professional advisers (such as lawyers and accountants) where needed,
        and with authorities when the law requires it.
      </p>
      <p className="lg-body">
        These providers may store or process data outside your own country, including in the United States and
        the European Union. Where the law requires it, we rely on the safeguards they offer, such as standard
        contractual clauses.
      </p>

      <h2 className="lg-section-title">How long we keep it</h2>
      <ul className="lg-list">
        <li>
          Account and workspace data: for as long as your account is active, then deleted within 30 days of your
          request or of account closure.
        </li>
        <li>
          Billing records: for as long as tax and accounting law requires. Paddle keeps the payment records as
          merchant of record.
        </li>
        <li>Waitlist data: until you sign up, ask to be removed, or the waitlist is retired.</li>
        <li>Logs: kept briefly for security and debugging, then rotated out.</li>
      </ul>

      <h2 className="lg-section-title">How we protect it</h2>
      <p className="lg-body">
        All traffic to Brava is encrypted (HTTPS), and our hosting providers encrypt stored data. Each
        customer&apos;s data is kept separate by access rules enforced in the database, passwords are stored only
        in hashed form, and access to production systems is limited to the people who need it.
      </p>

      <h2 className="lg-section-title">Cookies</h2>
      <ul className="lg-list">
        <li>
          <strong>Login cookies</strong> — keep you signed in. They&apos;re essential, so the service can&apos;t
          work without them.
        </li>
        <li>
          <strong>Homepage cookie</strong> — remembers which version of our homepage headline you saw, for up to
          180 days. It holds no personal data.
        </li>
        <li>
          <strong>Checkout cookies</strong> — when you open checkout, Paddle may set its own cookies, covered by
          Paddle&apos;s privacy policy.
        </li>
      </ul>
      <p className="lg-body">We don&apos;t use advertising or third-party tracking cookies.</p>

      <h2 className="lg-section-title">Your rights</h2>
      <p className="lg-body">Email dimas@getbrava.tech and we will, subject to applicable law:</p>
      <ul className="lg-list">
        <li>show you the personal data we hold about you;</li>
        <li>correct it or delete it;</li>
        <li>export your workspace data in a usable format;</li>
        <li>stop or limit how we use it, or withdraw a consent you gave;</li>
        <li>remove you from the waitlist or marketing emails.</li>
      </ul>
      <p className="lg-body">
        We&apos;ll respond within 30 days. If you&apos;re unhappy with how we handle your data, you can also
        complain to your local data protection authority.
      </p>
      <p className="lg-body">
        If you&apos;re an invited buyer and want your activity removed, you can contact us directly or ask the
        seller who invited you.
      </p>

      <h2 className="lg-section-title">Changes to this policy</h2>
      <p className="lg-body">
        If we make meaningful changes, we&apos;ll notify account holders by email before they take effect.
      </p>

      <p className="lg-body">
        <strong>Privacy questions or requests:</strong> dimas@getbrava.tech
      </p>
    </LegalPageLayout>
  );
}
