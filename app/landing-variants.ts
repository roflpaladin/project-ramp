// Sprint 9, Ticket 48 — headline variant definitions for the landing page
// A/B test. This file is the single shared contract between the client
// (variant assignment + rendering in app/page.tsx) and the server
// (app/api/landing-events/route.ts validates reported variant ids against
// HEADLINE_VARIANT_IDS — never trusts a free-text variant from the wire).
//
// Copy voice rules match app/landing-copy.ts: active voice, sentence case,
// no hype, no "!", none of the banned words (leverage, synergy, supercharge,
// seamless, unlock, empower, effortless, revolutionise). The candidate
// headline is a DRAFT pending founder critique — flagged in the T48 PR body.

import { LANDING_HEADLINE } from "./landing-copy";

export const HEADLINE_VARIANT_IDS = ["control", "with-not-at"] as const;

export type HeadlineVariantId = (typeof HEADLINE_VARIANT_IDS)[number];

export const HEADLINE_VARIANTS: Readonly<Record<HeadlineVariantId, string>> = {
  // The shipped T47 headline — clarity/next-move angle.
  control: LANDING_HEADLINE,
  // Candidate — collaboration angle, tests whether naming the behaviour
  // shift ("with, not at") outpulls the product description.
  "with-not-at": "Sell with your buyer, not at them.",
};

export function isHeadlineVariantId(value: unknown): value is HeadlineVariantId {
  return (
    typeof value === "string" &&
    (HEADLINE_VARIANT_IDS as readonly string[]).includes(value)
  );
}

/** Waitlist `source` attribution value for a signup that converted under a
 * given headline variant (column reserved for T48 by 0008_waitlist.sql). */
export function headlineSourceTag(variant: HeadlineVariantId): string {
  return `headline:${variant}`;
}
