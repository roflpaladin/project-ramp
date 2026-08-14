import type { EngagementSignal } from "@/lib/plans/engagement";
import { describeEngagementState } from "./engagement-copy";

/**
 * The forecast nudge (Ticket 31, T31-4) — a contextual read of buyer
 * engagement inside the seller-private CRM strip.
 *
 * ALWAYS Slate (Sprint 7, Ticket 36, T36-5 correction): engagement state
 * (active/waiting/stalled) is a STATE, not an action, so per the design
 * guideline it never carries Signal — "waiting and stalled states rendered
 * in Slate ... never a loud colour" (plans/sprint-6-7-replan.md §7,
 * Ticket 36 row). Pre-Ticket-36 this component put the page's one Signal on
 * its own "stalled" state; that has moved to stall-alert.tsx's real
 * call-to-action (T36-5), which is mounted independently of whether this
 * CRM strip is even visible (crm-forecast-strip.tsx hides entirely when
 * crm_source IS NULL, T31-5) — so the page's one Signal budget can no longer
 * live inside a component that sometimes doesn't render at all.
 */
export interface ForecastNudgeMeta {
  readonly label: string;
}

/**
 * Pure derivation — kept separate from the rendered component so it's
 * unit-testable on its own (mirrors plan/status-badge.tsx's
 * planStatusMeta/StatusBadge split).
 */
export function deriveForecastNudge(signal: EngagementSignal): ForecastNudgeMeta {
  return { label: describeEngagementState(signal) };
}

interface ForecastNudgeProps {
  signal: EngagementSignal;
}

/** Status is never colour-only (design system MUST) — always a dot next to the text label. */
export function ForecastNudge({ signal }: ForecastNudgeProps) {
  const meta = deriveForecastNudge(signal);

  return (
    <p className="cfs-nudge">
      <span className="cfs-nudge-dot" aria-hidden="true" />
      <span>{meta.label}</span>
    </p>
  );
}
