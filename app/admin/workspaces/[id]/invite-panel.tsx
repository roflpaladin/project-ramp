"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { flipToBuyerView, sendBuyerInvite } from "./invite-actions";
import { INITIAL_SEND_INVITE_STATE, type SendInviteState } from "./invite-state";
import "./invite-panel.css";

export interface InvitePanelProps {
  workspaceId: string;
  /**
   * T43 (Sprint 8, Ticket 43). The signed-in seller's own inbox
   * (lib/plans/require-seller.ts's `SellerSession.email`), passed down from
   * the server component so this client component never re-derives auth
   * itself. Null on the rare account with no email on the Supabase Auth
   * user — the "use my email" affordance below simply doesn't render then,
   * rather than offering a button that can't do anything.
   */
  sellerEmail: string | null;
  /**
   * T60 CRITICAL fix. Whether the post-send "Open buyer view" flip button
   * may carry this page's one Signal — resolved once by
   * workspace-signal-budget.ts's resolveWorkspaceSignalOwners and threaded
   * down from page.tsx, exactly like ActivationChecklist's and
   * DealLimitNotice's own `canUseSignal` props. Defaults to false (plain):
   * a caller that hasn't computed this must never risk a second Signal
   * alongside the deal-limit wall or the stall alert. The "Send invite"
   * button itself never carries Signal at all, in any state — see this
   * file's own header comment.
   */
  canFlipUseSignal?: boolean;
}

type StatusTone = "done" | "wait" | "risk";

function statusTone(status: SendInviteState["status"]): StatusTone | null {
  switch (status) {
    case "sent":
      return "done";
    case "cooldown":
      return "wait";
    case "error":
      return "risk";
    case "idle":
      return null;
  }
}

/**
 * "Sent" gets its own concise copy built from `state.email` (so the invited
 * address can render in Geist Mono, matching this page's other raw-value
 * treatment — workspace-links.css's resource-type headings,
 * crm-forecast-strip.css's numeric/date fields). "Cooldown" and "error"
 * render the server's own `message` verbatim instead: those carry real,
 * dynamic copy (a computed retry-after wait, a specific failure reason) that
 * would be brittle to reconstruct or string-parse on the client — trusting
 * the returned message is the simpler, more correct option (KISS).
 */
function renderStatusMessage(state: SendInviteState): ReactNode {
  if (state.status === "sent" && state.email) {
    return (
      <>
        Invite sent to <span className="ip-status-email">{state.email}</span>.
      </>
    );
  }
  return state.message;
}

interface InviteSubmitButtonProps {
  label: string;
  pendingLabel: string;
  isPending: boolean;
  isPrimary: boolean;
}

/**
 * Shared submit-button presentation for both forms this panel renders (send
 * + flip). While pending, the label is made transparent (not removed) and a
 * spinner is absolutely centred over the same box, so the button never
 * changes width — no dependency, plain CSS, matching this repo's
 * zero-new-dependency convention.
 *
 * The spinner itself is `aria-hidden` (purely decorative): `aria-busy`
 * already tells assistive tech the button is mid-action, and swapping the
 * button's own accessible name to `pendingLabel` while pending says what
 * it's doing — a second `role="status"` region on the spinner would be a
 * redundant, ambiguous live-region announcement on top of that.
 */
function InviteSubmitButton({ label, pendingLabel, isPending, isPrimary }: InviteSubmitButtonProps) {
  return (
    <button
      type="submit"
      className={`ip-btn ${isPrimary ? "ip-btn-primary" : "ip-btn-secondary"}`}
      disabled={isPending}
      aria-busy={isPending}
      aria-label={isPending ? pendingLabel : undefined}
      data-signal={isPrimary ? "true" : undefined}
    >
      <span className="ip-btn-label" data-pending={isPending}>
        {label}
      </span>
      {isPending ? (
        <span className="ip-spinner" aria-hidden="true">
          <span className="ip-spinner-ring" />
        </span>
      ) : null}
    </button>
  );
}

/**
 * `useFormStatus` must be called from a component nested INSIDE the `<form>`
 * whose pending state it reads, never from the form's own component — this
 * exists purely so the flip form (below) can share InviteSubmitButton's
 * spinner treatment without a second `useActionState`, since
 * `flipToBuyerView` has nothing to return: it always redirects.
 */
