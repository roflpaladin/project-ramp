import type { Metadata } from "next";
import { LegalPageLayout } from "@/app/legal/legal-page-layout";

export const metadata: Metadata = {
  title: "Privacy policy — Brava",
};

/**
 * T47 (Sprint 9, Ticket 47). Founder-approved privacy policy — verbatim
 * from the approved draft (source: coordinator-supplied
 * brava-legal-pages-draft.md, "Page 2"). No paraphrasing; the providers
 * table is carried over 1:1 as a real <table> (.lg-table).
 */
export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy policy">
      <p className="lg-body">
        Brava is operated by PT Arasaka Global Consulting. This page explains what we collect, why, and what your
        rights are — in plain language, because that&apos;s how we build everything.
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
          <strong>Waitlist details</strong> — if you join our waitlist: your email and, optionally, your company
          name.
        </li>
        <li>
          <strong>Technical basics</strong> — logs and cookies needed to keep you signed in and keep the service
          secure. We use session cookies for login; we don&apos;t run third-party advertising trackers.
        </li>
      </ul>

      <h2 className="lg-section-title">What we use it for</h2>
      <ul className="lg-list">
        <li>
          To provide Brava: storing your plans, showing progress to both sides, sending invitation and login
          emails.
        </li>
        <li>To secure the service: rate limiting, abuse prevention, debugging.</li>
        <li>
          To contact you about the product — service messages always; product news only where permitted, and you
          can opt out.
        </li>
        <li>When paid plans launch: to manage your subscription (see &quot;Who else touches your data&quot;).</li>
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
            <td>Google Workspace</td>
            <td>Sending transactional emails (invitations, login links)</td>
          </tr>
          <tr>
            <td>Paddle</td>
            <td>Payments and billing, as merchant of record (when paid plans launch)</td>
          </tr>
        </tbody>
      </table>
      <p className="lg-body">
        Each processes data only to provide their service to us. Your data may be stored or processed outside
        your own country by these providers.
      </p>

      <h2 className="lg-section-title">How long we keep it</h2>
      <ul className="lg-list">
        <li>
          Account and workspace data: for as long as your account is active, then deleted on request or within a
          reasonable period after account closure.
        </li>
        <li>Waitlist data: until you sign up, ask to be removed, or the waitlist is retired.</li>
        <li>Logs: kept briefly for security and debugging, then rotated out.</li>
      </ul>

      <h2 className="lg-section-title">Your rights</h2>
      <p className="lg-body">Email dimas@getbrava.tech and we will, subject to applicable law:</p>
      <ul className="lg-list">
        <li>show you the personal data we hold about you;</li>
        <li>correct it or delete it;</li>
        <li>export your workspace data in a usable format;</li>
        <li>remove you from the waitlist or marketing emails.</li>
      </ul>
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
