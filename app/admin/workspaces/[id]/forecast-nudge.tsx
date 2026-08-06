import type { EngagementSignal } from "@/lib/plans/engagement";

/**
 * The forecast nudge (Ticket 31, T31-4) — derived entirely from
 * `computeEngagementSignal`'s real output, never a hardcoded string. This is
 * the single amber Signal in the seller-workspace-page scope: only the
 * "stalled" state earns `tone: "signal"`. "waiting" and "active" both render
 * in Slate (`tone: "wait"`) per the design guideline — waiting/pending states
 * never render in a loud colour, and only "stalled" is the action-now moment
 * this nudge exists to surface.
 */
export type ForecastNudgeTone = "signal" | "wait";

export interface ForecastNudgeMeta {
  readonly tone: ForecastNudgeTone;
  readonly label: string;
}

function describeRecency(daysSinceLastActivity: number | null): string {
  if (daysSinceLastActivity === null) return "no recorded activity yet";
  if (daysSinceLastActivity === 0) return "active today";
  if (daysSinceLastActivity === 1) return "active 1 day ago";
  return `active ${daysSinceLastActivity} days ago`;
}

/**
 * Pure derivation — kept separate from the rendered component so it's
 * unit-testable on its own (mirrors plan/status-badge.tsx's
 * planStatusMeta/StatusBadge split).
 */
export function deriveForecastNudge(signal: EngagementSignal): ForecastNudgeMeta {
  switch (signal.state) {
    case "stalled": {
      const stepWord = signal.openBuyerStepCount === 1 ? "step" : "steps";
      return {
        tone: "signal",
        label: `Buyer's gone quiet — ${signal.openBuyerStepCount} open buyer ${stepWord} waiting on them. Send a nudge.`,
      };
    }
    case "waiting":
      return {
        tone: "wait",
        label: "Waiting on you — no open buyer steps right now.",
      };
    case "active":
      return {
        tone: "wait",
        label: `Buyer's engaged — ${describeRecency(signal.daysSinceLastActivity)}.`,
      };
  }
}

interface ForecastNudgeProps {
  signal: EngagementSignal;
}

/** Status is never colour-only (design system MUST) — always a dot next to the text label. */
export function ForecastNudge({ signal }: ForecastNudgeProps) {
  const meta = deriveForecastNudge(signal);
  const dotColor = meta.tone === "signal" ? "var(--signal)" : "var(--state-wait)";

  return (
    <p className="cfs-nudge" data-tone={meta.tone}>
      <span className="cfs-nudge-dot" aria-hidden="true" style={{ backgroundColor: dotColor }} />
      <span>{meta.label}</span>
    </p>
  );
}
