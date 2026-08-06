import type { SVGProps } from "react";
import { LockIcon } from "./private-badge";
import "./chat-presence.css";

export type ChatAudience = "seller" | "buyer";

export interface ChatPresenceProps {
  /** workspaces.chat_url — the shared channel; buyer-visible (PRD §2.4). Null/empty hides the shared button (T32-4). */
  chatUrl: string | null;
  /**
   * workspaces.internal_chat_url — seller-only war room (T31-6). Only ever
   * rendered when `audience === "seller"`; ignored for "buyer" even if a
   * caller passes a value, so the buyer boundary doesn't depend on every
   * future caller remembering to omit it (same defensive shape as
   * toBuyerPayload / T30-6's single-boundary rule — belt AND suspenders,
   * this component is the suspenders).
   */
  internalChatUrl?: string | null;
  /**
   * Drives which button(s) render. Mounted with "seller" on this page
   * (Ticket 32); "buyer" is unused until the buyer workspace renderer
   * exists (Tickets 33/34) but the prop is here now so this component
   * doesn't need reshaping later.
   */
  audience: ChatAudience;
}

/**
 * Team-chat presence control (Sprint 6, Ticket 32; T32-3/T32-4). Neutral
 * Slate throughout — chat is not the decision Signal, and the forecast
 * nudge (forecast-nudge.tsx) already owns the one Signal in this page's
 * scope. No fabricated "online" indicator: there is no real presence feed
 * behind this control, only a stored URL, so it renders as a plain link
 * button rather than inventing a status dot with nothing backing it.
 *
 * Both `chatUrl` and `internalChatUrl` independently hide their own button
 * when null/empty rather than rendering a dead link (T32-4). Rendered
 * buttons open in a new tab with rel="noopener noreferrer" (T32-4).
 */
export function ChatPresence({ chatUrl, internalChatUrl = null, audience }: ChatPresenceProps) {
  const showShared = chatUrl !== null && chatUrl !== "";
  const showInternal = audience === "seller" && internalChatUrl !== null && internalChatUrl !== "";

  if (!showShared && !showInternal) return null;

  return (
    <div className="cp-presence" data-surface="chat-presence">
      {showShared ? (
        <a href={chatUrl} target="_blank" rel="noopener noreferrer" className="cp-btn" data-tone="shared">
          <ChatIcon aria-hidden="true" className="cp-icon" />
          Team chat
        </a>
      ) : null}
      {/* Visually distinguished from the shared button (T32-3): dashed
          border + lock icon, the same fenced idiom PrivateBadge and the
          CRM strip's internal-chat reveal already use for "this is
          seller-only, not buyer-visible". */}
      {showInternal ? (
        <a
          href={internalChatUrl as string}
          target="_blank"
          rel="noopener noreferrer"
          className="cp-btn"
          data-tone="internal"
        >
          <LockIcon aria-hidden="true" className="cp-icon" />
          War room
        </a>
      ) : null}
    </div>
  );
}

function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M2 3.5h12v7H6.5L3.5 13v-2.5H2v-7Z" />
    </svg>
  );
}
