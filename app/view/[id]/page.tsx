import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPortalHeaderTitle, getFaviconUrl } from "@/lib/branding";
import { groupByCategory } from "@/lib/links";
import { DEMO_TENANT_ID } from "@/lib/demo";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";
import { toBuyerPayload, type BuyerPayload, type LinkRow, type WorkspaceRow } from "@/lib/portal-payload";
import { FaviconImage } from "@/app/portal/[id]/favicon-image";
import { enterView } from "./gate-actions";

// Fetch + demo-scope guard, then the buyer boundary. /view is ONLY for the
// seeded demo tenant: a real workspace must never be reachable through the
// any-@ gate (that would bypass the production Security Gate), so anything that
// isn't a demo-tenant workspace 404s.
//
// Everything that reaches the rendered page goes through toBuyerPayload
// (Ticket 25). This used to hand-pick three fields inline, which was correct on
// the day it was written and is exactly the pattern that rots: the next person
// who needs one more field adds it here, where no test is looking.
//
// select("*") is deliberate. Fetching the full row and stripping in one named
// place beats a narrow SELECT that silently pre-filters — and Ticket 26's proof
// that a NEW private column stays out of the payload only means something if
// the column was actually fetched.
async function getBuyerPayload(id: string): Promise<BuyerPayload | null> {
  const supabase = createAdminClient();
  const { data: workspace } = await supabase.from("workspaces").select("*").eq("id", id).maybeSingle();
  if (!workspace || workspace.tenant_id !== DEMO_TENANT_ID) return null;

  const { data: links } = await supabase
    .from("links")
    .select("*")
    .eq("workspace_id", id)
    // Defence in depth — toBuyerPayload filters again. Free at the index level
    // via idx_links_workspace_shared. Without this, every private resource the
    // demo seed plants (Ticket 27) would be served straight to the buyer.
    .eq("visibility", "shared")
    .order("category_header", { ascending: true })
    .order("display_order", { ascending: true });

  // plan: null until Ticket 33 renders the plan tree. Fetching a plan nothing
  // displays would add a round trip to a latency-critical page for no buyer
  // benefit; the boundary's plan handling is proven at the unit level against
  // the Ticket 23 fixture, which does carry a full plan.
  return toBuyerPayload(workspace as WorkspaceRow, null, (links ?? []) as LinkRow[]);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;

  // Same pre-auth disclosure as /portal/[id]: the page body below verifies a
  // portal session, but generateMetadata runs independently of it and was
  // emitting the customer's name and favicon domain to anyone with a workspace
  // id. Narrower here — this route is hard-scoped to DEMO_TENANT_ID, so only
  // demo deal rooms were exposed — but it is the same bug, and the demo tenant
  // is precisely what gets shown to prospects.
  //
  // No `robots` key returned from any branch below (T34-3, fixes B5): noindex
  // now lives once in layout.tsx as the base for this whole subtree, so every
  // branch here — including one added later — inherits it instead of relying
  // on a literal someone has to remember to copy.
  const cookieStore = await cookies();
  const session = verifyPortalSessionValue(id, cookieStore.get(portalCookieName(id))?.value);
  if (!session) {
    return {};
  }

  const payload = await getBuyerPayload(id);
  if (!payload) {
    return {};
  }
  return {
    title: buildPortalHeaderTitle(payload.workspace.target_company_name),
    icons: { icon: getFaviconUrl(payload.workspace.target_domain) },
  };
}

function GrantedView({ payload }: { payload: BuyerPayload }) {
  const { workspace } = payload;
  const grouped = groupByCategory(payload.resources);
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

  const payload = await getBuyerPayload(id);
  if (!payload) {
    notFound();
  }
  const { workspace } = payload;

  const cookieStore = await cookies();
  const session = verifyPortalSessionValue(id, cookieStore.get(portalCookieName(id))?.value);
  if (session) {
    return <GrantedView payload={payload} />;
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
