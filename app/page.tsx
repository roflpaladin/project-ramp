import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { getLandingMode } from "@/lib/landing/mode";
import { HEADLINE_VARIANT_COOKIE_NAME, resolveHeadlineVariant } from "@/lib/landing/headline-variant";
import {
  LANDING_HERO_NOTE,
  LANDING_KICKER,
  LANDING_SUBLINE,
  LANDING_VALUE_PROPS,
} from "./landing-copy";
import { HEADLINE_VARIANTS } from "./landing-variants";
import { HeadlineImpressionPing } from "./headline-impression";
import { WaitlistForm } from "./waitlist-form";
import "./landing.css";

// The root layout's metadata.title ("Project Ramp" — the internal codename,
// fine for code/internal surfaces per CLAUDE.md) is overridden here: the
// landing page is user-facing, so its browser tab title uses the product's
// public name, Brava, same as every other user-facing surface.
export const metadata: Metadata = {
  title: "Brava — one plan, one next move",
  description: "The shared workspace where a seller and a buyer commit to a plan and act on it together.",
};

/**
 * T47 (Sprint 9, Ticket 47 — public landing page). Phase 2 design pass: the
 * founder ruled out a purchased template (designed in-house from the brand
 * system) and, mid-pass, called for restraint over ambition ahead of an
 * accelerated publish date — a clean typographic hero, generous whitespace,
 * a calm value-prop section, one Signal CTA, a solid footer. An earlier
 * draft of this pass explored a small abstract "plan preview" illustration
 * (an aria-hidden mock of a milestone row, built from the same seller/buyer
 * tint tokens the real product uses) next to the hero copy; it was cut here
 * on the founder's explicit "simpler" call rather than shipped at partial
 * polish — the two value props below ("always clear whose move it is",
 * "progress your buyer can see too") already carry that same story in text.
 * Nothing about that decision is permanent; a future design pass can revisit
 * it with room to execute it properly.
 *
 * Server Component by default — the only interactive piece is WaitlistForm,
 * split out as its own "use client" module so this page itself never needs
 * one. The CTA is mode-driven (lib/landing/mode.ts): "waitlist" (the
 * default, ahead of a public launch) renders WaitlistForm; "signup" renders
 * a plain link to /register instead. Exactly one of the two ever renders, so
 * the hero always carries the page's single Signal element regardless of
 * mode.
 *
 * The wordmark (.lp-mark) and the "What Brava is" section marker
 * (.lp-gesture) both render in --signal, but neither carries the
 * data-signal="true" attribute this codebase reserves for the one
 * interactive action per scope (see onboarding-flow.tsx, invite-panel.tsx,
 * stall-alert.tsx) — they're the brand gesture, not a second call to
 * action. Per the live guideline §9, the signature gesture is explicitly
 * reusable in exactly these spots (logo underline, section marker) in
 * addition to Signal's other two allowed jobs (primary action, live step);
 * it is a documented brand device, not a competing CTA, so it does not
 * count against "one Signal element per decision scope" — that rule is
 * about the action, asserted here by the data-signal attribute staying
 * singular (tests/components/landing-page.dom.spec.tsx pins this).
 *
 * T48: async now (was a plain sync Server Component) because it reads the
 * `brava_hl` headline-variant cookie via next/headers `cookies()` below.
 * That read is a deliberate trade-off, not an oversight: it forces this
 * page out of static generation (a client-assigned variant would have kept
 * it static, but flashes the control headline at every candidate-group
 * visitor on first paint) in exchange for a correct, flash-free A/B test —
 * middleware.ts assigns the cookie before this render, and the value is
 * still re-validated with isHeadlineVariantId here (never trusted blindly).
 */
export default async function Home() {
  const mode = getLandingMode();
  const cookieStore = await cookies();
  const headlineVariant = resolveHeadlineVariant(cookieStore.get(HEADLINE_VARIANT_COOKIE_NAME)?.value);

  return (
    <main data-surface="landing" data-testid="landing-page" className="lp-page">
      <header className="lp-header">
        <span className="lp-mark">brava</span>
      </header>

      <section className="lp-hero">
        <p className="lp-kicker">{LANDING_KICKER}</p>
        <h1 className="lp-headline">{HEADLINE_VARIANTS[headlineVariant]}</h1>
        <p className="lp-subline">{LANDING_SUBLINE}</p>

        <div className="lp-hero-cta">
          {mode === "waitlist" ? (
            <WaitlistForm headlineVariant={headlineVariant} />
          ) : (
            <Link href="/register" className="lp-btn lp-btn-primary" data-signal="true">
              Create your account
            </Link>
          )}
          <p className="lp-hero-note">{LANDING_HERO_NOTE}</p>
        </div>
      </section>

      <HeadlineImpressionPing variant={headlineVariant} />

      <section aria-labelledby="lp-value-props-heading">
        <h2 id="lp-value-props-heading" className="lp-section-title">
          <span className="lp-gesture" aria-hidden="true" />
          What Brava is
        </h2>
        <ul className="lp-value-grid">
          {LANDING_VALUE_PROPS.map((prop, index) => (
            <li key={prop.title} className="lp-value-card">
              <span className="lp-value-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="lp-value-title">{prop.title}</h3>
              <p className="lp-value-body">{prop.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <span className="lp-mark lp-mark--footer">brava</span>
          <p className="lp-footer-tagline">One plan. One next move.</p>
        </div>
        <nav className="lp-footer-nav" aria-label="Legal">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refunds">Refunds</Link>
        </nav>
      </footer>
    </main>
  );
}
