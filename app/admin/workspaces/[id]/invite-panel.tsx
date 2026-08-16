"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  INITIAL_SEND_INVITE_STATE,
  flipToBuyerView,
  sendBuyerInvite,
  type SendInviteState,
} from "./invite-actions";
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
function FlipSubmitButton() {
  const { pending } = useFormStatus();
  return <InviteSubmitButton label="Open buyer view" pendingLabel="Opening buyer view" isPending={pending} isPrimary />;
}

/**
 * T43 (Sprint 8, Ticket 43 — "Own-inbox buyer invite & instant flip"). The
 * seller-facing counterpart to invite-actions.ts: send a real portal invite
 * to any inbox (including the seller's own, via the "Use my email"
 * affordance) and then flip in one click into the actual buyer portal.
 *
 * One Signal per decision scope (design system MUST): before an invite is
 * sent, "Send invite" is this card's sole primary/Signal element
 * (`data-signal="true"`). The instant it succeeds, "Send invite" drops to
 * secondary and "Open buyer view" becomes the card's one Signal instead —
 * never both at once, in either the "sent" state or the recoverable
 * "cooldown"/"error" states (where no flip renders at all, so the send
 * button stays the only primary throughout).
 */
export function InvitePanel({ workspaceId, sellerEmail }: InvitePanelProps) {
  const [state, formAction, isSending] = useActionState(
    sendBuyerInvite.bind(null, workspaceId),
    INITIAL_SEND_INVITE_STATE,
  );
  const [emailValue, setEmailValue] = useState("");

  const tone = statusTone(state.status);
  const hasFlip = state.status === "sent" && state.email !== null;

  function useMyEmail() {
    if (sellerEmail) setEmailValue(sellerEmail);
  }

  return (
    <section className="ip-card" data-surface="invite-panel" data-testid="invite-panel">
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
          />
        </label>

        <div className="ip-actions">
          {sellerEmail ? (
            <button type="button" className="ip-btn ip-btn-tertiary" onClick={useMyEmail} disabled={isSending}>
              Use my email
            </button>
          ) : null}
          <InviteSubmitButton
            label="Send invite"
            pendingLabel="Sending invite"
            isPending={isSending}
            isPrimary={state.status !== "sent"}
          />
        </div>

        {tone ? (
          <p className="ip-status" data-tone={tone} role={state.status === "error" ? "alert" : "status"}>
            <span className="ip-status-dot" data-status-dot="" aria-hidden="true" />
            <span>{renderStatusMessage(state)}</span>
          </p>
        ) : null}
      </form>

      {hasFlip ? (
        <form action={flipToBuyerView.bind(null, workspaceId)} className="ip-flip-form">
          <input type="hidden" name="email" value={state.email ?? ""} />
          <FlipSubmitButton />
        </form>
      ) : null}
    </section>
  );
}
