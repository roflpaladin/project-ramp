import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { groupByCategoryAndType, RESOURCE_TYPE_OPTIONS } from "@/lib/links";
import { countActiveDealsForTenant } from "@/lib/plans/active-deal-count";
import { getTenantEntitlement } from "@/lib/billing/tenant-entitlement";
import { isClosedPlanStatus } from "@/lib/plans/closed-plans";
import { getClosedPlanForSeller, getPlanForSeller, type PlanReadClient } from "@/lib/plans/queries";
import type { PlanStepRow, PlanTree } from "@/lib/plans/types";
import { computeEngagementSignal, type EngagementEventInput } from "@/lib/plans/engagement";
import { getStallThresholdDays } from "@/lib/plans/stall-threshold";
import { computeActivationState } from "@/lib/plans/activation";
import { hasSentInviteForWorkspace } from "@/lib/plans/invite-status";
import { getCrmForecastForWorkspace } from "@/lib/crm/forecast";
import { requireSeller } from "@/lib/plans/require-seller";
import { buildDealLimitState, UNKNOWN_DEAL_LIMIT_STATE, type DealLimitState } from "./deal-limit-state";
import { planStatusMeta } from "./plan/status-badge";
import { resolveWorkspaceSignalOwners } from "./workspace-signal-budget";
import { addLink } from "./links-actions";
import { LinkUrlField } from "./link-url-field";
import { LinkRow } from "./link-row";
import { CrmForecastStrip } from "./crm-forecast-strip";
import { ChatPresence } from "./chat-presence";
import { ChatUrlForm } from "./chat-url-form";
import { StallAlert } from "./stall-alert";
import { InvitePanel } from "./invite-panel";
import { ActivationChecklist } from "./activation-checklist";
import "./workspace-links.css";

/** Flattens the plan tree's stages into a single ordered step list — the
 * shape computeEngagementSignal needs. A workspace without a live plan yet
 * (plan === null) contributes zero steps, which is an ordinary state for
 * engagement.ts (see its "waiting" branch), not an error. */
function flattenSteps(plan: PlanTree | null): PlanStepRow[] {
  if (!plan) return [];
  return plan.stages.flatMap((stage) => stage.steps);
}

const LOG_PREFIX = "[workspace-page]";

/**
 * Sprint 12, Ticket 60 — where does this tenant stand on active deals?
 *
 * The two reads are caught SEPARATELY and on purpose: a billing outage must
 * not also blind the count, and a failed count must not be mistaken for a
 * billing problem. Whatever survives goes to the pure builder
 * (deal-limit-state.ts), which decides what can honestly be said. Neither
 * failure 500s this page, and neither one is ever silent.
 *
 * An account with no tenant claim (provisioning never finished) reads as
 * unknown rather than free: the go-live gate is the authority, and it will
 * answer properly when the seller presses the button.
 */
async function readDealLimit(tenantId: string | null): Promise<DealLimitState> {
  if (!tenantId) return UNKNOWN_DEAL_LIMIT_STATE;

  const [entitlement, activeCount] = await Promise.all([
    getTenantEntitlement(tenantId).catch((error: unknown) => {
      console.error(`${LOG_PREFIX} could not read the billing state for tenant ${tenantId}`, error);
      return null;
    }),
    countActiveDealsForTenant(tenantId).catch((error: unknown) => {
      console.error(`${LOG_PREFIX} could not count active deals for tenant ${tenantId}`, error);
      return null;
    }),
  ]);

  return buildDealLimitState(entitlement, activeCount);
}

/**
 * T60. getPlanForSeller matches draft+active only, so a workspace whose deal
 * has been CLOSED would otherwise render here as if it had no plan at all.
 * The fallback runs only when the first read came back empty (its own
 * contract), and a failure in it degrades to "no plan" rather than taking
 * the whole dashboard down.
 */
