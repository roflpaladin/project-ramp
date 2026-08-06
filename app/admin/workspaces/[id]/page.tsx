import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { groupByCategoryAndType, RESOURCE_TYPE_OPTIONS } from "@/lib/links";
import { addLink } from "./links-actions";
import { LinkUrlField } from "./link-url-field";
import { LinkRow } from "./link-row";
import "./workspace-links.css";

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
    .select("id, category_header, link_label, url_string, display_order, visibility, resource_type")
    .eq("workspace_id", id)
    .order("category_header", { ascending: true })
    .order("display_order", { ascending: true });

  const grouped = groupByCategoryAndType(links ?? []);
  const addLinkForWorkspace = addLink.bind(null, id);

  return (
    <main data-surface="workspace-links">
      <h1>{workspace.target_company_name}</h1>
      <p>Domain: {workspace.target_domain}</p>

      <p className="wsl-plan-nav">
        <Link href={`/admin/workspaces/${id}/plan`} className="wsl-btn">
          Go to plan builder
        </Link>
      </p>

      <h2>Links</h2>
      {[...grouped.entries()].map(([category, byType]) => {
        const typeEntries = [...byType.entries()];
        // Only show a resource_type sub-heading when a category actually
        // splits into more than one type (T30-5) — for every workspace
        // seeded before this ticket, every link's resource_type is null, so
        // this renders identically to the old flat groupByCategory output.
        const showTypeHeadings = typeEntries.length > 1;

        return (
          <section key={category}>
            <h3>{category}</h3>
            {typeEntries.map(([typeLabel, typeLinks]) => (
              <div key={typeLabel}>
                {showTypeHeadings ? <h4 className="wsl-type-heading">{typeLabel}</h4> : null}
                <ul className="wsl-link-list">
                  {typeLinks.map((link) => (
                    <LinkRow key={link.id} workspaceId={id} link={link} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}

      <h3>Add a link</h3>
      <form action={addLinkForWorkspace}>
        <label className="wsl-field">
          Category
          <input className="wsl-input" type="text" name="category_header" placeholder="Legal Docs" required />
        </label>
        <LinkUrlField />
        <label className="wsl-field">
          Resource type
          <input
            className="wsl-input"
            type="text"
            name="resource_type"
            placeholder="Doc, Deck, Video…"
            list="wsl-resource-type-suggestions"
          />
        </label>
        <datalist id="wsl-resource-type-suggestions">
          {RESOURCE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.label} />
          ))}
        </datalist>
        <label className="wsl-field">
          Visibility
          <select className="wsl-select" name="visibility" defaultValue="shared">
            <option value="shared">Shared with buyer</option>
            <option value="private">Private to you</option>
          </select>
        </label>
        <button type="submit" className="wsl-btn">
          Add link
        </button>
      </form>
    </main>
  );
}
