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

  if (!linkId || !wsId) {
    return new NextResponse("Missing linkId or wsId", { status: 400 });
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
  const { data: link } = await supabase
    .from("links")
    .select("id, url_string")
    .eq("id", linkId)
    .eq("workspace_id", wsId)
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
