import type { CrmForecastView } from "@/lib/crm/forecast";
import type { EngagementSignal } from "@/lib/plans/engagement";
import { LockIcon } from "./private-badge";
import { ForecastNudge } from "./forecast-nudge";
import { formatCrmAmount, formatCrmCloseDate, formatSyncedAt } from "./crm-format";
import "./crm-forecast-strip.css";

interface CrmForecastStripProps {
  /** workspaces.target_company_name — for the "never shown to <buyer>" label. */
  targetCompanyName: string;
  forecast: CrmForecastView;
  engagementSignal: EngagementSignal;
  /**
   * workspaces.internal_chat_url — SELLER-PRIVATE and screen-share-sensitive
   * (T31-6). Rendered masked behind a reveal action below, never plain in the
   * DOM by default. Ticket 32 owns the full team-chat presence control
   * (buyer-visible chat_url, live button in the chrome); this component only
   * handles masking the internal link within this seller-private strip.
   */
  internalChatUrl: string | null;
}

/**
 * Seller-private CRM/forecast strip (Ticket 31, T31-3..T31-6).
 *
 * Fenced treatment mirrors Ticket 30's private-link idiom: dashed border +
 * lock icon + text, never colour alone (T30-4's PrivateBadge does the same
 * thing for a single link row; this does it for the whole strip). Data is
 * cached/mocked, not a live CRM read (T31-5) — the "Illustrative" badge makes
 * that unmistakable so nobody mistakes it for a live feed.
 *
 * Hides entirely — renders nothing, no empty fields — when the workspace has
 * never synced from a CRM (`forecast.source === null`). The caller is also
 * expected to skip mounting this component altogether when
 * `getCrmForecastForWorkspace` returns `null` (workspace not visible); the
 * `source === null` check here is this component's own half of that
 * contract so the hide behaviour holds even if a future caller forgets.
 */
export function CrmForecastStrip({
  targetCompanyName,
  forecast,
  engagementSignal,
  internalChatUrl,
}: CrmForecastStripProps) {
  if (forecast.source === null) return null;

  return (
    <section data-surface="crm-strip" aria-label="Private CRM forecast">
      <div className="cfs-header">
        <span className="cfs-fence-label">
          <LockIcon aria-hidden="true" className="cfs-lock-icon" />
          Private to you · never shown to {targetCompanyName}
        </span>
        <span className="cfs-illustrative-badge">Illustrative — mock data</span>
      </div>

      <dl className="cfs-fields">
        <div className="cfs-field">
          <dt>Source</dt>
          <dd>{forecast.source}</dd>
        </div>
        <div className="cfs-field">
          <dt>Stage</dt>
          <dd>{forecast.stage ?? "—"}</dd>
        </div>
        <div className="cfs-field">
          <dt>Amount</dt>
          <dd className="cfs-mono">{formatCrmAmount(forecast.amount)}</dd>
        </div>
        <div className="cfs-field">
          <dt>Close date</dt>
          <dd className="cfs-mono">{formatCrmCloseDate(forecast.closeDate)}</dd>
        </div>
        <div className="cfs-field">
          <dt>Forecast category</dt>
          <dd>{forecast.forecastCategory ?? "—"}</dd>
        </div>
      </dl>

      <p className="cfs-synced">As of {formatSyncedAt(forecast.syncedAt)}</p>

      <ForecastNudge signal={engagementSignal} />

      {internalChatUrl ? <InternalChatReveal url={internalChatUrl} /> : null}
    </section>
  );
}

/**
 * internal_chat_url masked behind a native <details> reveal (T31-6) — same
 * disclosure idiom the plan builder already uses for "Add a step"
 * (add-step-form.tsx), so it needs no client component / JS state. Collapsed
 * by default: the URL is not in the rendered summary text, only inside the
 * <details> content, which stays out of a screen-share unless deliberately
 * opened.
 */
function InternalChatReveal({ url }: { url: string }) {
  return (
    <details className="cfs-internal-chat">
      <summary className="cfs-reveal-btn">Internal war room link — do not screen-share</summary>
      <a href={url} target="_blank" rel="noopener noreferrer" className="cfs-internal-chat-link">
        {url}
      </a>
    </details>
  );
}
