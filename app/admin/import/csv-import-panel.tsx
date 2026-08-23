"use client";

import { useActionState, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { importDealsFromCsv } from "./import-actions";
import { FILE_TOO_LARGE_MESSAGE, INITIAL_CSV_IMPORT_STATE } from "./import-state";
import { MAX_CSV_BYTES, MAX_CSV_ROWS } from "@/lib/import/csv-limits";
import "./csv-import-panel.css";

/**
 * Ticket 45 (Sprint 9), Phase 2b — the CSV deal-import upload surface,
 * wired to import-actions.ts's importDealsFromCsv (useActionState-shaped,
 * committed in Phase 2a). Structurally copied from
 * app/admin/workspaces/[id]/invite-panel.tsx and
 * app/admin/onboarding/onboarding-flow.tsx: same label-above-input,
 * width-preserving pending button, and dot+text status conventions.
 *
 * One Signal per decision scope (design system MUST): "Import deals" is this
 * panel's sole `data-signal="true"` element throughout. The full-success
 * result's follow-up link ("Go to workspaces") is a plain tertiary link —
 * never a second primary — and the partial-failure result offers no button
 * at all, only the failed-row list itself (the seller acts on it by editing
 * their CSV and resubmitting the SAME "Import deals" button, not a second
 * control).
 */
const maxFileKilobytes = MAX_CSV_BYTES / 1024;

interface ImportSubmitButtonProps {
  isPending: boolean;
  isDisabled: boolean;
}

function ImportSubmitButton({ isPending, isDisabled }: ImportSubmitButtonProps) {
  return (
    <button
      type="submit"
      className="cip-btn cip-btn-primary"
      disabled={isDisabled}
      aria-busy={isPending}
      aria-label={isPending ? "Importing" : undefined}
      data-signal="true"
    >
      <span className="cip-btn-label" data-pending={isPending}>
        Import deals
      </span>
      {isPending ? (
        <span className="cip-spinner" aria-hidden="true">
          <span className="cip-spinner-ring" />
        </span>
      ) : null}
    </button>
  );
}

interface StatusBadgeProps {
  tone: "done" | "risk";
  children: ReactNode;
}

/** Dot + text badge — status is never colour-only, per the design system MUST. */
function StatusBadge({ tone, children }: StatusBadgeProps) {
  return (
    <p className="cip-status" data-tone={tone}>
      <span className="cip-status-dot" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function CsvImportPanel() {
  const [state, formAction, isImporting] = useActionState(importDealsFromCsv, INITIAL_CSV_IMPORT_STATE);
  const [clientError, setClientError] = useState<string | null>(null);

  // Mirrors import-actions.ts's own File.size > MAX_CSV_BYTES check, with the
  // exact same user-facing copy (FILE_TOO_LARGE_MESSAGE, shared from
  // ./import-state.ts) — catches the common case before a wasted round trip,
  // never as a replacement for the server's own check.
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setClientError(file && file.size > MAX_CSV_BYTES ? FILE_TOO_LARGE_MESSAGE : null);
  }

  const hasClientError = clientError !== null;
  const submissionError = clientError ?? state.error;
  const summary = state.summary;

  return (
    <section className="cip-card" data-surface="csv-import-panel" data-testid="csv-import-panel">
      <h1 className="cip-title">Import deals from a CSV file</h1>
      <p className="cip-intro">
        Upload a CSV with company_name, company_domain, contact_email, plan_title and target_date columns, up to{" "}
        <span className="cip-mono">{maxFileKilobytes}KB</span> and <span className="cip-mono">{MAX_CSV_ROWS}</span>{" "}
        rows.
      </p>

      <form action={formAction} className="cip-form">
        <label className="cip-field">
          CSV file
          <input
            className="cip-file-input"
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            onChange={handleFileChange}
            disabled={isImporting}
            aria-invalid={submissionError !== null ? true : undefined}
            aria-describedby={submissionError !== null ? "cip-error" : undefined}
          />
        </label>

        {submissionError ? (
          <p className="cip-status" data-tone="risk" role="alert" id="cip-error">
            <span className="cip-status-dot" aria-hidden="true" />
            <span>{submissionError}</span>
          </p>
        ) : null}

        <ImportSubmitButton isPending={isImporting} isDisabled={isImporting || hasClientError} />
      </form>

      {summary && summary.failed === 0 ? (
        <div className="cip-results" role="status">
          <StatusBadge tone="done">
            <span className="cip-mono">{summary.succeeded}</span> of <span className="cip-mono">{summary.total}</span>{" "}
            rows imported.
          </StatusBadge>
          <Link href="/admin" className="cip-btn cip-btn-tertiary">
            Go to workspaces
          </Link>
        </div>
      ) : null}

      {summary && summary.failed > 0 ? (
        <div className="cip-results" role="status">
          <StatusBadge tone="risk">
            <span className="cip-mono">{summary.succeeded}</span> of <span className="cip-mono">{summary.total}</span>{" "}
            rows imported.
          </StatusBadge>
          <p className="cip-results-intro">Fix the rows below and upload just those rows again.</p>
          <table className="cip-failures-table">
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Issue</th>
              </tr>
            </thead>
            <tbody>
              {summary.failures.map((failure) => (
                <tr key={failure.rowNumber}>
                  <td className="cip-mono">{failure.rowNumber}</td>
                  <td>
                    {failure.errors.map((message, index) => (
                      <div key={`${failure.rowNumber}-${index}`}>{message}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
