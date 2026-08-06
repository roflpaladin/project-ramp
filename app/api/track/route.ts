import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";

// Masked-link redirector (Sprint 2, Ticket 11). The buyer portal never
// exposes a raw destination URL in the DOM -- links point here instead.
// This verifies the buyer's session, logs a link_click event, and 302s to
// the real destination resolved server-side from link_id + workspace_id.
// Never trusts a destination passed in the query string (open-redirect
// guard), and never trusts a client-supplied buyer_email.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const linkId = url.searchParams.get("linkId");
  const wsId = url.searchParams.get("wsId");

  if (!wsId) {
    return new NextResponse("Missing wsId", { status: 400 });
  }

  // Portal-entry (magic-link) mode, added Sprint 4 Ticket 18/19: a link with
  // wsId but no linkId is the shareable deal-room link revealed by /demo-sandbox.
  // There is no click destination and no buyer session yet, so route the buyer
  // to the zero-friction gate at /view/[id] (which logs portal_view on entry and
  // enforces demo-tenant scoping). The existing link-click flow below is
  // unchanged — it still requires both linkId and wsId.
  if (!linkId) {
    return NextResponse.redirect(new URL(`/view/${wsId}`, request.url), 302);
  }

  const cookieStore = await cookies();
  const session = verifyPortalSessionValue(wsId, cookieStore.get(portalCookieName(wsId))?.value);
  if (!session) {
    return NextResponse.redirect(new URL(`/portal/${wsId}`, request.url), 302);
  }

  const supabase = createAdminClient();

  // Requiring workspace_id to match on the link row (not just linkId) is
  // what blocks cross-workspace link probing -- a linkId from a different
  // workspace simply won't be found here.
  //
  // The visibility filter (Sprint 6, Ticket 30, fix B2) closes a related
  // hole: without it, a buyer holding a private link's id could still
  // resolve the resource after the seller flips it private. A private hit
  // MUST fall through to the exact same "not found" branch below as a
  // nonexistent id -- never a distinct response (e.g. 404) for "private"
  // versus "nonexistent". Distinguishing the two would rebuild an
  // enumeration oracle: a caller could brute-force link ids and learn which
  // ones exist-but-are-private purely from the response shape.
  const { data: link } = await supabase
    .from("links")
    .select("id, url_string")
    .eq("id", linkId)
    .eq("workspace_id", wsId)
    .eq("visibility", "shared")
    .maybeSingle();

  if (!link) {
    return NextResponse.redirect(new URL(`/portal/${wsId}`, request.url), 302);
  }

  await supabase.from("workspace_analytics").insert({
    workspace_id: wsId,
    link_id: link.id,
    buyer_email: session.email,
    action_type: "link_click",
  });

  try {
    return NextResponse.redirect(new URL(link.url_string), 302);
  } catch {
    // Malformed url_string somehow got past the builder form -- bounce
    // back to the portal rather than redirecting to garbage.
    return NextResponse.redirect(new URL(`/portal/${wsId}`, request.url), 302);
  }
}
