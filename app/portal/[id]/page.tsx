import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPortalHeaderTitle, getFaviconUrl } from "@/lib/branding";
import { groupByCategory } from "@/lib/links";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";
import { FaviconImage } from "./favicon-image";
import { requestAccess, verifyAccess } from "./gate-actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
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

async function GrantedPortal({ workspaceId, buyerEmail }: { workspaceId: string; buyerEmail: string }) {
  const supabase = createAdminClient();

  const [{ data: workspace }, { data: links }] = await Promise.all([
    supabase.from("workspaces").select("target_company_name, target_domain").eq("id", workspaceId).single(),
    supabase
      .from("links")
      .select("id, category_header, link_label, url_string, display_order")
      .eq("workspace_id", workspaceId)
      .order("category_header", { ascending: true })
      .order("display_order", { ascending: true }),
  ]);

  // Best-effort engagement signal for the seller dashboard -- Supabase
  // resolves with { error } rather than throwing, and a failed insert here
  // shouldn't break the buyer's page render either way.
  const { error: viewError } = await supabase
    .from("workspace_analytics")
    .insert({ workspace_id: workspaceId, buyer_email: buyerEmail, action_type: "portal_view" });
  if (viewError) {
    console.error("[portal_view] analytics insert failed:", viewError);
  }

  const grouped = groupByCategory(links ?? []);
  const headerTitle = workspace ? buildPortalHeaderTitle(workspace.target_company_name) : "Deal Room";

  return (
    <main>
      <header style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        {workspace ? <FaviconImage src={getFaviconUrl(workspace.target_domain)} alt="" /> : null}
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
    return <GrantedPortal workspaceId={id} buyerEmail={session.email} />;
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
