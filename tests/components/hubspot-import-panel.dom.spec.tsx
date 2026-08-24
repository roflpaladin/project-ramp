// Sprint 10, Ticket 54, Phase 3. Component-level DOM assertions for
// app/admin/import/hubspot/hubspot-import-panel.tsx — the real wiring
// between the T54 presentation components (CrmDealPicker, CrmMappingPreview,
// ImportResultSummary) and the real T53 server actions
// (hubspot-import-actions.ts). Runs under the "components" Vitest project
// (happy-dom) — see vitest.config.ts.
//
// hubspot-import-actions.ts is a "use server" module (Server Actions can't
// run inside happy-dom), so it is mocked wholesale, mirroring
// tests/components/csv-import-panel.dom.spec.tsx's house style; this file
// only exercises the panel's own wiring/state-transition logic, never the
// real action bodies (those are covered elsewhere against a real Supabase
// project). hubspot-import-state.ts is NOT mocked — no server-only
// dependency, same reasoning as import-state.ts's own header.
//
// Coverage per the T54 wiring brief: loading renders the picker's own
// loading state, then the deal list once listHubSpotDeals() resolves; a
// list-load failure (ok:false) renders the picker's failure state; a thrown
// list-load promise still renders that same failure state rather than
// stranding the page on "Loading…" forever; the import flow calls
// importHubSpotDeals() with exactly the selected externalIds and renders
// ImportResultSummary from its response; a successful/partial import
// re-fetches the deal list (imported deals are filtered server-side); the
// picker goes busy (no double submits) while an import is in flight; the
// field-mapping preview renders from hubspot-field-map.ts's static table.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CrmDealListResult, CrmDealSummary, CrmImportResult } from "@/lib/crm-import/types";

const { mockListHubSpotDeals, mockImportHubSpotDeals } = vi.hoisted(() => ({
  mockListHubSpotDeals: vi.fn(),
  mockImportHubSpotDeals: vi.fn(),
}));

vi.mock("@/app/admin/import/hubspot/hubspot-import-actions", () => ({
  listHubSpotDeals: mockListHubSpotDeals,
  importHubSpotDeals: mockImportHubSpotDeals,
}));

import { HubSpotImportPanel } from "@/app/admin/import/hubspot/hubspot-import-panel";
import { LOAD_DEALS_FAILED_MESSAGE } from "@/app/admin/import/hubspot/hubspot-import-state";

