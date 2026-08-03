import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPlanForSeller } from "@/lib/plans/queries";
import { CreatePlanForm } from "./create-plan-form";
import { PlanBuilder } from "./plan-builder";

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

  const plan = await getPlanForSeller(id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <p className="m-0 text-sm">
        <Link href={`/admin/workspaces/${id}`} style={{ color: "var(--slate)" }}>
          ← Back to {workspace.target_company_name}
        </Link>
      </p>

      {plan ? (
        <PlanBuilder workspaceId={id} plan={plan} initialStages={plan.stages} />
      ) : (
        <CreatePlanForm workspaceId={id} companyName={workspace.target_company_name} />
      )}
    </main>
  );
}
