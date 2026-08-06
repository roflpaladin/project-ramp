// T31-8 (Sprint 6, Ticket 31; plans/sprint-6-7-replan.md §6). Component-level
// DOM assertions for the crm_source IS NULL hide path
// (app/admin/workspaces/[id]/crm-forecast-strip.tsx). Runs under the
// "components" Vitest project (happy-dom) — see vitest.config.ts.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CrmForecastView } from "@/lib/crm/forecast";
import type { EngagementSignal } from "@/lib/plans/engagement";
import { CrmForecastStrip } from "@/app/admin/workspaces/[id]/crm-forecast-strip";

afterEach(() => {
  cleanup();
});

const WAITING_SIGNAL: EngagementSignal = {
  state: "waiting",
  lastActivityAt: null,
  daysSinceLastActivity: null,
  openBuyerStepCount: 0,
};

const NEVER_SYNCED_FORECAST: CrmForecastView = {
  source: null,
  stage: null,
  amount: null,
  closeDate: null,
  forecastCategory: null,
  syncedAt: null,
};

const SYNCED_FORECAST: CrmForecastView = {
  source: "hubspot",
  stage: "Negotiation",
  amount: 48000,
  closeDate: "2026-09-30",
  forecastCategory: "Commit",
  syncedAt: "2026-08-01T09:30:00.000Z",
};

describe("CrmForecastStrip — crm_source IS NULL hide path", () => {
  it("renders nothing when forecast.source is null (workspace has never synced)", () => {
    // Arrange / Act
    const { container } = render(
      <CrmForecastStrip
        targetCompanyName="Acme"
        forecast={NEVER_SYNCED_FORECAST}
        engagementSignal={WAITING_SIGNAL}
        internalChatUrl={null}
      />,
    );
    // Assert — hides cleanly, no empty fields rendered.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByLabelText("Private CRM forecast")).not.toBeInTheDocument();
  });

  it("does not render any of the field labels when source is null, even though other data is present", () => {
    // A workspace could theoretically carry stale non-null field values from
    // a prior sync alongside a null source (e.g. a disconnected CRM) — the
    // hide check must key off source alone, not "every field is empty".
    const partiallyPopulated: CrmForecastView = { ...SYNCED_FORECAST, source: null };
    render(
      <CrmForecastStrip
        targetCompanyName="Acme"
        forecast={partiallyPopulated}
        engagementSignal={WAITING_SIGNAL}
        internalChatUrl={null}
      />,
    );
    expect(screen.queryByText("Negotiation")).not.toBeInTheDocument();
  });
});

describe("CrmForecastStrip — renders when crm_source is present", () => {
  it("renders the fenced strip with its private-to label naming the target company", () => {
    render(
      <CrmForecastStrip
        targetCompanyName="Acme"
        forecast={SYNCED_FORECAST}
        engagementSignal={WAITING_SIGNAL}
        internalChatUrl={null}
      />,
    );
    expect(screen.getByLabelText("Private CRM forecast")).toBeInTheDocument();
    expect(screen.getByText(/Private to you/)).toHaveTextContent("Private to you · never shown to Acme");
  });

  it("renders the synced-at line visibly rather than omitting it", () => {
    render(
      <CrmForecastStrip
        targetCompanyName="Acme"
        forecast={SYNCED_FORECAST}
        engagementSignal={WAITING_SIGNAL}
        internalChatUrl={null}
      />,
    );
    expect(screen.getByText(/^As of /)).toBeInTheDocument();
  });

  it("masks internal_chat_url behind a collapsed reveal rather than a plain link", () => {
    render(
      <CrmForecastStrip
        targetCompanyName="Acme"
        forecast={SYNCED_FORECAST}
        engagementSignal={WAITING_SIGNAL}
        internalChatUrl="https://chat.internal.example.com/war-room"
      />,
    );
    const link = screen.getByRole("link", { name: "https://chat.internal.example.com/war-room" });
    // <details> is collapsed by default in happy-dom/jsdom semantics — the
    // link exists in the DOM (T31-6 says "masked behind a reveal", not
    // absent) but its containing <details> is not open on first paint.
    const details = link.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });

  it("does not render the internal chat reveal at all when internalChatUrl is null", () => {
    render(
      <CrmForecastStrip
        targetCompanyName="Acme"
        forecast={SYNCED_FORECAST}
        engagementSignal={WAITING_SIGNAL}
        internalChatUrl={null}
      />,
    );
    expect(screen.queryByText(/do not screen-share/)).not.toBeInTheDocument();
  });
});
