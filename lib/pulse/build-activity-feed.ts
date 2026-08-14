// T36-2/T36-3 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Pure
// assembly of /api/demo/pulse's activity feed — split out of the route so
// the mapping (mask every email, resolve every label) is unit-testable
// without a live server or a seeded demo-tenant workspace, mirroring how
// lib/plans/complete-step.ts was split out of its route for the same reason.
// No Supabase import: the two label maps are resolved by the route (via
// narrow selects) and handed in already built.

import { maskBuyerEmail } from "./mask-buyer-email";

const FEED_LIMIT = 30;

export interface PulseAnalyticsEvent {
  readonly action_type: string;
  readonly buyer_email: string;
  readonly link_id: string | null;
  readonly step_id: string | null;
  readonly created_at: string;
}

export interface PulseFeedItem {
  readonly action_type: string;
  /** T36-2: always masked — never the raw address from workspace_analytics. */
  readonly buyer_email: string;
  readonly metadata: {
    readonly link_label: string | null;
    readonly step_label: string | null;
  };
  readonly timestamp: string;
}

/**
 * Assumes `events` is already ordered newest-first (the route's query does
 * this) and takes only the most recent FEED_LIMIT — the same slice the route
 * applied inline before this was extracted.
 */
export function buildActivityFeed(
  events: readonly PulseAnalyticsEvent[],
  linkLabelById: ReadonlyMap<string, string>,
  stepLabelById: ReadonlyMap<string, string>,
): PulseFeedItem[] {
  return events.slice(0, FEED_LIMIT).map((event) => ({
    action_type: event.action_type,
    buyer_email: maskBuyerEmail(event.buyer_email),
    metadata: {
      link_label: event.link_id ? (linkLabelById.get(event.link_id) ?? null) : null,
      step_label: event.step_id ? (stepLabelById.get(event.step_id) ?? null) : null,
    },
    timestamp: event.created_at,
  }));
}
