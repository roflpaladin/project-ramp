// Sprint 10, Ticket 54, Phase 2. Component-level DOM assertions for
// components/crm/crm-deal-picker.tsx. Runs under the "components" Vitest
// project (happy-dom) — see vitest.config.ts.
//
// PROVISIONAL / mock-seamed — built entirely against mocks of
// lib/crm/import-ui-types.ts's CrmDealListResult (T53's backend server
// actions do not exist yet). No API call is exercised anywhere in this
// file; onImport/onRetry are plain vi.fn().
//
// Coverage per the ticket brief: deals render with formatted amount + plain
// stage text; null companyName/amount fall back to an em dash; select-all
// and individual selection drive the import button's label and disabled
// state; onImport receives exactly the selected externalIds; the two
// empty-deals copy branches (nothing in HubSpot vs. already imported, keyed
// off alreadyImportedCount per the 2026-08-24 contract amendment) render
// the right copy and never an import button; ok:false with
// reconnectRequired renders the reconnect link as the picker's single
// Signal; ok:false rate_limited renders Slate/wait tone + a retry Signal;
// the loading state exposes role="status".

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CrmDealListResult, CrmDealSummary } from "@/lib/crm/import-ui-types";
import { CrmDealPicker } from "@/components/crm/crm-deal-picker";
import { HUBSPOT_OAUTH_START_HREF } from "@/components/crm/crm-retry-reconnect-row";

afterEach(() => {
  cleanup();
});

function dealFixture(overrides: Partial<CrmDealSummary>): CrmDealSummary {
  return {
    externalId: "d1",
    name: "Acme renewal",
    amount: 12000,
    stage: "Negotiation",
    companyName: "Acme Corp",
    ...overrides,
  };
}

