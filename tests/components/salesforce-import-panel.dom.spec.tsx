// Sprint 11, Ticket 56. Component-level DOM assertions for
// app/admin/import/salesforce/salesforce-import-panel.tsx — the real wiring
// between the shared presentation components (CrmDealPicker, CrmMappingPreview,
// ImportResultSummary) and the real salesforce-import-actions.ts server
// actions, mirroring tests/components/hubspot-import-panel.dom.spec.tsx
// byte-for-byte with s/HubSpot/Salesforce/ (see that file's header for the
// full reasoning). Runs under the "components" Vitest project (happy-dom)
// — see vitest.config.ts.
//
// salesforce-import-actions.ts is a "use server" module (Server Actions can't
// run inside happy-dom), so it is mocked wholesale, mirroring
// tests/components/csv-import-panel.dom.spec.tsx's house style; this file
// only exercises the panel's own wiring/state-transition logic, never the
// real action bodies (those are covered elsewhere against a real Supabase
// project). salesforce-import-state.ts is NOT mocked — no server-only
// dependency, same reasoning as import-state.ts's own header.
//
// Coverage per the hubspot-import-panel.dom.spec.tsx wiring brief: loading renders the picker's own
// loading state, then the deal list once listSalesforceDeals() resolves; a
// list-load failure (ok:false) renders the picker's failure state; a thrown
// list-load promise still renders that same failure state rather than
// stranding the page on "Loading…" forever; the import flow calls
// importSalesforceDeals() with exactly the selected externalIds and renders
// ImportResultSummary from its response; a successful/partial import
// re-fetches the deal list (imported deals are filtered server-side); the
// picker goes busy (no double submits) while an import is in flight; the
// field-mapping preview renders from salesforce-field-map.ts's static table.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CrmDealListResult, CrmDealSummary, CrmImportResult } from "@/lib/crm-import/types";

const { mockListSalesforceDeals, mockImportSalesforceDeals } = vi.hoisted(() => ({
  mockListSalesforceDeals: vi.fn(),
  mockImportSalesforceDeals: vi.fn(),
}));

vi.mock("@/app/admin/import/salesforce/salesforce-import-actions", () => ({
  listSalesforceDeals: mockListSalesforceDeals,
  importSalesforceDeals: mockImportSalesforceDeals,
}));

import { SalesforceImportPanel } from "@/app/admin/import/salesforce/salesforce-import-panel";
import { LOAD_DEALS_FAILED_MESSAGE } from "@/app/admin/import/salesforce/salesforce-import-state";

