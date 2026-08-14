import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPortalHeaderTitle, getFaviconUrl } from "@/lib/branding";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";
import { loadBuyerPayload } from "@/lib/portal/load-buyer-payload";
import { BuyerWorkspaceView } from "@/components/buyer/buyer-workspace-view";
import { requestAccess, verifyAccess } from "./gate-actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  // Metadata renders for EVERY visitor, including one who has not passed the
  // access gate — generateMetadata runs before, and independently of, the
  // session check in the page component below. Emitting the customer's name
  // and domain here told anyone holding a workspace id two things they had not
  // earned: that the deal room is real (a nonexistent id yields no title, a
  // real one does — an enumeration oracle), and WHO it belongs to. The buyer
  // boundary is not only about plan fields; a company name in a <title> is the
  // seller's customer list leaking one id at a time.
  //
  // Return exactly what the not-found branch returns, so the two are
  // indistinguishable without a session. Found by Ticket 26's suite.
  const cookieStore = await cookies();
  const session = verifyPortalSessionValue(id, cookieStore.get(portalCookieName(id))?.value);
  if (!session) {
    return {};
  }

  const supabase = createAdminClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("target_company_name, target_domain")
    .eq("id", id)
    .single();

  if (!workspace) {
    return {};
  }

  return {
    title: buildPortalHeaderTitle(workspace.target_company_name),
    icons: { icon: getFaviconUrl(workspace.target_domain) },
  };
}

// T34-2 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7). Post-gate
// rendering now goes through the ONE shared loader (lib/portal/load-buyer-
// payload.ts) and the ONE shared renderer (components/buyer/buyer-workspace-
// view.tsx) — this file no longer builds a payload or a header by hand.
//
// T34-4 (plans/sprint-6-7-replan.md §3, §7): portal_view is no longer
// written here. An RSC render can re-run (React re-renders a server
// component more than once for the same navigation in some cases), which
// made a render-time insert an occasional duplicate — inconsistent with
// /view's gate-action write, which fires exactly once per entry. The write
// lives in verifyAccess (./gate-actions.ts), matching /view's enterView, so
// both surfaces log the same event at the same lifecycle point. Ticket 36's
// stall arithmetic depends on that consistency.
async function GrantedPortal({ workspaceId }: { workspaceId: string }) {
  const payload = await loadBuyerPayload(workspaceId);
  // A verified session proves the workspace existed when the session was
  // issued, not that it still does — null here (workspace deleted since, or
  // never existed) is the same 404-equivalent every other buyer-boundary
  // caller treats it as (lib/portal/load-buyer-payload.ts's header comment).
  if (!payload) {
    notFound();
  }
  return <BuyerWorkspaceView payload={payload} />;
}

export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string; email?: string; error?: string }>;
}) {
  const { id } = await params;
  const { stage, email, error } = await searchParams;

  const cookieStore = await cookies();
  const session = verifyPortalSessionValue(id, cookieStore.get(portalCookieName(id))?.value);

  if (session) {
    return <GrantedPortal workspaceId={id} />;
  }

  const requestAccessForWorkspace = requestAccess.bind(null, id);
  const verifyAccessForWorkspace = verifyAccess.bind(null, id);

  if (stage === "verify") {
    return (
      <main>
        <h1>Enter your code</h1>
        <p>We sent a 4-digit code to {email}.</p>
        <form action={verifyAccessForWorkspace}>
          <input type="hidden" name="email" value={email ?? ""} />
          <label>
            Code
            <input type="text" name="token" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required />
          </label>
          <button type="submit">Verify</button>
        </form>
        {error ? <p role="alert">{error}</p> : null}
      </main>
    );
  }

  return (
    <main>
      <h1>Deal Room Access</h1>
      <form action={requestAccessForWorkspace}>
        <label>
          Your email
          <input type="email" name="email" required />
        </label>
        <button type="submit">Send me a code</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
