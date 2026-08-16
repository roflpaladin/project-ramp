import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { groupByCategoryAndType, RESOURCE_TYPE_OPTIONS } from "@/lib/links";
import { getPlanForSeller } from "@/lib/plans/queries";
import type { PlanStepRow } from "@/lib/plans/types";
import { computeEngagementSignal, type EngagementEventInput } from "@/lib/plans/engagement";
import { getStallThresholdDays } from "@/lib/plans/stall-threshold";
import { getCrmForecastForWorkspace } from "@/lib/crm/forecast";
import { requireSeller } from "@/lib/plans/require-seller";
import { addLink } from "./links-actions";
import { LinkUrlField } from "./link-url-field";
import { LinkRow } from "./link-row";
import { CrmForecastStrip } from "./crm-forecast-strip";
import { ChatPresence } from "./chat-presence";
import { ChatUrlForm } from "./chat-url-form";
import { StallAlert } from "./stall-alert";
import { InvitePanel } from "./invite-panel";
import "./workspace-links.css";

/** Flattens the plan tree's stages into a single ordered step list — the
 * shape computeEngagementSignal needs. A workspace without a live plan yet
 * (plan === null) contributes zero steps, which is an ordinary state for
 * engagement.ts (see its "waiting" branch), not an error. */
function flattenSteps(plan: Awaited<ReturnType<typeof getPlanForSeller>>): PlanStepRow[] {
  if (!plan) return [];
  return plan.stages.flatMap((stage) => stage.steps);
}

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, target_company_name, target_domain, chat_url, internal_chat_url")
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
  const [crmForecast, plan, { data: analyticsRows }, seller] = await Promise.all([
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
  ]);

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

      {/* T36-5: always-visible stall alert — independent of whether the CRM
          strip below is even mounted (it hides entirely without CRM sync,
          T31-5). Renders nothing at all when the buyer is actively engaged. */}
      <StallAlert signal={engagementSignal} planHref={`/admin/workspaces/${id}/plan`} />

      {/* T43: seller-facing invite panel, its own card just under the chat
          section and above the links list — the seller's other real
          destination for sending a buyer into their own portal, complementing
          rather than competing with the stall alert's Signal above (that
          Signal only renders in the "stalled" state; this panel's Signal only
          renders once an invite has actually been sent, so the two are never
          both live in the same render — see invite-panel.tsx's own header
          comment for the full one-Signal audit within this card). */}
      <InvitePanel workspaceId={id} sellerEmail={seller?.email ?? null} />

      <p className="wsl-plan-nav">
        <Link href={`/admin/workspaces/${id}/plan`} className="wsl-btn">
          Go to plan builder
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
