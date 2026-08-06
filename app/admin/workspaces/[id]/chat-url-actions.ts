"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireSeller } from "@/lib/plans/require-seller";
import { assertHttpsUrl } from "@/lib/ssrf-guard";

// T32-2 (Sprint 6, Ticket 32; plans/sprint-6-7-replan.md §6). Seller-facing
// write path for workspaces.chat_url (buyer-visible, PRD §2.4) and
// workspaces.internal_chat_url (seller-private war room, T31-6). Neither
// column had a write action before this ticket -- both were read-only
// (app/admin/workspaces/[id]/page.tsx, lib/portal-payload.ts). The FE
// presence button (T32-3/T32-4) is a later step; this action exists so that
// step has somewhere validated to write to.
//
// Follows links-actions.ts's convention in this same directory:
// workspaceId is a bound argument (never read from FormData), requireSeller()
// is the first call, and auth failure redirects rather than returning a
// PlanActionResult union -- this action has no FE consumer yet, so there's
// nothing forcing plan-actions.ts's result-union shape here.

// A blank field clears the link, matching links-actions.ts's field-parsing
// shape: empty string in, `null` out.
function parseChatUrlField(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export async function setChatUrls(workspaceId: string, formData: FormData) {
  const seller = await requireSeller();
  if (!seller) {
    redirect("/admin/login");
  }

  const chatUrl = parseChatUrlField(formData.get("chat_url"));
  const internalChatUrl = parseChatUrlField(formData.get("internal_chat_url"));

  // Channel-agnostic: https: only, no vendor/provider pattern-matching (no
  // "must be slack.com" etc.) -- either field may be cleared to null, but a
  // non-empty value must be a valid https: URL.
  //
  // T32-7: the founder has accepted the https-only allowlist for the pilot
  // (plans/sprint-6-7-replan.md §6, T32-7) -- no interstitial warning, no
  // provider allowlist. chat_url is a seller-controlled URL rendered inside
  // a page the buyer has been primed to trust; https-only does not stop a
  // legitimate-looking https phishing domain. That residual risk is
  // knowingly accepted for the pilot, not an oversight.
  try {
    if (chatUrl !== null) assertHttpsUrl(chatUrl);
    if (internalChatUrl !== null) assertHttpsUrl(internalChatUrl);
  } catch {
    // Mirrors addLink's reject shape in links-actions.ts: re-render with the
    // existing data rather than throwing across the Server Action boundary.
    // Inline errors can be added once this needs to surface *why* a
    // submission was rejected to the AE.
    revalidatePath(`/admin/workspaces/${workspaceId}`);
    return;
  }

  // Immutable update: a fresh { chat_url, internal_chat_url } object, not a
  // mutation of the existing row. No explicit tenant/workspace check beyond
  // RLS -- the "AE manages own tenant workspaces" policy (0001) already
  // blocks updating a row whose workspace isn't in the caller's tenant, same
  // as setLinkVisibility's reliance on the sibling links policy.
  await seller.client
    .from("workspaces")
    .update({ chat_url: chatUrl, internal_chat_url: internalChatUrl })
    .eq("id", workspaceId);

  revalidatePath(`/admin/workspaces/${workspaceId}`);
}
