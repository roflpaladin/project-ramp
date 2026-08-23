// Ticket 45 (Sprint 9), Phase 2b. Component-level DOM assertions for
// app/admin/import/csv-import-panel.tsx. Runs under the "components" Vitest
// project (happy-dom) — see vitest.config.ts.
//
// import-actions.ts is a "use server" module (Server Actions can't run
// inside happy-dom — there is no Next.js server runtime backing
// cookies()/headers()/Supabase there), so it is mocked wholesale, mirroring
// tests/components/invite-panel.dom.spec.tsx and
// tests/components/onboarding-flow.dom.spec.tsx's house style; this file
// only exercises CsvImportPanel's own rendering/state-transition logic,
// never the real action body (that is covered against a real Supabase
// project by tests/security/csv-import-action.spec.ts instead).
// import-state.ts is NOT mocked — it has no server-only dependency
// (deliberately kept out of the "use server" module for exactly this
// reason, see its own header comment), so the real
// INITIAL_CSV_IMPORT_STATE/message constants are imported and used as-is.
//
// Coverage per the ticket brief: initial state (labelled file input, the
// panel's sole primary Import-deals button, no results); pending
// presentation (aria-busy, width-preserving label swap); full-success
// render (done-state dot+text badge, a secondary "Go to workspaces" follow-
// up link, never a second Signal); partial-failure render (risk-toned
// dot+text badge, a plain "fix the rows below" sentence, a row-numbered
// table of the summary's own verbatim messages); error tone (role="alert");
// the client-side file-too-large precheck (blocks submit, mirrors
// FILE_TOO_LARGE_MESSAGE, no server round trip); keyboard focusability.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImportSummary } from "@/lib/import/summarize-import";
import { MAX_CSV_BYTES } from "@/lib/import/csv-limits";

const { mockImportDealsFromCsv } = vi.hoisted(() => ({
  mockImportDealsFromCsv: vi.fn(),
}));

vi.mock("@/app/admin/import/import-actions", () => ({
  importDealsFromCsv: mockImportDealsFromCsv,
}));

import * as CsvImportPanelModule from "@/app/admin/import/csv-import-panel";
import { CsvImportPanel } from "@/app/admin/import/csv-import-panel";
import { FILE_TOO_LARGE_MESSAGE } from "@/app/admin/import/import-state";
import type { CsvImportActionState } from "@/app/admin/import/import-state";

afterEach(() => {
  cleanup();
  mockImportDealsFromCsv.mockReset();
});

function csvFile(name: string, sizeInBytes: number): File {
  const file = new File(["a"], name, { type: "text/csv" });
  Object.defineProperty(file, "size", { value: sizeInBytes });
  return file;
}

function summaryState(summary: ImportSummary): CsvImportActionState {
  return { error: null, summary };
}

