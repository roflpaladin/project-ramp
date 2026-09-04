import type { CrmImportFailure, CrmImportFailureReason } from "@/lib/crm-import/types";

/**
 * Sprint 10, Ticket 54, Phase 1 — failure detail list for a CRM import
 * result, grouped by the closed reason set (lib/crm/import-ui-types.ts's
 * CrmImportFailureReason). Failures are never dropped or summarized away:
 * every failed deal's own server-supplied message renders verbatim,
 * mirroring app/admin/import/csv-import-panel.tsx's "trust the server's own
 * message" convention for its per-row failure table.
 */

const REASON_ORDER: readonly CrmImportFailureReason[] = ["rate_limited", "token_expired", "invalid_data", "unknown"];

interface FailureReasonMeta {
  readonly tone: "wait" | "risk";
  readonly label: string;
}

/**
 * Exhaustive switch, not a lookup table — deliberately, so a future reason
 * added to the closed union fails typecheck right here instead of silently
 * falling through to a generic label (see import-ui-types.ts's header
 * comment, which names this switch as the contract's one required update
 * point when T53 adds a reason).
 *
 * rate_limited reads as Slate ("wait"), never the loud risk red: a CRM
 * rate limit is a transient, self-resolving condition the seller waits out
 * and retries, not an error to alarm over — the design system's
 * "waiting/pending states render in Slate" rule. The other three reasons
 * (a stale token, bad data, or an unexplained failure) are durable and need
 * the seller's attention, so they read as risk.
 *
 * PROVIDER AWARENESS (Sprint 11, Ticket 56): `providerLabel` de-hardcodes
 * the "HubSpot" wording baked into the rate_limited/token_expired labels so
 * this also serves the Salesforce import page. Defaults to "HubSpot" —
 * backward-safe for any caller that predates this ticket.
 */
export function describeFailureReason(
  reason: CrmImportFailureReason,
  providerLabel: "HubSpot" | "Salesforce" = "HubSpot",
): FailureReasonMeta {
  switch (reason) {
    case "rate_limited":
      return { tone: "wait", label: `Rate limited by ${providerLabel}` };
    case "token_expired":
      return { tone: "risk", label: `${providerLabel} connection expired` };
    case "invalid_data":
      return { tone: "risk", label: "Invalid data" };
    case "unknown":
      return { tone: "risk", label: "Unknown error" };
    default: {
      const exhaustiveCheck: never = reason;
      throw new Error(`Unhandled CRM import failure reason: ${String(exhaustiveCheck)}`);
    }
  }
}

interface FailureGroup {
  readonly reason: CrmImportFailureReason;
  readonly items: readonly CrmImportFailure[];
}

function groupFailuresByReason(failures: readonly CrmImportFailure[]): readonly FailureGroup[] {
  return REASON_ORDER.map((reason) => ({
    reason,
    items: failures.filter((failure) => failure.reason === reason),
  })).filter((group) => group.items.length > 0);
}

export interface CrmFailureDetailListProps {
  readonly failures: readonly CrmImportFailure[];
  readonly providerLabel?: "HubSpot" | "Salesforce";
}

export function CrmFailureDetailList({ failures, providerLabel = "HubSpot" }: CrmFailureDetailListProps) {
  if (failures.length === 0) return null;

  return (
    <div className="cir-failures" data-testid="crm-failure-detail-list">
      {groupFailuresByReason(failures).map((group) => {
        const meta = describeFailureReason(group.reason, providerLabel);
        return (
          <div key={group.reason} className="cir-failure-group">
            <p className="cir-status" data-tone={meta.tone}>
              <span className="cir-status-dot" aria-hidden="true" />
              <span>
                {meta.label} (<span className="cir-mono">{group.items.length}</span>)
              </span>
            </p>
            <ul className="cir-failure-list">
              {group.items.map((failure) => (
                <li key={failure.externalId} className="cir-failure-item">
                  <span className="cir-mono">{failure.externalId}</span>
                  <span>{failure.message}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
