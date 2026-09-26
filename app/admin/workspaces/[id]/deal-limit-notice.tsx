// Sprint 12, Ticket 60 — the upgrade wall.
//
// Founder ruling (2026-09-21): a seller at their limit can still build,
// read, invite and edit everything. ONLY "Make it live" is locked. This
// component is what takes that button's place (activation-checklist.tsx),
// and what the same card falls back to when the server refuses a go-live a
// stale page believed was allowed.
//
// Three notices, deliberately NOT one parameterised "you can't do that":
//   - "limit"    — the plan is full. Fix: close a deal, or upgrade. -> /pricing
//   - "past-due" — the payment failed. Fix: update the card. -> /settings/billing
//   - "unknown"  — WE could not check. No fix to sell, so no CTA at all;
//                  activation-checklist.tsx leaves the button enabled behind
//                  this one and lets the server be the authority.
// Rendering the upgrade wall for our own outage would be a lie about money,
// which is why the third one exists at all.
//
// Pure presentation — no hooks, no actions, no fetch. It is mounted inside a
// "use client" parent, so it needs no directive of its own.
//
// Signal budget: the CTA is the page's one Signal WHEN THE PAGE SAYS SO.
// workspace-signal-budget.ts resolves that once for the whole page and
// passes `canUseSignal` down; false renders the identical link, plain. The
// link is never removed — a wall with no way out is not a wall, it is a
// dead end.

import type { DealLimitReason } from "./deal-limit-state";
import "./deal-limit-notice.css";

export interface DealLimitNoticeProps {
  readonly reason: DealLimitReason;
  readonly activeCount: number | null;
  readonly maxActiveDeals: number | null;
  /** False when another element on this page already holds the one Signal. */
  readonly canUseSignal: boolean;
}

/** Slate for a state, risk for a real problem — never Signal, which is action only. */
type NoticeTone = "wait" | "risk";

interface NoticeCta {
  readonly label: string;
  readonly href: string;
}

interface NoticeCopy {
  readonly tone: NoticeTone;
  readonly label: string;
  readonly body: string;
  readonly cta: NoticeCta | null;
}

/**
 * Sentence case, active voice, no apology, no hype — and each one names both
 * what happened AND the next move, so the dot's colour is never the only
 * thing carrying meaning. Kept in step with the server-side wording in
 * plan/error-messages.ts, which says the same thing in one line when there
 * is no room for a card.
 */
const NOTICE_COPY: Record<DealLimitReason, NoticeCopy> = {
  limit: {
    tone: "wait",
    label: "At your deal limit",
    body: "You are using all the active deals your plan includes. Close a deal you have finished, or upgrade your plan, to make this one live.",
    cta: { label: "See plans", href: "/pricing" },
  },
  "past-due": {
    tone: "risk",
    label: "Payment failed",
    body: "Your last payment did not go through, so new deals are paused. Your existing deals and buyers keep working — update your payment details to make this one live.",
    cta: { label: "Update payment details", href: "/settings/billing" },
  },
  unknown: {
    tone: "wait",
    label: "Plan check unavailable",
    body: "We could not check your plan just now. Try again in a moment.",
    cta: null,
  },
};

/**
 * Geist Mono, per the design system's "data and numbers" rule. Null whenever
 * either half is missing — a half-known count ("3 of —") tells the seller
 * less than nothing.
 */
function countLabel(activeCount: number | null, maxActiveDeals: number | null): string | null {
  if (activeCount === null || maxActiveDeals === null) return null;
  return `${activeCount} of ${maxActiveDeals} active ${maxActiveDeals === 1 ? "deal" : "deals"}`;
}

export function DealLimitNotice({ reason, activeCount, maxActiveDeals, canUseSignal }: DealLimitNoticeProps) {
  const copy = NOTICE_COPY[reason];
  const count = countLabel(activeCount, maxActiveDeals);

  return (
    // role="status" (polite), not "alert": this is usually present on first
    // paint, and when it does arrive after a click it should be announced
    // without interrupting whatever the seller is doing.
    <div
      className="dln-notice"
      data-surface="deal-limit-notice"
      data-testid="deal-limit-notice"
      data-reason={reason}
      data-tone={copy.tone}
      role="status"
    >
      <span className="dln-status">
        <span className="dln-dot" data-status-dot="" aria-hidden="true" />
        <span className="dln-label">{copy.label}</span>
      </span>

      <p className="dln-body">{copy.body}</p>

      {count ? (
        <p className="dln-count" data-testid="deal-limit-count">
          {count}
        </p>
      ) : null}

      {copy.cta ? (
        <a
          href={copy.cta.href}
          className={canUseSignal ? "dln-cta dln-cta-signal" : "dln-cta"}
          data-signal={canUseSignal ? "true" : undefined}
        >
          {copy.cta.label}
        </a>
      ) : null}
    </div>
  );
}
