import type { CSSProperties } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

// Sprint 8, Ticket 39 introduced this empty state for a freshly self-served
// seller (app/register) landing here with zero workspaces. Ticket 41 swaps
// its call to action from the old bare "create a workspace" form
// (/admin/workspaces/new) to the guided onboarding flow — this is that
// state's one Signal (data-signal="true"), the only primary action /admin
// ever shows a zero-workspace seller. The non-empty branch below is
// untouched. No hardcoded colour: every value here is an existing
// app/globals.css token, consistent with how this page already styles
// itself (inline `style`, no scoped CSS file of its own).
const emptyStateStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  padding: "1.5rem",
  border: "1px solid var(--line)",
  borderRadius: "12px",
};

const emptyStateCopyStyle: CSSProperties = {
  margin: 0,
  color: "var(--slate)",
  fontSize: "0.9rem",
};

const emptyStateCtaStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "fit-content",
  height: "40px",
  padding: "0 16px",
  borderRadius: "10px",
  background: "var(--signal)",
  color: "var(--signal-fg)",
  fontWeight: 500,
  textDecoration: "none",
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
          <p style={emptyStateCopyStyle}>
            This is where your deals will live — set up your first one to get started.
          </p>
          <Link href="/admin/onboarding" style={emptyStateCtaStyle} data-signal="true">
            Set up your first deal
          </Link>
        </div>
      )}
    </main>
  );
}