afterEach(() => {
  cleanup();
  mockListSalesforceDeals.mockReset();
  mockImportSalesforceDeals.mockReset();
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

describe("SalesforceImportPanel — loading then list render", () => {
  it("shows the picker's loading state, then the deal list once listSalesforceDeals() resolves", async () => {
    const deferred = createDeferred<CrmDealListResult>();
    mockListSalesforceDeals.mockReturnValueOnce(deferred.promise);
    render(<SalesforceImportPanel />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading deals from Salesforce");

    deferred.resolve(listOk([dealFixture({})]));

    expect(await screen.findByText("Acme renewal")).toBeInTheDocument();
    expect(mockListSalesforceDeals).toHaveBeenCalledTimes(1);
  });

  it("renders the heading and the field-mapping preview from the static field-map table", async () => {
    mockListSalesforceDeals.mockResolvedValueOnce(listOk([]));
    render(<SalesforceImportPanel />);

    expect(screen.getByRole("heading", { name: "Import deals from Salesforce" })).toBeInTheDocument();
    const mapping = await screen.findByTestId("crm-mapping-preview");
    expect(mapping).toHaveTextContent("Opportunity name");
    expect(mapping).toHaveTextContent("Not mapped");
  });
});

describe("SalesforceImportPanel — list-load failure", () => {
  it("renders the picker's failure state for an ok:false result", async () => {
    mockListSalesforceDeals.mockResolvedValueOnce({
      ok: false,
      reason: "token_expired",
      message: "The Salesforce connection has expired.",
      reconnectRequired: true,
    });
    render(<SalesforceImportPanel />);

    const errorPanel = await screen.findByTestId("crm-deal-picker-error");
    expect(errorPanel).toHaveTextContent("The Salesforce connection has expired.");
    const reconnectLink = screen.getByRole("link", { name: "Reconnect Salesforce" });
    expect(reconnectLink).toHaveAttribute("href", "/api/integrations/salesforce/oauth/start");
  });

  it("renders the same failure UI when listSalesforceDeals() throws, never stranding the page on Loading", async () => {
    mockListSalesforceDeals.mockRejectedValueOnce(new Error("network exploded"));
    render(<SalesforceImportPanel />);

    const errorPanel = await screen.findByTestId("crm-deal-picker-error");
    expect(errorPanel).toHaveTextContent(LOAD_DEALS_FAILED_MESSAGE);
    expect(screen.queryByRole("status", { name: /Loading/ })).not.toBeInTheDocument();
  });
});

describe("SalesforceImportPanel — import flow", () => {
  it("calls importSalesforceDeals with exactly the selected externalIds and renders ImportResultSummary from the response", async () => {
    mockListSalesforceDeals.mockResolvedValueOnce(
      listOk([dealFixture({ externalId: "d1", name: "Acme renewal" }), dealFixture({ externalId: "d2", name: "Globex expansion" })]),
    );
    mockImportSalesforceDeals.mockResolvedValueOnce(completeResult({ importedCount: 1, totalCount: 1 }));

    render(<SalesforceImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));

    await waitFor(() => expect(mockImportSalesforceDeals).toHaveBeenCalledTimes(1));
    expect(mockImportSalesforceDeals).toHaveBeenCalledWith(["d1"]);

    const summary = await screen.findByTestId("crm-import-result-summary");
    expect(summary).toHaveTextContent("1 of 1 deals imported.");
  });

  it("goes busy (picker unmounts its list, no double submits) while the import is in flight", async () => {
    mockListSalesforceDeals.mockResolvedValueOnce(listOk([dealFixture({ externalId: "d1", name: "Acme renewal" })]));
    const deferred = createDeferred<CrmImportResult>();
    mockImportSalesforceDeals.mockReturnValueOnce(deferred.promise);

    render(<SalesforceImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Loading deals from Salesforce"));
    expect(screen.queryByRole("button", { name: "Import 1 deal" })).not.toBeInTheDocument();

    mockListSalesforceDeals.mockResolvedValueOnce(listOk([]));
    deferred.resolve(completeResult());
    await screen.findByTestId("crm-import-result-summary");
  });

  it("re-fetches the deal list after a successful import so the picker reflects the new already-imported set", async () => {
    mockListSalesforceDeals
      .mockResolvedValueOnce(listOk([dealFixture({ externalId: "d1", name: "Acme renewal" })]))
      .mockResolvedValueOnce(listOk([], 1));
    mockImportSalesforceDeals.mockResolvedValueOnce(completeResult({ importedCount: 1, totalCount: 1 }));

    render(<SalesforceImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));

    await screen.findByTestId("crm-import-result-summary");
    expect(mockListSalesforceDeals).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId("crm-deal-picker-empty")).toHaveTextContent("All caught up");
  });

  it("does not re-fetch the deal list after a fully failed import (nothing changed server-side)", async () => {
    mockListSalesforceDeals.mockResolvedValueOnce(listOk([dealFixture({ externalId: "d1", name: "Acme renewal" })]));
    mockImportSalesforceDeals.mockResolvedValueOnce(
      completeResult({
        status: "failed",
        importedCount: 0,
        failedCount: 1,
        totalCount: 1,
        failures: [{ externalId: "d1", reason: "unknown", message: "The import worker crashed." }],
        retryable: true,
      }),
    );

    render(<SalesforceImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));

    await screen.findByTestId("crm-import-result-summary");
    expect(mockListSalesforceDeals).toHaveBeenCalledTimes(1);
  });

  it("retrying from ImportResultSummary re-invokes the import with the same selection", async () => {
    mockListSalesforceDeals.mockResolvedValue(listOk([dealFixture({ externalId: "d1", name: "Acme renewal" })]));
    mockImportSalesforceDeals.mockResolvedValueOnce(
      completeResult({
        status: "failed",
        importedCount: 0,
        failedCount: 1,
        totalCount: 1,
        failures: [{ externalId: "d1", reason: "unknown", message: "The import worker crashed." }],
        retryable: true,
      }),
    );

    render(<SalesforceImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));
    await screen.findByTestId("crm-import-result-summary");

    mockImportSalesforceDeals.mockResolvedValueOnce(completeResult({ importedCount: 1, totalCount: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Retry import" }));

    await waitFor(() => expect(mockImportSalesforceDeals).toHaveBeenCalledTimes(2));
    expect(mockImportSalesforceDeals).toHaveBeenNthCalledWith(2, ["d1"]);
  });

  it("ignores rapid duplicate retry clicks while an import is in flight (re-entrancy guard)", async () => {
    mockListSalesforceDeals.mockResolvedValue(listOk([dealFixture({ externalId: "d1", name: "Acme renewal" })]));
    mockImportSalesforceDeals.mockResolvedValueOnce(
      completeResult({
        status: "failed",
        importedCount: 0,
        failedCount: 1,
        totalCount: 1,
        failures: [{ externalId: "d1", reason: "unknown", message: "The import worker crashed." }],
        retryable: true,
      }),
    );

    render(<SalesforceImportPanel />);
    await selectDeal("Acme renewal", "Acme Corp");
    fireEvent.click(screen.getByRole("button", { name: "Import 1 deal" }));
    await screen.findByTestId("crm-import-result-summary");

    // Second import call resolves only when we say so — the retry button
    // stays mounted meanwhile, so extra clicks land while it is in flight.
    let resolveImport: (result: ReturnType<typeof completeResult>) => void = () => {};
    mockImportSalesforceDeals.mockImplementationOnce(
      () => new Promise((resolve) => (resolveImport = resolve)),
    );

    const retryButton = screen.getByRole("button", { name: "Retry import" });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    // 1 initial import + exactly 1 retry — duplicate clicks were swallowed.
    expect(mockImportSalesforceDeals).toHaveBeenCalledTimes(2);

    resolveImport(completeResult({ importedCount: 1, totalCount: 1 }));
    await waitFor(() => expect(mockListSalesforceDeals).toHaveBeenCalledTimes(2));
    expect(mockImportSalesforceDeals).toHaveBeenCalledTimes(2);
  });
});

describe("SalesforceImportPanel — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath, URL: NodeURL } = await import("node:url");
    const cssPath = fileURLToPath(
      new NodeURL("../../app/admin/import/salesforce/salesforce-import-panel.css", import.meta.url),
    );
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
