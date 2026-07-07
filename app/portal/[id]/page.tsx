import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { groupByCategory } from "@/lib/links";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";
import { requestAccess, verifyAccess } from "./gate-actions";

async function GrantedPortal({ workspaceId }: { workspaceId: string }) {
  const supabase = createAdminClient();

  const [{ data: workspace }, { data: links }] = await Promise.all([
    supabase.from("workspaces").select("target_company_name").eq("id", workspaceId).single(),
    supabase
      .from("links")
      .select("id, category_header, link_label, url_string, display_order")
      .eq("workspace_id", workspaceId)
      .order("category_header", { ascending: true })
      .order("display_order", { ascending: true }),
  ]);

  const grouped = groupByCategory(links ?? []);

  return (
    <main>
      {/* Header title/favicon personalization is the Instant Branding Engine ticket. */}
      <h1>{workspace?.target_company_name ?? "Deal Room"}</h1>
      {grouped.size === 0 ? (
        <p>No resources have been shared yet.</p>
      ) : (
        [...grouped.entries()].map(([category, categoryLinks]) => (
          <section key={category}>
            <h2>{category}</h2>
            <ul>
              {categoryLinks.map((link) => (
                <li key={link.id}>
                  <a href={link.url_string} target="_blank" rel="noopener noreferrer">
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
  const hasAccess = verifyPortalSessionValue(id, cookieStore.get(portalCookieName(id))?.value);

  if (hasAccess) {
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
