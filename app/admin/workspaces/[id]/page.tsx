import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, target_company_name, target_domain")
    .eq("id", id)
    .single();

  if (!workspace) {
    notFound();
  }

  return (
    <main>
      <h1>{workspace.target_company_name}</h1>
      <p>Domain: {workspace.target_domain}</p>
      <p>Link management coming in the next ticket.</p>
    </main>
  );
}
