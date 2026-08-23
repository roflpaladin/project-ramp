import type { Metadata } from "next";
import Link from "next/link";
import { getLandingMode } from "@/lib/landing/mode";
import { LANDING_HEADLINE, LANDING_SUBLINE, LANDING_VALUE_PROPS } from "./landing-copy";
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
 * T47 (Sprint 9, Ticket 47 — public landing page, phase 1: structure +
 * tokens; a visual/template pass follows in phase 2). Server Component by
 * default — the only interactive piece is WaitlistForm, split out as its
 * own "use client" module so this page itself never needs one.
 *
 * The CTA is mode-driven (lib/landing/mode.ts): "waitlist" (the default,
 * ahead of a public launch) renders WaitlistForm; "signup" renders a plain
 * link to /register instead. Exactly one of the two ever renders, so the
 * hero always carries the page's single Signal element regardless of mode.
 */
export default function Home() {
  const mode = getLandingMode();

  return (
    <main data-surface="landing" data-testid="landing-page" className="lp-page">
      <section className="lp-hero">
        <h1 className="lp-headline">{LANDING_HEADLINE}</h1>
        <p className="lp-subline">{LANDING_SUBLINE}</p>
        {mode === "waitlist" ? (
          <WaitlistForm />
        ) : (
          <Link href="/register" className="lp-btn lp-btn-primary" data-signal="true">
            Create your account
          </Link>
        )}
      </section>

      <section aria-labelledby="lp-value-props-heading">
        <h2 id="lp-value-props-heading" className="lp-section-title">
          What Brava is
        </h2>
        <ul className="lp-value-grid">
          {LANDING_VALUE_PROPS.map((prop) => (
            <li key={prop.title} className="lp-value-card">
              <h3 className="lp-value-title">{prop.title}</h3>
              <p className="lp-value-body">{prop.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="lp-footer">
        <nav className="lp-footer-nav" aria-label="Legal">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refunds">Refunds</Link>
        </nav>
      </footer>
    </main>
  );
}
