import { cn } from "@/lib/utils";
import type { PlanStatus, StageStatus, StepStatus } from "@/lib/plans/types";

export type StatusTone = "done" | "risk" | "wait";

interface StatusMeta {
  readonly tone: StatusTone;
  readonly label: string;
}

const TONE_COLOR: Record<StatusTone, string> = {
  done: "var(--state-done)",
  risk: "var(--state-risk)",
  wait: "var(--state-wait)",
};

interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
  className?: string;
}

/** Status is never colour-only (design system MUST) — always a dot next to the text label. */
export function StatusBadge({ tone, label, className }: StatusBadgeProps) {
  return (
    <span className={cn("plan-status-badge", className)} data-tone={tone}>
      <span className="plan-status-dot" aria-hidden="true" style={{ backgroundColor: TONE_COLOR[tone] }} />
      <span>{label}</span>
    </span>
  );
}

/**
 * Only 'won' (done) and 'lost' (risk) are outcome states — 'draft' and
 * 'active' are ordinary waiting/in-progress states, so per the design
 * system's "waiting renders in Slate, never a loud colour" rule they map to
 * `wait`, not a loud tone.
 */
export function planStatusMeta(status: PlanStatus): StatusMeta {
  switch (status) {
    case "won":
      return { tone: "done", label: "Won" };
    case "lost":
      return { tone: "risk", label: "Lost" };
    case "active":
      return { tone: "wait", label: "Active" };
    case "draft":
      return { tone: "wait", label: "Draft" };
  }
}

export function stageStatusMeta(status: StageStatus): StatusMeta {
  switch (status) {
    case "done":
      return { tone: "done", label: "Done" };
    case "current":
      return { tone: "wait", label: "In progress" };
    case "upcoming":
      return { tone: "wait", label: "Upcoming" };
  }
}

/** 'blocked' is the only step-level outcome that reads as risk — 'open' is ordinary waiting. */
export function stepStatusMeta(status: StepStatus): StatusMeta {
  switch (status) {
    case "done":
      return { tone: "done", label: "Done" };
    case "blocked":
      return { tone: "risk", label: "Blocked" };
    case "open":
      return { tone: "wait", label: "Open" };
  }
}
