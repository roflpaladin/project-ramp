import type { CrmImportResult } from "@/lib/crm-import/types";

/**
 * Sprint 10, Ticket 54, Phase 1 — the retry/reconnect action row for a CRM
 * import result. PROVISIONAL (see lib/crm/import-ui-types.ts): consumes
 * CrmImportResult's `retryable`/`reconnectRequired` booleans exactly as
 * given. No API call happens here — `onRetry` is a plain caller-supplied
 * callback, so the real retry request stays out of this presentational
 * component entirely; T53's backend session owns wiring it up.
 *
 * One Signal per decision scope (design system MUST), per the ruling agreed
 * with the T53 owner: retrying with a dead/expired token would just fail
 * again, so whenever `reconnectRequired` is true the RECONNECT link is this
 * row's one Signal, and retry (if also offered) renders as a plain
 * secondary button instead. Retry is only ever the Signal when reconnect is
 * NOT required. When neither is true there is nothing actionable to offer,
 * so this renders nothing — the failure detail list is what surfaces the
 * "why" in that case, never a dead button.
 *
 * PROVIDER AWARENESS (Sprint 11, Ticket 56): `providerLabel` and
 * `reconnectHref` de-hardcode the "Reconnect HubSpot" text and its href so
 * this row also serves the Salesforce import page. Both default to the
 * original HubSpot values — backward-safe for any caller that predates this
 * ticket. HUBSPOT_OAUTH_START_HREF stays exported here for those callers
 * (and this file's own default) to keep pointing at explicitly.
 */
export const HUBSPOT_OAUTH_START_HREF = "/api/integrations/hubspot/oauth/start";

export interface CrmRetryReconnectRowProps {
  readonly retryable: CrmImportResult["retryable"];
  readonly reconnectRequired: CrmImportResult["reconnectRequired"];
  readonly onRetry: () => void;
  readonly providerLabel?: "HubSpot" | "Salesforce";
  readonly reconnectHref?: string;
}

export function CrmRetryReconnectRow({
  retryable,
  reconnectRequired,
  onRetry,
  providerLabel = "HubSpot",
  reconnectHref = HUBSPOT_OAUTH_START_HREF,
}: CrmRetryReconnectRowProps) {
  if (!retryable && !reconnectRequired) return null;

  return (
    <div className="cir-actions">
      {reconnectRequired ? (
        <a href={reconnectHref} className="cir-btn cir-btn-primary" data-signal="true">
          Reconnect {providerLabel}
        </a>
      ) : null}
      {retryable ? (
        <button
          type="button"
          onClick={onRetry}
          className={reconnectRequired ? "cir-btn cir-btn-secondary" : "cir-btn cir-btn-primary"}
          data-signal={reconnectRequired ? undefined : "true"}
        >
          Retry import
        </button>
      ) : null}
    </div>
  );
}
