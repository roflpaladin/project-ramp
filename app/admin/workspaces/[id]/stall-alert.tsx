import type { EngagementSignal } from "@/lib/plans/engagement";
import { describeEngagementState } from "./engagement-copy";
import "./stall-alert.css";

export interface StallAlertProps {
  signal: EngagementSignal;
  /** app/admin/workspaces/[id]/plan — the seller's one real destination for acting on a stalled plan. */
  planHref: string;
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
 *     page too, above this component — it contributes ZERO Signal elements
 *     by design (every CTA there is plain/secondary), so it never competes
 *     with this file's `.wsa-cta` or invite-panel.tsx's own Signal pair.
 */
export function StallAlert({ signal, planHref }: StallAlertProps) {
  if (signal.state === "active") return null;

  const isStalled = signal.state === "stalled";
  const label = describeEngagementState(signal);

  return (
    <div className="wsa-alert" data-surface="stall-alert" data-tone={signal.state} data-testid="stall-alert">
      <span className="wsa-status">
        <span className="wsa-dot" data-status-dot="" aria-hidden="true" />
        <span className="wsa-label">{label}</span>
      </span>
      {isStalled ? (
        <a href={planHref} className="wsa-cta" data-signal="true">
          Review plan
        </a>
      ) : null}
    </div>
  );
}
