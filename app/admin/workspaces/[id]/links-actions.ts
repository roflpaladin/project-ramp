"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSeller } from "@/lib/plans/require-seller";
import type { LinkVisibility } from "@/lib/links";

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);
const LINK_VISIBILITIES: readonly LinkVisibility[] = ["shared", "private"];

// Untrusted external input (a submitted form field), narrowed at the
// boundary. Falls closed to "shared" — the same value the 0005 column
// default backfills — rather than throwing, so a missing/tampered field
// never silently produces an invalid DB write (the visibility CHECK
// constraint would reject anything else anyway).
function parseVisibility(value: FormDataEntryValue | null): LinkVisibility {
  return value === "private" ? "private" : "shared";
}

// Protocol allowlist (Sprint 6, Ticket 30, fix B3). A bare `new URL(value)`
// only checks that the string parses -- it happily accepts `javascript:`,
// `data:`, and `vbscript:` URLs, which are then stored and rendered as a
// raw href on the admin page, i.e. stored XSS. Only http/https resolve to
// safe, navigable destinations.
function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ALLOWED_URL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export async function addLink(workspaceId: string, formData: FormData) {
  const seller = await requireSeller();
  if (!seller) {
    redirect("/admin/login");
  }

  const category_header = String(formData.get("category_header") ?? "").trim();
  const link_label = String(formData.get("link_label") ?? "").trim();
  const url_string = String(formData.get("url_string") ?? "").trim();
  const visibility = parseVisibility(formData.get("visibility"));
  const resource_type_raw = String(formData.get("resource_type") ?? "").trim();
  const resource_type = resource_type_raw || null;

  if (!category_header || !link_label || !isValidUrl(url_string)) {
    // Re-render with the existing data; inline errors can be added once this
    // needs to surface *why* a submission was rejected to the AE.
    revalidatePath(`/admin/workspaces/${workspaceId}`);
    return;
  }

  const supabase = seller.client;

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
    // Written explicitly, never left to the column default (0005). The default
    // exists to backfill pre-Sprint-5 rows truthfully — relying on it here would
    // make every new link buyer-visible by omission rather than by decision.
    // The seller's choice comes from the add-link form's Shared/Private field
    // (T30-3), narrowed by parseVisibility above; it falls back to "shared"
    // only when the field is missing entirely, matching the backfill default.
    visibility,
    resource_type,
  });

  revalidatePath(`/admin/workspaces/${workspaceId}`);
}

export async function deleteLink(workspaceId: string, linkId: string) {
  const seller = await requireSeller();
  if (!seller) {
    redirect("/admin/login");
  }

  // No explicit tenant/workspace check needed here beyond RLS: the
  // "AE manages own tenant links" policy already blocks deleting a row
  // whose workspace isn't in the caller's tenant.
  await seller.client.from("links").delete().eq("id", linkId);
  revalidatePath(`/admin/workspaces/${workspaceId}`);
}

// T30-3. The per-row Shared/Private control's server action. `visibility` is
// always a BOUND argument (mirrors addLink/deleteLink's workspaceId
// pattern), never read from FormData — the two option buttons in
// LinkVisibilityControl each bind their own explicit target value, so there
// is no free-text field for a tampered request to abuse.
export async function setLinkVisibility(
  workspaceId: string,
  linkId: string,
  visibility: LinkVisibility,
) {
  const seller = await requireSeller();
  if (!seller) {
    redirect("/admin/login");
  }

  // Defence in depth: a Server Action is a real POST endpoint reachable
  // outside this page's UI (not just this component's two buttons), so the
  // DB's visibility CHECK constraint is not the only guard against an
  // invalid value reaching the query.
  if (!LINK_VISIBILITIES.includes(visibility)) {
    return;
  }

  // Immutable update: a fresh { visibility } object, not a mutation of the
  // existing row. No explicit tenant/workspace check beyond RLS, same as
  // deleteLink above.
  await seller.client.from("links").update({ visibility }).eq("id", linkId);
  revalidatePath(`/admin/workspaces/${workspaceId}`);
}
