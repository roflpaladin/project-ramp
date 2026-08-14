import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { buildPortalHeaderTitle, getFaviconUrl } from "@/lib/branding";
import { DEMO_TENANT_ID } from "@/lib/demo";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";
import { loadBuyerPayload } from "@/lib/portal/load-buyer-payload";
import { BuyerWorkspaceView } from "@/components/buyer/buyer-workspace-view";
import { FaviconImage } from "@/app/portal/[id]/favicon-image";
import { enterView } from "./gate-actions";

// T34-2 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7). Post-gate
// rendering now goes through the ONE shared loader (lib/portal/load-buyer-
// payload.ts) and the ONE shared renderer (components/buyer/buyer-workspace-
// view.tsx) — this file no longer builds a payload or a header by hand. What
// stays here, and ONLY here, is what genuinely differs from /portal/[id]:
// the demo-tenant 404 guard (requireTenantId) and the any-@ demo gate below.
//
// requireTenantId: DEMO_TENANT_ID is /view's entire scoping mechanism — a
// real workspace outside the demo tenant is indistinguishable from one that
// doesn't exist (loadBuyerPayload returns null for both), so this route can
// never be used to walk into a real customer's deal room.
async function getViewPayload(id: string) {
  return loadBuyerPayload(id, { requireTenantId: DEMO_TENANT_ID });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;

  // Same pre-auth disclosure guard as /portal/[id]: the page body below
  // verifies a portal session, but generateMetadata runs independently of it
  // and was emitting the customer's name and favicon domain to anyone with a
  // workspace id. Narrower here — this route is hard-scoped to
  // DEMO_TENANT_ID, so only demo deal rooms were exposed — but it is the
  // same bug, and the demo tenant is precisely what gets shown to prospects.
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

  const payload = await getViewPayload(id);
  if (!payload) {
    return {};
  }
  return {
    title: buildPortalHeaderTitle(payload.workspace.target_company_name),
    icons: { icon: getFaviconUrl(payload.workspace.target_domain) },
  };
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

  const payload = await getViewPayload(id);
  if (!payload) {
    notFound();
  }
  const { workspace } = payload;

  const cookieStore = await cookies();
  const session = verifyPortalSessionValue(id, cookieStore.get(portalCookieName(id))?.value);
  if (session) {
    return <BuyerWorkspaceView payload={payload} />;
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
