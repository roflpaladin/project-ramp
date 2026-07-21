import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPortalHeaderTitle, getFaviconUrl } from "@/lib/branding";
import { groupByCategory } from "@/lib/links";
import { DEMO_TENANT_ID } from "@/lib/demo";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";
import { FaviconImage } from "@/app/portal/[id]/favicon-image";
import { enterView } from "./gate-actions";

type DemoWorkspace = { id: string; target_company_name: string; target_domain: string };

// Fetch + demo-scope guard. /view is ONLY for the seeded demo tenant: a real
// workspace must never be reachable through the any-@ gate (that would bypass
// the production Security Gate), so anything that isn't a demo-tenant workspace
// 404s. Returns just the fields the public viewport needs — no tenant_id or
// other backend props cross into the rendered page (RSC hardening, Ticket 21).
async function getDemoWorkspace(id: string): Promise<DemoWorkspace | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("workspaces")
    .select("id, tenant_id, target_company_name, target_domain")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.tenant_id !== DEMO_TENANT_ID) return null;
  return { id: data.id, target_company_name: data.target_company_name, target_domain: data.target_domain };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const workspace = await getDemoWorkspace(id);
  if (!workspace) {
    return { robots: { index: false, follow: false } };
  }
  return {
    title: buildPortalHeaderTitle(workspace.target_company_name),
    icons: { icon: getFaviconUrl(workspace.target_domain) },
    robots: { index: false, follow: false },
  };
}

async function GrantedView({ workspace }: { workspace: DemoWorkspace }) {
  const supabase = createAdminClient();
  const { data: links } = await supabase
    .from("links")
    .select("id, category_header, link_label, url_string, display_order")
    .eq("workspace_id", workspace.id)
    .order("category_header", { ascending: true })
    .order("display_order", { ascending: true });

  const grouped = groupByCategory(links ?? []);
  // Fallback branding is inherent: target_company_name is the CRM name, the
  // scraped title, or the bare domain (provisioner), and getFaviconUrl always
  // resolves to at least a default icon — so a metadata-less domain still
  // renders a coherent header instead of crashing.
  const headerTitle = buildPortalHeaderTitle(workspace.target_company_name);

  return (
    <main>
      <header
        className="mb-8 flex items-center gap-3 rounded-2xl border p-5"
        style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--paper) 90%, var(--buyer-tint))" }}
      >
        <FaviconImage src={getFaviconUrl(workspace.target_domain)} alt="" />
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--buyer-mark)" }}>
            Your deal room
          </p>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{headerTitle}</h1>
        </div>
      </header>

      {grouped.size === 0 ? (
        <p style={{ color: "var(--slate)" }}>No resources have been shared yet.</p>
      ) : (
        [...grouped.entries()].map(([category, categoryLinks]) => (
          <section key={category} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--slate)" }}>
              {category}
            </h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {categoryLinks.map((link) => (
                <li key={link.id}>
                  <a
                    // Routes through the real /api/track redirector so the click
                    // is logged (link_click) for the live pulse (Ticket 20).
                    href={`/api/track?linkId=${link.id}&wsId=${workspace.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-lg border px-4 py-3 no-underline transition-colors"
                    style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                  >
                    <span>{link.link_label}</span>
                    <span aria-hidden style={{ color: "var(--buyer-mark)" }}>
                      ↗
                    </span>
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

export default async function ViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const workspace = await getDemoWorkspace(id);
  if (!workspace) {
    notFound();
  }

  const cookieStore = await cookies();
  const session = verifyPortalSessionValue(id, cookieStore.get(portalCookieName(id))?.value);
  if (session) {
    return <GrantedView workspace={workspace} />;
  }

  const enterViewForWorkspace = enterView.bind(null, id);

  return (
    <main>
      <section
        className="rounded-2xl border p-6 shadow-sm sm:p-8"
        style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--paper) 90%, var(--buyer-tint))" }}
      >
        <div className="mb-5 flex items-center gap-3">
          <FaviconImage src={getFaviconUrl(workspace.target_domain)} alt="" />
          <div>
            <p className="m-0 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--buyer-mark)" }}>
              {workspace.target_company_name}
            </p>
            <h1 className="m-0 text-xl font-semibold tracking-tight">Enter your deal room</h1>
          </div>
        </div>
        <p className="m-0 mb-5 text-sm" style={{ color: "var(--slate)" }}>
          Enter your email to open your curated success plan.
        </p>

        <form action={enterViewForWorkspace} className="m-0 flex max-w-none flex-col gap-3">
          <label className="flex flex-col gap-2 text-sm font-medium">
            Your email
            <input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              className="rounded-lg border bg-transparent px-3 py-2.5 text-base outline-none focus:ring-2"
              style={{ borderColor: "var(--line)" }}
            />
          </label>
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border-0 px-4 py-3 text-[0.95rem] font-semibold text-white transition-[filter] hover:brightness-110 sm:w-auto"
            style={{ background: "var(--signal)" }}
          >
            Enter deal room →
          </button>
        </form>

        {error ? (
          <p
            role="alert"
            className="m-0 mt-4 rounded-lg px-3 py-2.5 text-sm"
            style={{ background: "color-mix(in srgb, #d9503e 12%, transparent)", color: "#d9503e" }}
          >
            {error}
          </p>
        ) : null}

        {/* Demo affordance — reminds the presenter this gate is intentionally open. */}
        <p className="m-0 mt-4 text-xs" style={{ color: "var(--slate)" }}>
          Demo mode: any email works — no verification code required.
        </p>
      </section>
    </main>
  );
}