async function loadClosedPlanOrNull(workspaceId: string, client: PlanReadClient): Promise<PlanTree | null> {
  try {
    return await getClosedPlanForSeller(workspaceId, client);
  } catch (error) {
    console.error(`${LOG_PREFIX} closed-plan lookup failed for workspace ${workspaceId}`, error);
    return null;
  }
}

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Sprint 11, Ticket 58 — activation_checklist_dismissed_at (migration 0012)
  // is named explicitly rather than relying on `select('*')`, matching this
  // query's existing style. DEPENDS ON that migration having been applied to
  // whichever Supabase project this page's env points at — if it hasn't yet,
  // this select errors and the page 404s (the `if (!workspace) notFound()`
  // guard below can't tell "no such workspace" apart from "unknown column").
  // Written this way anyway rather than defensively catching that case: a
  // loud, page-wide 404 surfaces a missing migration immediately, instead of
  // a checklist that silently never shows and looks like a feature that was
  // never built.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select(
      "id, target_company_name, target_domain, chat_url, internal_chat_url, activation_checklist_dismissed_at",
    )
    .eq("id", id)
    .single();

  if (!workspace) {
    notFound();
  }

  const { data: links } = await supabase
    .from("links")
    .select("id, category_header, link_label, url_string, display_order, visibility, resource_type")
    .eq("workspace_id", id)
    .order("category_header", { ascending: true })
    .order("display_order", { ascending: true });

  const grouped = groupByCategoryAndType(links ?? []);
  const addLinkForWorkspace = addLink.bind(null, id);

  // Ticket 31 — seller-private CRM/forecast strip. Three RLS-scoped reads
  // through the same seller `supabase` client already created above:
  //   1. the cached crm_* fields (lib/crm/forecast.ts, T31-2 — not modified here)
  //   2. the plan tree, for step owner_side/status (lib/plans/queries.ts, Ticket 28)
  //   3. workspace_analytics events, for real buyer engagement (T31-1's input)
  const [crmForecast, livePlan, { data: analyticsRows }, seller, hasSentInvite] = await Promise.all([
    getCrmForecastForWorkspace(id, supabase),
    getPlanForSeller(id, supabase),
    supabase
      .from("workspace_analytics")
      .select("action_type, created_at")
      .eq("workspace_id", id)
      .order("created_at", { ascending: false }),
    // T43: the seller's own inbox for InvitePanel's "use my email"
    // affordance below — requireSeller() re-derives its own client/session
    // rather than reusing the `supabase` client already in scope (T28-9's
    // contract: no caller passes in an unverified client).
    requireSeller(),
    // T58: no client argument on purpose — hasSentInviteForWorkspace reads
    // portal_access_tokens with its own service-role client (that table
    // ships zero RLS policies, so the seller-scoped `supabase` client above
    // would always see zero rows). Safe here specifically because `id` was
    // already resolved through the RLS-scoped `workspace` read above — this
    // function's own contract requires that ordering.
    hasSentInviteForWorkspace(id),
  ]);

  // T60: a closed deal keeps its plan. `live ?? closed` is what stops this
  // page telling the seller nothing ever happened here.
  const plan = livePlan ?? (await loadClosedPlanOrNull(id, supabase));
  const closedPlanStatus = plan !== null && isClosedPlanStatus(plan.status) ? plan.status : null;

  // Not folded into the Promise.all above: both reads need the tenant claim
  // that requireSeller() resolves IN that same batch. Their own two reads do
  // run in parallel with each other (see readDealLimit).
  const dealLimit = await readDealLimit(seller?.tenantId ?? null);

  const engagementEvents: EngagementEventInput[] = (analyticsRows ?? []).map((row) => ({
    actionType: row.action_type,
    createdAt: row.created_at,
  }));

  const engagementSignal = computeEngagementSignal(
    engagementEvents,
    flattenSteps(plan),
    new Date(), // the clock is supplied at the call site; engagement.ts stays pure
    // T36-4: configurable, not hardcoded here — see lib/plans/stall-threshold.ts.
    getStallThresholdDays(),
  );

  // T58: the pure decision (lib/plans/activation.ts) fed by this page's own
  // reads — plan and hasSentInvite are already resolved above, nothing new
  // to fetch here.
  const activation = computeActivationState({ plan, hasSentInvite });

  const isChecklistDismissed = workspace.activation_checklist_dismissed_at !== null;

  // T60: this page's one-Signal-per-scope budget, resolved once, here — the
  // deal-limit wall and the stall alert can otherwise both claim it. See
  // workspace-signal-budget.ts for the full rule.
  const signalOwners = resolveWorkspaceSignalOwners({
    isChecklistDismissed,
    activation,
    dealLimit,
    engagementState: engagementSignal.state,
  });

  return (
    <main data-surface="workspace-links">
      {/* T32-3/T32-8: top-right chrome, coordinated with Ticket 30's rail —
          the CRM strip and Links section below are untouched, this only
          adds a header row above them. ChatPresence hides itself entirely
          when both urls are null (T32-4), so a workspace with no chat links
          set yet still shows the "Edit chat links" disclosure as the only
          way to set them the first time. */}
      <div className="wsl-page-header">
        <div>
          <h1>{workspace.target_company_name}</h1>
          <p>Domain: {workspace.target_domain}</p>
        </div>
        <div className="wsl-chat-chrome">
          <ChatPresence
            chatUrl={workspace.chat_url}
            internalChatUrl={workspace.internal_chat_url}
            audience="seller"
          />
          <details className="wsl-chat-edit">
            <summary className="wsl-btn">Edit chat links</summary>
            <ChatUrlForm
              workspaceId={id}
              chatUrl={workspace.chat_url}
              internalChatUrl={workspace.internal_chat_url}
            />
          </details>
        </div>
      </div>

      {/* T58: the onboarding activation checklist — owns its own auto-hide
          rule (dismissed OR complete), so it's always mounted here rather
          than gated by a page-level ternary; see activation-checklist.tsx's
          own header comment. Renders above the stall alert so a brand-new,
          not-yet-activated workspace leads with "what to do next" rather
          than an engagement read that has nothing to say yet. */}
      <ActivationChecklist
        workspaceId={id}
        plan={plan ? { id: plan.id, status: plan.status } : null}
        activation={activation}
        isDismissed={isChecklistDismissed}
        planHref={`/admin/workspaces/${id}/plan`}
        dealLimit={dealLimit}
        canUseSignal={signalOwners.canChecklistUseSignal}
      />

      {/* T36-5: always-visible stall alert — independent of whether the CRM
          strip below is even mounted (it hides entirely without CRM sync,
          T31-5). Renders nothing at all when the buyer is actively engaged. */}
      <StallAlert
        signal={engagementSignal}
        planHref={`/admin/workspaces/${id}/plan`}
        isSignalSuppressed={signalOwners.isStallSignalSuppressed}
      />

      {/* T43: seller-facing invite panel, its own card just under the chat
          section and above the links list — the seller's other real
          destination for sending a buyer into their own portal, complementing
          rather than competing with the stall alert's Signal above (that
          Signal only renders in the "stalled" state; this panel's Signal only
          renders once an invite has actually been sent, so the two are never
          both live in the same render — see invite-panel.tsx's own header
          comment for the full one-Signal audit within this card). */}
      <InvitePanel workspaceId={id} sellerEmail={seller?.email ?? null} />

      {/* T60: a closed deal is a state this page states, never one it hides
          by rendering an empty plan area. Dot + text label, in Slate — an
          outcome, not an alarm. */}
      <p className="wsl-plan-nav">
        {closedPlanStatus ? (
          <span className="wsl-plan-status" data-testid="workspace-plan-status">
            <span className="wsl-plan-status-dot" data-status-dot="" aria-hidden="true" />
            Deal closed — {planStatusMeta(closedPlanStatus).label.toLowerCase()}
          </span>
        ) : null}
        <Link href={`/admin/workspaces/${id}/plan`} className="wsl-btn">
          {closedPlanStatus ? "Open closed plan" : "Go to plan builder"}
        </Link>
      </p>

      {/* T31-5: getCrmForecastForWorkspace returning null means "not visible
          to this caller" (RLS yielded zero rows) — hide the strip cleanly
          rather than rendering it with empty fields. The source === null
          case ("exists, never synced") is handled inside the component
          itself. */}
      {crmForecast ? (
        <CrmForecastStrip
          targetCompanyName={workspace.target_company_name}
          forecast={crmForecast}
          engagementSignal={engagementSignal}
          internalChatUrl={workspace.internal_chat_url}
        />
      ) : null}

      <h2>Links</h2>
      {[...grouped.entries()].map(([category, byType]) => {
        const typeEntries = [...byType.entries()];
        // Only show a resource_type sub-heading when a category actually
        // splits into more than one type (T30-5) — for every workspace
        // seeded before this ticket, every link's resource_type is null, so
        // this renders identically to the old flat groupByCategory output.
        const showTypeHeadings = typeEntries.length > 1;

        return (
          <section key={category}>
            <h3>{category}</h3>
            {typeEntries.map(([typeLabel, typeLinks]) => (
              <div key={typeLabel}>
                {showTypeHeadings ? <h4 className="wsl-type-heading">{typeLabel}</h4> : null}
                <ul className="wsl-link-list">
                  {typeLinks.map((link) => (
                    <LinkRow key={link.id} workspaceId={id} link={link} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}

      <h3>Add a link</h3>
      <form action={addLinkForWorkspace}>
        <label className="wsl-field">
          Category
          <input className="wsl-input" type="text" name="category_header" placeholder="Legal Docs" required />
        </label>
        <LinkUrlField />
        <label className="wsl-field">
          Resource type
          <input
            className="wsl-input"
            type="text"
            name="resource_type"
            placeholder="Doc, Deck, Video…"
            list="wsl-resource-type-suggestions"
          />
        </label>
        <datalist id="wsl-resource-type-suggestions">
          {RESOURCE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.label} />
          ))}
        </datalist>
        <label className="wsl-field">
          Visibility
          <select className="wsl-select" name="visibility" defaultValue="shared">
            <option value="shared">Shared with buyer</option>
            <option value="private">Private to you</option>
          </select>
        </label>
        <button type="submit" className="wsl-btn">
          Add link
        </button>
      </form>
    </main>
  );
}
