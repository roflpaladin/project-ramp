import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPortalHeaderTitle, getFaviconUrl } from "@/lib/branding";
import { groupByCategory } from "@/lib/links";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";
import { toBuyerPayload, type LinkRow, type WorkspaceRow } from "@/lib/portal-payload";
import { FaviconImage } from "./favicon-image";
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

async function GrantedPortal({ workspaceId }: { workspaceId: string }) {
  const supabase = createAdminClient();

  // T34-4 (plans/sprint-6-7-replan.md §3, §7): portal_view is no longer
  // written here. An RSC render can re-run (React re-renders a server
  // component more than once for the same navigation in some cases), which
  // made this render-time insert an occasional duplicate — inconsistent with
  // /view's gate-action write, which fires exactly once per entry. The write
  // now lives in verifyAccess (./gate-actions.ts), matching /view's
  // enterView, so both surfaces log the same event at the same lifecycle
  // point. Ticket 36's stall arithmetic depends on that consistency.
  const [{ data: workspaceRow }, { data: links }] = await Promise.all([
    // select("*") then strip in one named place (Ticket 25) — see the note in
    // lib/portal-payload.ts on why a narrow SELECT is the weaker boundary.
    supabase.from("workspaces").select("*").eq("id", workspaceId).maybeSingle(),
    supabase
      .from("links")
      .select("*")
      .eq("workspace_id", workspaceId)
      // Defence in depth; toBuyerPayload filters again.
      .eq("visibility", "shared")
      .order("category_header", { ascending: true })
      .order("display_order", { ascending: true }),
  ]);

  // The buyer boundary (Ticket 25). Nothing below this line touches a raw row.
  const payload = workspaceRow
    ? toBuyerPayload(workspaceRow as WorkspaceRow, null, (links ?? []) as LinkRow[])
    : null;

  const grouped = groupByCategory(payload?.resources ?? []);
  const headerTitle = payload ? buildPortalHeaderTitle(payload.workspace.target_company_name) : "Deal Room";

  return (
    <main>
      <header style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {payload ? <FaviconImage src={getFaviconUrl(payload.workspace.target_domain)} alt="" /> : null}
        <h1>{headerTitle}</h1>
      </header>
      {grouped.size === 0 ? (
        <p>No resources have been shared yet.</p>
      ) : (
        [...grouped.entries()].map(([category, categoryLinks]) => (
          <section key={category}>
            <h2>{category}</h2>
            <ul>
              {categoryLinks.map((link) => (
                <li key={link.id}>
                  <a
                    href={`/api/track?linkId=${link.id}&wsId=${workspaceId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.link_label}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
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
