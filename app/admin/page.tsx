import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

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

  return (
    <main>
      <h1>Admin</h1>
      <p>Signed in as {user?.email}</p>
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>

      <h2>Workspaces</h2>
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
    </main>
  );
}
