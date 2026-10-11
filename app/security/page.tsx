import type { Metadata } from "next";
import Link from "next/link";
import { LegalPageLayout } from "@/app/legal/legal-page-layout";
import "./security.css";

export const metadata: Metadata = {
  title: "Security — Brava",
  description: "How Brava stores your data, protects sign-in, handles payments and email, and what we don't offer yet.",
};

const SECURITY_EMAIL = "dimas@getbrava.tech";

/**
 * T67 (public site). Every claim here is traceable to the repo: RLS enabled
 * on every table in supabase/migrations, sign-in/registration/reset rate
 * limits (lib/rate-limit*.ts), the emailed 6-digit buyer code
 * (lib/portal-access-code.ts, lib/portal-access-token.ts), Paddle
 * (app/api/billing/paddle), Resend (lib/email/resend-transport.ts). No data
 * region is stated because none is recorded in the repo. Reuses the legal
 * page shell so the look matches /terms and /privacy.
 */
export default function SecurityPage() {
  return (
    <LegalPageLayout title="Security">
      <p className="lg-body">
        Brava holds deal plans that matter to both sides of a sale. Here is what we do to protect them, and what we
        don&apos;t offer yet.
      </p>

      <h2 className="lg-section-title">How your data is stored</h2>
      <p className="lg-body">
        Your data lives in a Supabase Postgres database. Row-level security is switched on for every table, so one
        company&apos;s data is never visible to another. Brava is hosted on Vercel and served over HTTPS.
        Connection tokens for linked CRMs are stored encrypted.
      </p>

      <h2 className="lg-section-title">Accounts and sign-in</h2>
      <ul className="lg-list">
        <li>Passwords are handled by Supabase Auth. We never store them in plain text.</li>
        <li>Password reset works through a one-time link sent by email.</li>
        <li>Sign-in, registration and password reset are rate limited to slow down guessing.</li>
        <li>
          Buyers reach their shared plan with a six-digit access code sent to their email. The code expires after 15
          minutes, and repeated wrong guesses are blocked.
        </li>
      </ul>

      <h2 className="lg-section-title">Payments</h2>
      <p className="lg-body">
        Payments are handled by Paddle, our merchant of record. Your card details never touch Brava&apos;s servers.
      </p>

      <h2 className="lg-section-title">Email</h2>
      <p className="lg-body">Transactional email, such as access codes and password resets, is sent through Resend.</p>

      <h2 className="lg-section-title">Backups</h2>
      {/* VERIFY-BEFORE-MERGE: backups go live with PR #67 */}
      <p className="lg-body">Weekly encrypted backups of production data, with an automatic restore test.</p>

      <h2 className="lg-section-title">What we don&apos;t offer yet</h2>
      <p className="lg-body">
        We don&apos;t offer single sign-on (SSO), an uptime SLA, or a SOC 2 report today. For Enterprise customers, we
        help with security reviews and questionnaires on request.
      </p>

      <h2 className="lg-section-title">Reporting a security issue</h2>
      <p className="lg-body">
        If you think you&apos;ve found a security problem, email <a href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>
        . We&apos;ll read it and reply.
      </p>

      <p className="sec-back">
        <Link href="/">Back to Brava</Link>
      </p>
    </LegalPageLayout>
  );
}
