// Sprint 10, Ticket 54, Phase 1. Component-level DOM assertions for
// components/crm/import-result-summary.tsx and the three pieces it composes
// (crm-failure-detail-list.tsx, crm-unmapped-fields-notice.tsx,
// crm-retry-reconnect-row.tsx). Runs under the "components" Vitest project
// (happy-dom) — see vitest.config.ts.
//
// PROVISIONAL — built entirely against mocks of lib/crm/import-ui-types.ts's
// CrmImportResult (T53's backend pipeline is a different session's lane).
// No API call is exercised anywhere in this file; onRetry is a plain vi.fn().
//
// Coverage per the ticket brief: complete status renders no failure UI;
// partial success shows all three counts (imported/failed/total) and a
// retry action; failed + reconnectRequired shows the reconnect link (with
// the correct oauth-start href) as the row's single Signal, with retry
// demoted to a secondary button; failed + retryable-only shows retry as the
// Signal instead; unmapped fields are listed by name, never dropped
// invisibly; rate_limited failures get their own human-readable group
// message, distinct from the other (risk-toned) reasons; every status
// renders both a dot AND a text label (assert text, not just class) — status
// is never colour-only.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CrmImportResult } from "@/lib/crm-import/types";
import { ImportResultSummary } from "@/components/crm/import-result-summary";
import { HUBSPOT_OAUTH_START_HREF } from "@/components/crm/crm-retry-reconnect-row";

afterEach(() => {
  cleanup();
});

function baseResult(overrides: Partial<CrmImportResult>): CrmImportResult {
  return {
    status: "complete",
    importedCount: 0,
    failedCount: 0,
    totalCount: 0,
    failures: [],
    unmappedFields: [],
    retryable: false,
    reconnectRequired: false,
    ...overrides,
  };
}

describe("ImportResultSummary — complete status", () => {
  it("shows a done-toned dot + text status, and renders no failure/retry/unmapped UI", () => {
    const onRetry = vi.fn();
    const result = baseResult({ status: "complete", importedCount: 12, failedCount: 0, totalCount: 12 });
    render(<ImportResultSummary result={result} onRetry={onRetry} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("12 of 12 deals imported.");
    expect(status.querySelector('[data-tone="done"]')).not.toBeNull();
    expect(status.querySelector(".cir-status-dot")).not.toBeNull();

    expect(screen.queryByTestId("crm-failure-detail-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("crm-unmapped-fields-notice")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reconnect HubSpot" })).not.toBeInTheDocument();
  });
});

describe("ImportResultSummary — partial success", () => {
  it("shows all three explicit counts and a retry action, never silent", () => {
    const onRetry = vi.fn();
    const result = baseResult({
      status: "partial",
      importedCount: 7,
      failedCount: 3,
      totalCount: 10,
      failures: [
        { externalId: "d1", reason: "invalid_data", message: "Missing a required amount field." },
        { externalId: "d2", reason: "invalid_data", message: "Stage did not match any known pipeline stage." },
        { externalId: "d3", reason: "unknown", message: "The import worker could not process this deal." },
      ],
      retryable: true,
      reconnectRequired: false,
    });
    render(<ImportResultSummary result={result} onRetry={onRetry} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("7 of 10 deals imported.");
    expect(status).toHaveTextContent("3 failed.");
    expect(status.querySelector('[data-tone="risk"]')).not.toBeNull();
    expect(status.querySelector(".cir-status-dot")).not.toBeNull();

    const retryButton = screen.getByRole("button", { name: "Retry import" });
    expect(retryButton).toHaveAttribute("data-signal", "true");
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole("link", { name: "Reconnect HubSpot" })).not.toBeInTheDocument();
  });
});

