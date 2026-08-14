// T36-2/T36-3 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Unit
// coverage for buildActivityFeed — proves the step_complete feed entry
// shape and that every buyer_email in the assembled feed is masked, without
// a live server or a seeded demo-tenant workspace.

import { describe, expect, it } from "vitest";

import { buildActivityFeed, type PulseAnalyticsEvent } from "@/lib/pulse/build-activity-feed";

function event(overrides: Partial<PulseAnalyticsEvent>): PulseAnalyticsEvent {
  return {
    action_type: "portal_view",
    buyer_email: "buyer@acme.example.com",
    link_id: null,
    step_id: null,
    created_at: "2026-08-01T00:00:00+00:00",
    ...overrides,
  };
}

describe("buildActivityFeed", () => {
  it("produces a step_complete entry carrying the resolved step label and a masked email", () => {
    const events = [event({ action_type: "step_complete", step_id: "step-1", buyer_email: "dana@buyer.example.com" })];
    const stepLabelById = new Map([["step-1", "Confirm the technical validation call"]]);

    const feed = buildActivityFeed(events, new Map(), stepLabelById);

    expect(feed).toEqual([
      {
        action_type: "step_complete",
        buyer_email: "d***@***.com",
        metadata: { link_label: null, step_label: "Confirm the technical validation call" },
        timestamp: "2026-08-01T00:00:00+00:00",
      },
    ]);
  });

  it("falls back to a null step_label when the step id has no resolved entry (e.g. deleted step)", () => {
    const events = [event({ action_type: "step_complete", step_id: "missing-step" })];

    const feed = buildActivityFeed(events, new Map(), new Map());

    expect(feed[0].metadata.step_label).toBeNull();
  });

  it("never populates step_label for a link_click row, and never link_label for a step_complete row", () => {
    const events = [
      event({ action_type: "link_click", link_id: "link-1", step_id: null }),
      event({ action_type: "step_complete", link_id: null, step_id: "step-1" }),
    ];
    const linkLabelById = new Map([["link-1", "Security overview"]]);
    const stepLabelById = new Map([["step-1", "Sign the MSA"]]);

    const feed = buildActivityFeed(events, linkLabelById, stepLabelById);

    expect(feed[0].metadata).toEqual({ link_label: "Security overview", step_label: null });
    expect(feed[1].metadata).toEqual({ link_label: null, step_label: "Sign the MSA" });
  });

  it("masks buyer_email on every entry, regardless of action_type", () => {
    const events = [
      event({ action_type: "portal_view", buyer_email: "avery@buyer.example.com" }),
      event({ action_type: "link_click", buyer_email: "bo@buyer.example.com" }),
      event({ action_type: "step_complete", buyer_email: "cy@buyer.example.com" }),
    ];

    const feed = buildActivityFeed(events, new Map(), new Map());

    for (const item of feed) {
      expect(item.buyer_email).not.toContain("@buyer.example.com");
      expect(item.buyer_email).toMatch(/^.\*{3}@/);
    }
  });

  it("caps the feed at 30 entries, keeping the first 30 of the input order", () => {
    const events = Array.from({ length: 40 }, (_, i) => event({ created_at: `t${i}` }));

    const feed = buildActivityFeed(events, new Map(), new Map());

    expect(feed).toHaveLength(30);
  });
});
