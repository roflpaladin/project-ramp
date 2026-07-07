import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addLink, deleteLink } from "./links-actions";

type Link = {
  id: string;
  category_header: string;
  link_label: string;
  url_string: string;
  display_order: number;
};

function groupByCategory(links: Link[]): Map<string, Link[]> {
  const grouped = new Map<string, Link[]>();
  for (const link of links) {
    const bucket = grouped.get(link.category_header) ?? [];
    bucket.push(link);
    grouped.set(link.category_header, bucket);
  }
  return grouped;
}

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

  const { data: links } = await supabase
    .from("links")
    .select("id, category_header, link_label, url_string, display_order")
    .eq("workspace_id", id)
    .order("category_header", { ascending: true })
    .order("display_order", { ascending: true });

  const grouped = groupByCategory(links ?? []);
  const addLinkForWorkspace = addLink.bind(null, id);

  return (
    <main>
      <h1>{workspace.target_company_name}</h1>
      <p>Domain: {workspace.target_domain}</p>

      <h2>Links</h2>
      {[...grouped.entries()].map(([category, categoryLinks]) => (
        <section key={category}>
          <h3>{category}</h3>
          <ul>
            {categoryLinks.map((link) => (
              <li key={link.id}>
                <a href={link.url_string} target="_blank" rel="noopener noreferrer">
                  {link.link_label}
                </a>
                <form action={deleteLink.bind(null, id, link.id)} style={{ display: "inline" }}>
                  <button type="submit">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <h3>Add a link</h3>
      <form action={addLinkForWorkspace}>
        <label>
          Category
          <input type="text" name="category_header" placeholder="Legal Docs" required />
        </label>
        <label>
          Label
          <input type="text" name="link_label" placeholder="MNDA Draft" required />
        </label>
        <label>
          URL
          <input type="url" name="url_string" placeholder="https://…" required />
        </label>
        <button type="submit">Add link</button>
      </form>
    </main>
  );
}
