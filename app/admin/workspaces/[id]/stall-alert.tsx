import type { EngagementSignal } from "@/lib/plans/engagement";
import { describeEngagementState, describeQuietDeal, QUIET_DEAL_LINK_LABEL } from "./engagement-copy";
import "./stall-alert.css";

export interface StallAlertProps {
  signal: EngagementSignal;
  /** app/admin/workspaces/[id]/plan — the seller's one real destination for acting on a stalled plan. */
  planHref: string;
  /**
   * T60. True when the deal-limit wall above has taken this page's one
   * Signal. The CTA still renders and still links to the same place — it
   * just stops shouting. Defaults to false, so a page with no wall behaves
   * exactly as it did before this ticket.
   */
  isSignalSuppressed?: boolean;
}

/**
 * Stall alert (Sprint 7, Ticket 36; T36-5; plans/sprint-6-7-replan.md §7).
 * The seller dashboard's always-visible read of buyer engagement,
 * independent of whether the CRM strip is mounted — crm-forecast-strip.tsx
 * hides entirely when a workspace has never synced from a CRM (T31-5), so
 * this alert must not depend on that strip rendering at all.
 *
 * "active" is quiet by design: nothing to alert on, so this renders nothing
 * rather than a manufactured "all good" banner — no fifth loud colour, no
 * fabricated good news.
 *
 * "waiting" and "stalled" are both STATES, rendered identically in Slate —
 * dot + text label, never colour-only, never a loud colour. Per the design
 * guideline, "stalled" is waiting-flavoured, not an error: it never takes
 * --state-risk red here, only --state-wait (Slate).
 *
 * "stalled" additionally renders exactly ONE Signal element: a real
 * call-to-action linking to the plan builder, where the seller can actually
 * act on the open buyer step(s). That link (`.wsa-cta`, `data-signal="true"`)
 * is the only Signal-bearing element this component ever renders.
 *
 * One-Signal-per-scope audit for this page
 * (app/admin/workspaces/[id]/page.tsx), recorded here because this file is
 * where the page's Signal now lives:
 *   - forecast-nudge.tsx (Ticket 31) used to switch to Signal on "stalled" —
 *     corrected to Slate-only in this same ticket (T36-5), since it reads
 *     the identical engagement state this component does and a workspace
 *     with synced CRM data would otherwise carry two Signals at once.
 *   - chat-presence.tsx (Ticket 32) is neutral Slate by its own design; its
 *     header comment now points here instead of forecast-nudge.tsx.
 *   - plan/status-badge.tsx and buyer-workspace-view.tsx's own Signal card
 *     are scoped to different pages/routes (the plan builder and the buyer
 *     workspace, respectively) and are not in this page's decision scope.
 *   - activation-checklist.tsx (Sprint 11, Ticket 58) mounts on this same
 *     page too, above this component — every CTA it owns directly is
 *     plain/secondary. Sprint 12, Ticket 60 gave that card ONE conditional
 *     Signal (the deal-limit wall's upgrade CTA), and the two can no longer
 *     both shout: page.tsx resolves ownership once through
 *     workspace-signal-budget.ts and sets `isSignalSuppressed` here when the
 *     wall has taken it.
 *
 * T60 also folds the quiet-deal line into this same alert rather than adding
 * a second banner about the same silence — see engagement-copy.ts. That line
 * carries a PLAIN link, never a Signal.
 */
export function StallAlert({ signal, planHref, isSignalSuppressed = false }: StallAlertProps) {
  if (signal.state === "active") return null;

  const isStalled = signal.state === "stalled";
  const label = describeEngagementState(signal);
  const quietNote = describeQuietDeal(signal);

  return (
    <div className="wsa-alert" data-surface="stall-alert" data-tone={signal.state} data-testid="stall-alert">
      <span className="wsa-status">
        <span className="wsa-dot" data-status-dot="" aria-hidden="true" />
        <span className="wsa-label">{label}</span>
      </span>
      {isStalled ? (
        <a
          href={planHref}
          className={isSignalSuppressed ? "wsa-cta wsa-cta-plain" : "wsa-cta"}
          data-signal={isSignalSuppressed ? undefined : "true"}
        >
          Review plan
        </a>
      ) : null}
      {quietNote ? (
        <p className="wsa-quiet" data-testid="quiet-deal-note">
          {quietNote}{" "}
          <a href={planHref} className="wsa-quiet-link">
            {QUIET_DEAL_LINK_LABEL}
          </a>
        </p>
      ) : null}
    </div>
  );
}