describe("CrmDealPicker — deal list", () => {
  it("renders deals with formatted currency amount and a plain stage label", () => {
    const result: CrmDealListResult = {
      ok: true,
      alreadyImportedCount: 0,
      deals: [dealFixture({ externalId: "d1", name: "Acme renewal", amount: 12000, stage: "Negotiation" })],
    };
    render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={vi.fn()} />);

    expect(screen.getByText("Acme renewal")).toBeInTheDocument();
    expect(screen.getByText("$12,000")).toBeInTheDocument();
    expect(screen.getByText("Negotiation")).toBeInTheDocument();
  });

  it("falls back to an em dash for null companyName and null amount", () => {
    const result: CrmDealListResult = {
      ok: true,
      alreadyImportedCount: 0,
      deals: [dealFixture({ externalId: "d2", companyName: null, amount: null })],
    };
    render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={vi.fn()} />);

    const emDashes = screen.getAllByText("—");
    expect(emDashes.length).toBeGreaterThanOrEqual(2);
  });

  it("labels the import button with the selection count, disabled at zero", () => {
    const result: CrmDealListResult = {
      ok: true,
      alreadyImportedCount: 0,
      deals: [
        dealFixture({ externalId: "d1", name: "Acme renewal" }),
        dealFixture({ externalId: "d2", name: "Globex expansion" }),
      ],
    };
    render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={vi.fn()} />);

    const importButton = screen.getByRole("button", { name: "Import selected" });
    expect(importButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Acme renewal (Acme Corp)" }));
    expect(screen.getByRole("button", { name: "Import 1 deal" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Globex expansion (Acme Corp)" }));
    expect(screen.getByRole("button", { name: "Import 2 deals" })).not.toBeDisabled();
  });

  it("select-all selects every deal, and unselecting one drops it from the count", () => {
    const result: CrmDealListResult = {
      ok: true,
      alreadyImportedCount: 0,
      deals: [
        dealFixture({ externalId: "d1", name: "Acme renewal" }),
        dealFixture({ externalId: "d2", name: "Globex expansion" }),
      ],
    };
    render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all deals" }));
    expect(screen.getByRole("button", { name: "Import 2 deals" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Acme renewal (Acme Corp)" }));
    expect(screen.getByRole("button", { name: "Import 1 deal" })).toBeInTheDocument();
  });

  it("marks select-all indeterminate on partial selection, and never renders a second Signal", () => {
    const result: CrmDealListResult = {
      ok: true,
      alreadyImportedCount: 0,
      deals: [
        dealFixture({ externalId: "d1", name: "Acme renewal" }),
        dealFixture({ externalId: "d2", name: "Globex expansion" }),
      ],
    };
    const { container } = render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={vi.fn()} />);

    // The deals+selection scope carries exactly one Signal (the import
    // button), matching the assertion the ok:false tests already make.
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    const selectAll = screen.getByRole("checkbox", { name: "Select all deals" }) as HTMLInputElement;
    expect(selectAll.indeterminate).toBe(false);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Acme renewal (Acme Corp)" }));
    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll.checked).toBe(false);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Globex expansion (Acme Corp)" }));
    expect(selectAll.indeterminate).toBe(false);
    expect(selectAll.checked).toBe(true);

    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });

  it("omits the company name from the checkbox label when companyName is null", () => {
    const result: CrmDealListResult = {
      ok: true,
      alreadyImportedCount: 0,
      deals: [dealFixture({ externalId: "d1", name: "Acme renewal", companyName: null })],
    };
    render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: "Select Acme renewal" })).toBeInTheDocument();
  });

  it("calls onImport with exactly the selected externalIds", () => {
    const onImport = vi.fn();
    const result: CrmDealListResult = {
      ok: true,
      alreadyImportedCount: 0,
      deals: [
        dealFixture({ externalId: "d1", name: "Acme renewal" }),
        dealFixture({ externalId: "d2", name: "Globex expansion" }),
        dealFixture({ externalId: "d3", name: "Initech upgrade" }),
      ],
    };
    render(<CrmDealPicker result={result} onImport={onImport} onRetry={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Acme renewal (Acme Corp)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Initech upgrade (Acme Corp)" }));
    fireEvent.click(screen.getByRole("button", { name: "Import 2 deals" }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith(["d1", "d3"]);
  });
});

describe("CrmDealPicker — empty deals list", () => {
  it("renders the 'nothing to import yet' copy when nothing exists in HubSpot, no import button", () => {
    const result: CrmDealListResult = { ok: true, deals: [], alreadyImportedCount: 0 };
    render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={vi.fn()} />);

    const empty = screen.getByTestId("crm-deal-picker-empty");
    expect(empty).toHaveTextContent("Nothing to import yet");
    expect(empty).not.toHaveTextContent("already imported");
    expect(screen.queryByRole("button", { name: /Import/ })).not.toBeInTheDocument();
  });

  it("renders the 'all caught up' copy with the count when deals were already imported, no import button", () => {
    const result: CrmDealListResult = { ok: true, deals: [], alreadyImportedCount: 12 };
    render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={vi.fn()} />);

    const empty = screen.getByTestId("crm-deal-picker-empty");
    expect(empty).toHaveTextContent("All caught up");
    expect(empty).toHaveTextContent("12");
    expect(empty).toHaveTextContent("deals already imported");
    expect(empty.querySelector(".cdp-mono")).toHaveTextContent("12");
    expect(screen.queryByRole("button", { name: /Import/ })).not.toBeInTheDocument();
  });
});

describe("CrmDealPicker — ok:false (list call failed)", () => {
  it("renders the reconnect link as the picker's single Signal when reconnectRequired", () => {
    const result: CrmDealListResult = {
      ok: false,
      reason: "token_expired",
      message: "The HubSpot connection has expired.",
      reconnectRequired: true,
    };
    const { container } = render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={vi.fn()} />);

    const reconnectLink = screen.getByRole("link", { name: "Reconnect HubSpot" });
    expect(reconnectLink).toHaveAttribute("href", HUBSPOT_OAUTH_START_HREF);
    expect(reconnectLink).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders Slate/wait-toned message + a retry Signal for rate_limited failures", () => {
    const onRetry = vi.fn();
    const result: CrmDealListResult = {
      ok: false,
      reason: "rate_limited",
      message: "HubSpot returned a 429; retry after a short wait.",
      reconnectRequired: false,
    };
    const { container } = render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={onRetry} />);

    const status = screen.getByText("HubSpot returned a 429; retry after a short wait.").closest(".cdp-status");
    expect(status).toHaveAttribute("data-tone", "wait");
    expect(status?.querySelector(".cdp-status-dot")).not.toBeNull();

    const retryButton = screen.getByRole("button", { name: "Retry" });
    expect(retryButton).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders risk tone for unknown failures", () => {
    const result: CrmDealListResult = {
      ok: false,
      reason: "unknown",
      message: "The deal list could not be loaded.",
      reconnectRequired: false,
    };
    render(<CrmDealPicker result={result} onImport={vi.fn()} onRetry={vi.fn()} />);

    const status = screen.getByText("The deal list could not be loaded.").closest(".cdp-status");
    expect(status).toHaveAttribute("data-tone", "risk");
  });
});

describe("CrmDealPicker — loading", () => {
  it("exposes a quiet, Slate-toned role='status' while loading", () => {
    const result: CrmDealListResult = { ok: true, deals: [], alreadyImportedCount: 0 };
    render(<CrmDealPicker result={result} isLoading onImport={vi.fn()} onRetry={vi.fn()} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading deals from HubSpot");
    expect(status).toHaveAttribute("data-tone", "wait");
    expect(screen.queryByTestId("crm-deal-picker-empty")).not.toBeInTheDocument();
  });
});

describe("CrmDealPicker — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath, URL: NodeURL } = await import("node:url");
    const cssPath = fileURLToPath(new NodeURL("../../components/crm/crm-deal-picker.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