function FlipSubmitButton({ isPrimary }: { isPrimary: boolean }) {
  const { pending } = useFormStatus();
  return (
    <InviteSubmitButton
      label="Open buyer view"
      pendingLabel="Opening buyer view"
      isPending={pending}
      isPrimary={isPrimary}
    />
  );
}

/**
 * T43 (Sprint 8, Ticket 43 — "Own-inbox buyer invite & instant flip"). The
 * seller-facing counterpart to invite-actions.ts: send a real portal invite
 * to any inbox (including the seller's own, via the "Use my email"
 * affordance) and then flip in one click into the actual buyer portal.
 *
 * One Signal per decision scope (design system MUST). T60 CRITICAL fix: this
 * page can also show the deal-limit wall's upgrade CTA and/or the stall
 * alert's "Review plan" (workspace-signal-budget.ts), both of which render
 * independently of anything in THIS card — so "Send invite" being Signal
 * "before an invite is sent" (the old rule) could put a second Signal on
 * screen from first paint. "Send invite" is therefore ALWAYS plain/secondary
 * now, in every state. Only "Open buyer view" (the post-send flip, own-inbox
 * only) can ever be Signal, and only when `canFlipUseSignal` says the page
 * has handed it over — the resolver's lowest-priority claimant, since it can
 * coexist with either of the other two.
 *
 * T58 addition: the section carries `id="invite-panel"` so
 * activation-checklist.tsx's "Invite your buyer" row can link straight to
 * this card with a plain same-page anchor (`#invite-panel`) rather than a
 * prop-drilled scroll callback.
 */
export function InvitePanel({ workspaceId, sellerEmail, canFlipUseSignal = false }: InvitePanelProps) {
  const [state, formAction, isSending] = useActionState(
    sendBuyerInvite.bind(null, workspaceId),
    INITIAL_SEND_INVITE_STATE,
  );
  const [emailValue, setEmailValue] = useState("");

  const tone = statusTone(state.status);
  // Own-inbox only (T43 follow-up, A3 ownership audit): the flip renders
  // solely when the invite went to the seller's OWN address — mirroring the
  // server-side rule in flipToBuyerView, which refuses any other email. A
  // buyer-bound invite still confirms as sent; it just never offers a button
  // that would let the seller enter the portal as the buyer (or, client-side,
  // a button the server would silently refuse). state.email arrives
  // normalized (lowercased) from the action; sellerEmail comes raw from auth.
  const hasFlip =
    state.status === "sent" &&
    state.email !== null &&
    sellerEmail !== null &&
    state.email === sellerEmail.trim().toLowerCase();

  function useMyEmail() {
    if (sellerEmail) setEmailValue(sellerEmail);
  }

  return (
    <section id="invite-panel" className="ip-card" data-surface="invite-panel" data-testid="invite-panel">
      <h2 className="ip-title">Invite your buyer</h2>
      <p className="ip-intro">
        Invite your buyer to the deal room — send a portal link to any inbox, including your own.
      </p>

      <form action={formAction} className="ip-form">
        <label className="ip-field">
          Email
          <input
            className="ip-input"
            type="email"
            name="email"
            required
            placeholder="name@company.com"
            value={emailValue}
            onChange={(event) => setEmailValue(event.target.value)}
            disabled={isSending}
            aria-invalid={state.status === "error"}
            aria-describedby={state.status === "error" ? "ip-status-message" : undefined}
          />
        </label>

        <div className="ip-actions">
          {sellerEmail ? (
            <button type="button" className="ip-btn ip-btn-tertiary" onClick={useMyEmail} disabled={isSending}>
              Use my email
            </button>
          ) : null}
          {/* T60 CRITICAL fix: never Signal. See this file's header comment. */}
          <InviteSubmitButton
            label="Send invite"
            pendingLabel="Sending invite"
            isPending={isSending}
            isPrimary={false}
          />
        </div>

        {tone ? (
          <p
            className="ip-status"
            data-tone={tone}
            role={state.status === "error" ? "alert" : "status"}
            id="ip-status-message"
          >
            <span className="ip-status-dot" data-status-dot="" aria-hidden="true" />
            <span>{renderStatusMessage(state)}</span>
          </p>
        ) : null}
      </form>

      {hasFlip ? (
        <form action={flipToBuyerView.bind(null, workspaceId)} className="ip-flip-form">
          <input type="hidden" name="email" value={state.email ?? ""} />
          <FlipSubmitButton isPrimary={canFlipUseSignal} />
        </form>
      ) : null}
    </section>
  );
}
