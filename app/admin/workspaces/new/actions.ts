"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidDomain, normalizeDomain } from "@/lib/domain";

export async function createWorkspace(formData: FormData) {
  const target_company_name = String(formData.get("target_company_name") ?? "").trim();
  const target_domain = normalizeDomain(String(formData.get("target_domain") ?? ""));

  if (!target_company_name) {
    redirect(`/admin/workspaces/new?error=${encodeURIComponent("Company name is required.")}`);
  }
  if (!isValidDomain(target_domain)) {
    redirect(`/admin/workspaces/new?error=${encodeURIComponent("Enter a valid domain, e.g. acme.com.")}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  // Derived from the session, never trusted from the client — the RLS
  // `with check` on workspaces also enforces this at the database level.
  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  if (!tenantId) {
    redirect(
      `/admin/workspaces/new?error=${encodeURIComponent(
        "Your account has no tenant assigned yet — contact an admin.",
      )}`,
    );
  }

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .insert({
      target_company_name,
      target_domain,
      created_by: user.id,
      tenant_id: tenantId,
    })
    .select("id")
    .single();

  if (error || !workspace) {
    redirect(`/admin/workspaces/new?error=${encodeURIComponent(error?.message ?? "Could not create workspace.")}`);
  }

  redirect(`/admin/workspaces/${workspace.id}`);
}