describe("ImportResultSummary — failed with reconnectRequired", () => {
  it("renders the reconnect link (correct href) as the single Signal, retry as a secondary button", () => {
    const onRetry = vi.fn();
    const result = baseResult({
      status: "failed",
      importedCount: 0,
      failedCount: 4,
      totalCount: 4,
      failures: [
        { externalId: "d1", reason: "token_expired", message: "The HubSpot connection token has expired." },
      ],
      retryable: true,
      reconnectRequired: true,
    });
    const { container } = render(<ImportResultSummary result={result} onRetry={onRetry} />);

    const reconnectLink = screen.getByRole("link", { name: "Reconnect HubSpot" });
    expect(reconnectLink).toHaveAttribute("href", HUBSPOT_OAUTH_START_HREF);
    expect(reconnectLink).toHaveAttribute("data-signal", "true");

    const retryButton = screen.getByRole("button", { name: "Retry import" });
    expect(retryButton).not.toHaveAttribute("data-signal", "true");

    // Never two Signals in one decision scope.
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders retry as the Signal when reconnect is NOT required, even on a full failure", () => {
    const onRetry = vi.fn();
    const result = baseResult({
      status: "failed",
      importedCount: 0,
      failedCount: 2,
      totalCount: 2,
      failures: [{ externalId: "d1", reason: "unknown", message: "The import worker crashed." }],
      retryable: true,
      reconnectRequired: false,
    });
    const { container } = render(<ImportResultSummary result={result} onRetry={onRetry} />);

    const retryButton = screen.getByRole("button", { name: "Retry import" });
    expect(retryButton).toHaveAttribute("data-signal", "true");
    expect(screen.queryByRole("link", { name: "Reconnect HubSpot" })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });

  it("renders no retry/reconnect action at all when neither retryable nor reconnectRequired", () => {
    const onRetry = vi.fn();
    const result = baseResult({
      status: "failed",
      importedCount: 0,
      failedCount: 1,
      totalCount: 1,
      failures: [{ externalId: "d1", reason: "invalid_data", message: "Missing a required amount field." }],
      retryable: false,
      reconnectRequired: false,
    });
    render(<ImportResultSummary result={result} onRetry={onRetry} />);

    expect(screen.queryByRole("button", { name: "Retry import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reconnect HubSpot" })).not.toBeInTheDocument();
  });
});

describe("ImportResultSummary — unmapped fields", () => {
  it("lists every unmapped field by its human label, raw key in the tooltip, never dropped invisibly", () => {
    const onRetry = vi.fn();
    // Contract amendment 2026-08-24: unmappedFields carries sourceField +
    // sourceLabel; sellers see the label, the raw key survives as a tooltip.
    const result = baseResult({
      status: "complete",
      importedCount: 5,
      failedCount: 0,
      totalCount: 5,
      unmappedFields: [
        { sourceField: "hs_lead_status", sourceLabel: "Lead status" },
        { sourceField: "custom_field_42", sourceLabel: "Renewal quarter" },
      ],
    });
    render(<ImportResultSummary result={result} onRetry={onRetry} />);

    const notice = screen.getByTestId("crm-unmapped-fields-notice");
    expect(notice).toHaveTextContent("Lead status");
    expect(notice).toHaveTextContent("Renewal quarter");
    expect(screen.getByText("Lead status")).toHaveAttribute("title", "hs_lead_status");
    expect(screen.getByText("Renewal quarter")).toHaveAttribute("title", "custom_field_42");
    expect(notice).not.toHaveTextContent("hs_lead_status");
  });

  it("renders no unmapped-fields notice when there are none", () => {
    const onRetry = vi.fn();
    const result = baseResult({ status: "complete", importedCount: 5, failedCount: 0, totalCount: 5 });
    render(<ImportResultSummary result={result} onRetry={onRetry} />);

    expect(screen.queryByTestId("crm-unmapped-fields-notice")).not.toBeInTheDocument();
  });
});

describe("ImportResultSummary — rate limiting (HubSpot)", () => {
  it("gives rate_limited failures their own human-readable, Slate-toned group, distinct from risk-toned reasons", () => {
    const onRetry = vi.fn();
    const result = baseResult({
      status: "partial",
      importedCount: 8,
      failedCount: 2,
      totalCount: 10,
      failures: [
        { externalId: "d1", reason: "rate_limited", message: "HubSpot returned a 429; retry after a short wait." },
        { externalId: "d2", reason: "invalid_data", message: "Missing a required amount field." },
      ],
      retryable: true,
      reconnectRequired: false,
    });
    render(<ImportResultSummary result={result} onRetry={onRetry} />);

    const failureList = screen.getByTestId("crm-failure-detail-list");
    expect(failureList).toHaveTextContent("Rate limited by HubSpot");
    expect(failureList).toHaveTextContent("HubSpot returned a 429; retry after a short wait.");

    const rateLimitedGroup = screen.getByText(/Rate limited by HubSpot/).closest(".cir-status");
    expect(rateLimitedGroup).not.toBeNull();
    expect(rateLimitedGroup).toHaveAttribute("data-tone", "wait");
    expect(rateLimitedGroup?.querySelector(".cir-status-dot")).not.toBeNull();

    const invalidDataGroup = screen.getByText(/Invalid data/).closest(".cir-status");
    expect(invalidDataGroup).toHaveAttribute("data-tone", "risk");

    expect(failureList).toHaveTextContent("Missing a required amount field.");
  });
});

describe("ImportResultSummary — status is never colour-only", () => {
  it.each<[CrmImportResult["status"], string]>([
    ["complete", "3 of 3 deals imported."],
    ["partial", "1 failed."],
    ["failed", "Import failed."],
  ])("status %s renders a dot AND a readable text label, not colour alone", (status, expectedText) => {
    const onRetry = vi.fn();
    const result = baseResult({
      status,
      importedCount: status === "failed" ? 0 : status === "partial" ? 2 : 3,
      failedCount: status === "complete" ? 0 : status === "partial" ? 1 : 2,
      totalCount: status === "failed" ? 2 : 3,
    });
    render(<ImportResultSummary result={result} onRetry={onRetry} />);

    const status_ = screen.getByRole("status");
    expect(status_.querySelector(".cir-status-dot")).not.toBeNull();
    expect(status_).toHaveTextContent(expectedText);
  });
});

describe("ImportResultSummary — provider awareness (Sprint 11, Ticket 56)", () => {
  const SALESFORCE_OAUTH_START_HREF = "/api/integrations/salesforce/oauth/start";

  it("defaults to HubSpot wording and href when no provider props are given (backward-safe default)", () => {
    const onRetry = vi.fn();
    const result = baseResult({
      status: "failed",
      importedCount: 0,
      failedCount: 1,
      totalCount: 1,
      failures: [{ externalId: "d1", reason: "token_expired", message: "The connection token has expired." }],
      retryable: true,
      reconnectRequired: true,
    });
    render(<ImportResultSummary result={result} onRetry={onRetry} />);

    expect(screen.getByText(/HubSpot connection expired/)).toBeInTheDocument();
    const reconnectLink = screen.getByRole("link", { name: "Reconnect HubSpot" });
    expect(reconnectLink).toHaveAttribute("href", HUBSPOT_OAUTH_START_HREF);
  });

  it("renders Salesforce failure-reason wording and the Salesforce reconnect link when providerLabel/reconnectHref are Salesforce", () => {
    const onRetry = vi.fn();
    const result = baseResult({
      status: "partial",
      importedCount: 8,
      failedCount: 2,
      totalCount: 10,
      failures: [
        { externalId: "d1", reason: "rate_limited", message: "Salesforce returned a 403; retry after a short wait." },
        { externalId: "d2", reason: "token_expired", message: "The Salesforce connection token has expired." },
      ],
      retryable: true,
      reconnectRequired: true,
    });
    render(
      <ImportResultSummary
        result={result}
        onRetry={onRetry}
        providerLabel="Salesforce"
        reconnectHref={SALESFORCE_OAUTH_START_HREF}
      />,
    );

    expect(screen.getByText(/Rate limited by Salesforce/)).toBeInTheDocument();
    expect(screen.getByText(/Salesforce connection expired/)).toBeInTheDocument();

    const reconnectLink = screen.getByRole("link", { name: "Reconnect Salesforce" });
    expect(reconnectLink).toHaveAttribute("href", SALESFORCE_OAUTH_START_HREF);
    expect(reconnectLink).toHaveAttribute("data-signal", "true");
  });
});

describe("ImportResultSummary — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath, URL: NodeURL } = await import("node:url");
    const cssPath = fileURLToPath(new NodeURL("../../components/crm/import-result-summary.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
