"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function isValidUrl(value: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export async function addLink(workspaceId: string, formData: FormData) {
  const category_header = String(formData.get("category_header") ?? "").trim();
  const link_label = String(formData.get("link_label") ?? "").trim();
  const url_string = String(formData.get("url_string") ?? "").trim();

  if (!category_header || !link_label || !isValidUrl(url_string)) {
    // Re-render with the existing data; inline errors can be added once this
    // needs to surface *why* a submission was rejected to the AE.
    revalidatePath(`/admin/workspaces/${workspaceId}`);
    return;
  }

  const supabase = await createClient();

  // New links append to the end of their category's existing order.
  const { count } = await supabase
    .from("links")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("category_header", category_header);

  await supabase.from("links").insert({
    workspace_id: workspaceId,
    category_header,
    link_label,
    url_string,
    display_order: count ?? 0,
  });

  revalidatePath(`/admin/workspaces/${workspaceId}`);
}

export async function deleteLink(workspaceId: string, linkId: string) {
  const supabase = await createClient();
  // No explicit tenant/workspace check needed here beyond RLS: the
  // "AE manages own tenant links" policy already blocks deleting a row
  // whose workspace isn't in the caller's tenant.
  await supabase.from("links").delete().eq("id", linkId);
  revalidatePath(`/admin/workspaces/${workspaceId}`);
}
