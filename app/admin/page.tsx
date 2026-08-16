import type { CSSProperties } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

// Sprint 8, Ticket 39 — a freshly self-served seller (app/register) lands
// here with zero workspaces; before this ticket the page just rendered an
// empty <ul> with no explanation. The list markup itself is unchanged.
const emptyStateStyle: CSSProperties = {
  color: "var(--slate)",
  fontSize: "0.9rem",
};

export default async function AdminHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS scopes this to the signed-in AE's tenant automatically — no explicit
  // tenant_id filter needed (or trusted) here.
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, target_company_name, target_domain")
    .order("target_company_name");
  const hasWorkspaces = (workspaces ?? []).length > 0;

  return (
    <main>
      <h1>Admin</h1>
      <p>Signed in as {user?.email}</p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>

      <h2>Workspaces</h2>
      {hasWorkspaces ? (
        <>
          <Link href="/admin/workspaces/new">Create Workspace</Link>
          <ul>
            {(workspaces ?? []).map((workspace) => (
              <li key={workspace.id}>
                <Link href={`/admin/workspaces/${workspace.id}`}>
                  {workspace.target_company_name} ({workspace.target_domain})
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div style={emptyStateStyle}>
          <p>You don&apos;t have any workspaces yet.</p>
          <Link href="/admin/workspaces/new">Create your first workspace</Link>
        </div>
      )}
    </main>
  );
}
