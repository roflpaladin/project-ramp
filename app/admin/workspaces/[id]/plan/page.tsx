import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isClosedPlanStatus } from "@/lib/plans/closed-plans";
import { getClosedPlanForSeller, getPlanForSeller, type PlanReadClient } from "@/lib/plans/queries";
import type { PlanTree } from "@/lib/plans/types";
import { CreatePlanForm } from "./create-plan-form";
import { PlanBuilder } from "./plan-builder";

const LOG_PREFIX = "[plan-page]";

/**
 * Sprint 12, Ticket 60. getPlanForSeller matches draft+active only, so a
 * workspace whose only plan is CLOSED used to fall through to "start a
 * success plan" — as if the deal had never happened. The fallback read runs
 * ONLY when the first one came back empty (its own contract), so an ordinary
 * open plan still costs exactly one query.
 *
 * A failure in the fallback degrades to the create-plan empty state rather
 * than breaking a page that would otherwise work — logged loudly, never
 * swallowed.
 */
async function loadPlanForWorkspace(workspaceId: string, client: PlanReadClient): Promise<PlanTree | null> {
  const live = await getPlanForSeller(workspaceId, client);
  if (live) return live;

  try {
    return await getClosedPlanForSeller(workspaceId, client);
  } catch (error) {
    console.error(`${LOG_PREFIX} closed-plan lookup failed for workspace ${workspaceId}`, error);
    return null;
  }
}

export default async function PlanBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, target_company_name")
    .eq("id", id)
    .single();

  if (!workspace) {
    notFound();
  }

  const plan = await loadPlanForWorkspace(id, supabase);
  const isReadOnly = plan !== null && isClosedPlanStatus(plan.status);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <p className="m-0 text-sm">
        <Link href={`/admin/workspaces/${id}`} style={{ color: "var(--slate)" }}>
          ← Back to {workspace.target_company_name}
        </Link>
      </p>

      {/* One line, stated plainly, with the way forward directly below the
          plan it describes — no banner, no alarm (design system §10). */}
      {isReadOnly ? (
        <p className="plan-closed-note" data-testid="closed-plan-note" role="status">
          This deal is closed. Its plan is read-only.
        </p>
      ) : null}

      {plan ? (
        <PlanBuilder workspaceId={id} plan={plan} initialStages={plan.stages} isReadOnly={isReadOnly} />
      ) : (
        <CreatePlanForm workspaceId={id} companyName={workspace.target_company_name} />
      )}

      {/* The way out of a closed deal: the same create-plan path a workspace
          with no plan gets, demoted to a section heading so the closed plan
          above keeps the page's one h1. Plain, never Signal — the plan
          builder's Signal budget belongs to the live step. */}
      {isReadOnly ? (
        <CreatePlanForm workspaceId={id} companyName={workspace.target_company_name} headingLevel={2} />
      ) : null}
    </main>
  );
}