function errorState(message: string): CsvImportActionState {
  return { error: message, summary: null };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/**
 * React 19 entangles concurrent form-action transitions on a single shared
 * queue — a promise a test leaves permanently unresolved therefore blocks
 * every OTHER test's action in this file too. Copied from
 * tests/components/invite-panel.dom.spec.tsx's documented workaround.
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function selectFile(file: File): Promise<HTMLInputElement> {
  const input = screen.getByLabelText("CSV file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

/**
 * happy-dom quirk (confirmed against a minimal repro before writing this):
 * a required `<input type="file">`'s constraint validation reads `.value`
 * (which a `fireEvent.change({ target: { files } })` never sets — real
 * browsers leave `.value` blank for a chosen file too, for the same
 * filesystem-privacy reason, and validate `.files.length` instead), so
 * `fireEvent.click()` on the submit button never dispatches `submit` at all
 * once a file is selected. `fireEvent.submit(form)` is the real-DOM-accurate
 * workaround: a programmatically dispatched `submit` event (unlike an actual
 * button click/Enter-key submission) never re-runs constraint validation in
 * a real browser either, so this exercises the exact same React
 * action-submit path the real click path both take once past that gate.
 */
function submitForm(importButton: HTMLElement): void {
  const form = importButton.closest("form");
  if (!form) throw new Error("submitForm: Import deals button is not inside a <form>");
  fireEvent.submit(form);
}

describe("module boundary — single entry point", () => {
  it("exports exactly one runtime value: CsvImportPanel", () => {
    expect(Object.keys(CsvImportPanelModule)).toEqual(["CsvImportPanel"]);
  });
});

describe("CsvImportPanel — initial state", () => {
  it("renders a labelled file input and exactly one primary Import-deals button, no results", () => {
    const { container } = render(<CsvImportPanel />);

    expect(screen.getByRole("heading", { name: "Import deals from a CSV file" })).toBeInTheDocument();
    expect(screen.getByLabelText("CSV file")).toBeInTheDocument();

    const importButton = screen.getByRole("button", { name: "Import deals" });
    expect(importButton).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("carries the data-surface attribute every rule in csv-import-panel.css is scoped to", () => {
    render(<CsvImportPanel />);
    expect(screen.getByTestId("csv-import-panel")).toHaveAttribute("data-surface", "csv-import-panel");
  });

  it("accepts only .csv/text/csv uploads", () => {
    render(<CsvImportPanel />);
    expect(screen.getByLabelText("CSV file")).toHaveAttribute("accept", ".csv,text/csv");
  });

  it("orients with one sentence naming the expected columns and the size/row caps in Geist Mono", () => {
    render(<CsvImportPanel />);
    expect(
      screen.getByText(/company_name, company_domain, contact_email, plan_title and target_date columns/),
    ).toBeInTheDocument();
    expect(screen.getByText("512KB")).toHaveClass("cip-mono");
    expect(screen.getByText("200")).toHaveClass("cip-mono");
  });

  it("is keyboard focusable: file input and submit button both reachable by tab order", () => {
    render(<CsvImportPanel />);
    const fileInput = screen.getByLabelText("CSV file");
    const importButton = screen.getByRole("button", { name: "Import deals" });

    fileInput.focus();
    expect(fileInput).toHaveFocus();

    importButton.focus();
    expect(importButton).toHaveFocus();
  });
});

describe("CsvImportPanel — client-side file-too-large precheck", () => {
  it("blocks submit and shows the server's own FILE_TOO_LARGE_MESSAGE, without calling the action", async () => {
    render(<CsvImportPanel />);

    await selectFile(csvFile("big.csv", MAX_CSV_BYTES + 1));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(FILE_TOO_LARGE_MESSAGE);
    expect(alert).toHaveAttribute("data-tone", "risk");
    expect(alert.querySelector(".cip-status-dot")).not.toBeNull();

    const importButton = screen.getByRole("button", { name: "Import deals" });
    expect(importButton).toBeDisabled();

    fireEvent.click(importButton);
    expect(mockImportDealsFromCsv).not.toHaveBeenCalled();
  });

  it("clears the precheck error and re-enables submit once a small-enough file is chosen", async () => {
    render(<CsvImportPanel />);

    await selectFile(csvFile("big.csv", MAX_CSV_BYTES + 1));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await selectFile(csvFile("small.csv", 1024));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import deals" })).not.toBeDisabled();
  });
});

describe("CsvImportPanel — pending presentation", () => {
  it("disables the button and swaps its label for a spinner at the button's own width, with no layout shift", async () => {
    const deferred = createDeferred<CsvImportActionState>();
    mockImportDealsFromCsv.mockReturnValueOnce(deferred.promise);
    render(<CsvImportPanel />);

    await selectFile(csvFile("deals.csv", 1024));
    const importButton = screen.getByRole("button", { name: "Import deals" });
    submitForm(importButton);

    await waitFor(() => expect(importButton).toBeDisabled());
    expect(importButton).toHaveAttribute("aria-busy", "true");
    expect(importButton).toHaveAccessibleName("Importing");
    expect(importButton.querySelector(".cip-spinner")).not.toBeNull();

    // The label stays in the DOM (opacity only) rather than being removed —
    // that's what keeps the button at its own width instead of reflowing.
    expect(importButton).toHaveTextContent("Import deals");

    deferred.resolve(summaryState({ total: 1, succeeded: 1, failed: 0, failures: [] }));
    await waitFor(() => expect(importButton).not.toBeDisabled());
  });
});

describe("CsvImportPanel — full success", () => {
  it("renders a done-state dot+text badge and a secondary follow-up link, never a second Signal", async () => {
    mockImportDealsFromCsv.mockResolvedValueOnce(
      summaryState({ total: 10, succeeded: 10, failed: 0, failures: [] }),
    );
    const { container } = render(<CsvImportPanel />);

    await selectFile(csvFile("deals.csv", 1024));
    submitForm(screen.getByRole("button", { name: "Import deals" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("10 of 10 rows imported.");
    expect(status.querySelector(".cip-status-dot")).not.toBeNull();
    expect(status.querySelector('[data-tone="done"]')).not.toBeNull();

    const followUp = screen.getByRole("link", { name: "Go to workspaces" });
    expect(followUp).not.toHaveAttribute("data-signal");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("CsvImportPanel — partial failure", () => {
  it("renders the risk-toned summary badge, the fix-and-resubmit sentence, and every failed row verbatim in Geist Mono", async () => {
    mockImportDealsFromCsv.mockResolvedValueOnce(
      summaryState({
        total: 10,
        succeeded: 7,
        failed: 3,
        failures: [
          { rowNumber: 2, errors: ["Missing company_domain."] },
          { rowNumber: 5, errors: ["Invalid target_date."] },
          { rowNumber: 9, errors: ["Missing contact_email.", "Missing plan_title."] },
        ],
      }),
    );
    render(<CsvImportPanel />);

    await selectFile(csvFile("deals.csv", 1024));
    submitForm(screen.getByRole("button", { name: "Import deals" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("7 of 10 rows imported.");
    expect(status.querySelector('[data-tone="risk"]')).not.toBeNull();

    expect(screen.getByText("Fix the rows below and upload just those rows again.")).toBeInTheDocument();

    const table = screen.getByRole("table");
    const rowNumberCells = table.querySelectorAll("td.cip-mono");
    expect(Array.from(rowNumberCells).map((cell) => cell.textContent)).toEqual(["2", "5", "9"]);

    expect(screen.getByText("Missing company_domain.")).toBeInTheDocument();
    expect(screen.getByText("Invalid target_date.")).toBeInTheDocument();
    expect(screen.getByText("Missing contact_email.")).toBeInTheDocument();
    expect(screen.getByText("Missing plan_title.")).toBeInTheDocument();

    // Never a second Signal — the seller acts by resubmitting the same
    // Import-deals button, not a second control.
    expect(screen.getByRole("button", { name: "Import deals" })).toHaveAttribute("data-signal", "true");
    expect(screen.queryByRole("link", { name: "Go to workspaces" })).not.toBeInTheDocument();
  });
});

describe("CsvImportPanel — server-side error (recoverable)", () => {
  it("renders a dot+text alert with the server's own message, and leaves the form resubmittable", async () => {
    mockImportDealsFromCsv.mockResolvedValueOnce(
      errorState("You've run several imports in a short time. Wait a few minutes, then try again."),
    );
    render(<CsvImportPanel />);

    await selectFile(csvFile("deals.csv", 1024));
    submitForm(screen.getByRole("button", { name: "Import deals" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You've run several imports in a short time. Wait a few minutes, then try again.");
    expect(alert).toHaveAttribute("data-tone", "risk");
    expect(alert.querySelector(".cip-status-dot")).not.toBeNull();

    const importButton = screen.getByRole("button", { name: "Import deals" });
    expect(importButton).not.toBeDisabled();
  });
});

describe("CsvImportPanel — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(new NodeURL("../../app/admin/import/csv-import-panel.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