afterEach(() => {
  cleanup();
  mockListHubSpotDeals.mockReset();
  mockImportHubSpotDeals.mockReset();
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/** Mirrors csv-import-panel.dom.spec.tsx's documented deferred-promise workaround. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

function listOk(deals: readonly CrmDealSummary[], alreadyImportedCount = 0): CrmDealListResult {
  return { ok: true, deals, alreadyImportedCount };
}

function completeResult(overrides: Partial<CrmImportResult> = {}): CrmImportResult {
  return {
    status: "complete",
    importedCount: 1,
    failedCount: 0,
    totalCount: 1,
    failures: [],
    unmappedFields: [],
    retryable: false,
    reconnectRequired: false,
    ...overrides,
  };
}

async function selectDeal(name: string, companyName: string): Promise<void> {
  fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${name} (${companyName})` }));
}

describe("HubSpotImportPanel — loading then list render", () => {
  it("shows the picker's loading state, then the deal list once listHubSpotDeals() resolves", async () => {
    const deferred = createDeferred<CrmDealListResult>();
    mockListHubSpotDeals.mockReturnValueOnce(deferred.promise);
    render(<HubSpotImportPanel />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading deals from HubSpot");

    deferred.resolve(listOk([dealFixture({})]));

    expect(await screen.findByText("Acme renewal")).toBeInTheDocument();
    expect(mockListHubSpotDeals).toHaveBeenCalledTimes(1);
  });

  it("renders the heading and the field-mapping preview from the static field-map table", async () => {
    mockListHubSpotDeals.mockResolvedValueOnce(listOk([]));
    render(<HubSpotImportPanel />);

    expect(screen.getByRole("heading", { name: "Import deals from HubSpot" })).toBeInTheDocument();
    const mapping = await screen.findByTestId("crm-mapping-preview");
    expect(mapping).toHaveTextContent("Deal name");
    expect(mapping).toHaveTextContent("Not mapped");
  });
});

describe("HubSpotImportPanel — list-load failure", () => {
  it("renders the picker's failure state for an ok:false result", async () => {
    mockListHubSpotDeals.mockResolvedValueOnce({
      ok: false,
      reason: "token_expired",
      message: "The HubSpot connection has expired.",
      reconnectRequired: true,
    });
    render(<HubSpotImportPanel />);

    const errorPanel = await screen.findByTestId("crm-deal-picker-error");
    expect(errorPanel).toHaveTextContent("The HubSpot connection has expired.");
    expect(screen.getByRole("link", { name: "Reconnect HubSpot" })).toBeInTheDocument();
  });

  it("renders the same failure UI when listHubSpotDeals() throws, never stranding the page on Loading", async () => {
    mockListHubSpotDeals.mockRejectedValueOnce(new Error("network exploded"));
    render(<HubSpotImportPanel />);

    const errorPanel = await screen.findByTestId("crm-deal-picker-error");
    expect(errorPanel).toHaveTextContent(LOAD_DEALS_FAILED_MESSAGE);
    expect(screen.queryByRole("status", { name: /Loading/ })).not.toBeInTheDocument();
  });
});

describe("HubSpotImportPanel — import flow", () => {
  it("calls importHubSpotDeals with exactly the selected externalIds and renders ImportResultSummary from the response", async () => {
    mockListHubSpotDeals.mockResolvedValueOnce(
      listOk([dealFixture({ externalId: "d1", name: "Acme renewal" }), dealFixture({ externalId: "d2", name: "Globex expansion" })]),
    );
    mockImportHubSpotDeals.mockResolvedValueOnce(completeResult({ importedCount: 1, totalCount: 1 }));

    render(<HubSpotImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));

    await waitFor(() => expect(mockImportHubSpotDeals).toHaveBeenCalledTimes(1));
    expect(mockImportHubSpotDeals).toHaveBeenCalledWith(["d1"]);

    const summary = await screen.findByTestId("crm-import-result-summary");
    expect(summary).toHaveTextContent("1 of 1 deals imported.");
  });

  it("goes busy (picker unmounts its list, no double submits) while the import is in flight", async () => {
    mockListHubSpotDeals.mockResolvedValueOnce(listOk([dealFixture({ externalId: "d1", name: "Acme renewal" })]));
    const deferred = createDeferred<CrmImportResult>();
    mockImportHubSpotDeals.mockReturnValueOnce(deferred.promise);

    render(<HubSpotImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Loading deals from HubSpot"));
    expect(screen.queryByRole("button", { name: "Import 1 deal" })).not.toBeInTheDocument();

    mockListHubSpotDeals.mockResolvedValueOnce(listOk([]));
    deferred.resolve(completeResult());
    await screen.findByTestId("crm-import-result-summary");
  });

  it("re-fetches the deal list after a successful import so the picker reflects the new already-imported set", async () => {
    mockListHubSpotDeals
      .mockResolvedValueOnce(listOk([dealFixture({ externalId: "d1", name: "Acme renewal" })]))
      .mockResolvedValueOnce(listOk([], 1));
    mockImportHubSpotDeals.mockResolvedValueOnce(completeResult({ importedCount: 1, totalCount: 1 }));

    render(<HubSpotImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));

    await screen.findByTestId("crm-import-result-summary");
    expect(mockListHubSpotDeals).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId("crm-deal-picker-empty")).toHaveTextContent("All caught up");
  });

  it("does not re-fetch the deal list after a fully failed import (nothing changed server-side)", async () => {
    mockListHubSpotDeals.mockResolvedValueOnce(listOk([dealFixture({ externalId: "d1", name: "Acme renewal" })]));
    mockImportHubSpotDeals.mockResolvedValueOnce(
      completeResult({
        status: "failed",
        importedCount: 0,
        failedCount: 1,
        totalCount: 1,
        failures: [{ externalId: "d1", reason: "unknown", message: "The import worker crashed." }],
        retryable: true,
      }),
    );

    render(<HubSpotImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));

    await screen.findByTestId("crm-import-result-summary");
    expect(mockListHubSpotDeals).toHaveBeenCalledTimes(1);
  });

  it("retrying from ImportResultSummary re-invokes the import with the same selection", async () => {
    mockListHubSpotDeals.mockResolvedValue(listOk([dealFixture({ externalId: "d1", name: "Acme renewal" })]));
    mockImportHubSpotDeals.mockResolvedValueOnce(
      completeResult({
        status: "failed",
        importedCount: 0,
        failedCount: 1,
        totalCount: 1,
        failures: [{ externalId: "d1", reason: "unknown", message: "The import worker crashed." }],
        retryable: true,
      }),
    );

    render(<HubSpotImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));
    await screen.findByTestId("crm-import-result-summary");

    mockImportHubSpotDeals.mockResolvedValueOnce(completeResult({ importedCount: 1, totalCount: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Retry import" }));

    await waitFor(() => expect(mockImportHubSpotDeals).toHaveBeenCalledTimes(2));
    expect(mockImportHubSpotDeals).toHaveBeenNthCalledWith(2, ["d1"]);
  });

  it("ignores rapid duplicate retry clicks while an import is in flight (re-entrancy guard)", async () => {
    mockListHubSpotDeals.mockResolvedValue(listOk([dealFixture({ externalId: "d1", name: "Acme renewal" })]));
    mockImportHubSpotDeals.mockResolvedValueOnce(
      completeResult({
        status: "failed",
        importedCount: 0,
        failedCount: 1,
        totalCount: 1,
        failures: [{ externalId: "d1", reason: "unknown", message: "The import worker crashed." }],
        retryable: true,
      }),
    );

    render(<HubSpotImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));
    await screen.findByTestId("crm-import-result-summary");

    // Second import call resolves only when we say so — the retry button
    // stays mounted meanwhile, so extra clicks land while it is in flight.
    let resolveImport: (result: ReturnType<typeof completeResult>) => void = () => {};
    mockImportHubSpotDeals.mockImplementationOnce(
      () => new Promise((resolve) => (resolveImport = resolve)),
    );

    const retryButton = screen.getByRole("button", { name: "Retry import" });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    // 1 initial import + exactly 1 retry — duplicate clicks were swallowed.
    expect(mockImportHubSpotDeals).toHaveBeenCalledTimes(2);

    resolveImport(completeResult({ importedCount: 1, totalCount: 1 }));
    await waitFor(() => expect(mockListHubSpotDeals).toHaveBeenCalledTimes(2));
    expect(mockImportHubSpotDeals).toHaveBeenCalledTimes(2);
  });
});

describe("HubSpotImportPanel — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath, URL: NodeURL } = await import("node:url");
    const cssPath = fileURLToPath(
      new NodeURL("../../app/admin/import/hubspot/hubspot-import-panel.css", import.meta.url),
    );
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
