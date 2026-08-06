import type { WorkspaceLink } from "@/lib/links";
import { deleteLink } from "./links-actions";
import { LinkVisibilityControl } from "./link-visibility-control";
import { PrivateBadge } from "./private-badge";

interface LinkRowProps {
  workspaceId: string;
  link: WorkspaceLink;
}

/** One resource-library row: label + url, the T30-4 private fence when
 * applicable, the T30-3 Shared/Private control, and Remove. */
export function LinkRow({ workspaceId, link }: LinkRowProps) {
  return (
    <li className="wsl-link-row" data-visibility={link.visibility}>
      <div className="wsl-link-main">
        <a href={link.url_string} target="_blank" rel="noopener noreferrer" className="wsl-link-anchor">
          {link.link_label}
        </a>
        {link.visibility === "private" ? <PrivateBadge /> : null}
      </div>
      <div className="wsl-link-actions">
        <LinkVisibilityControl
          workspaceId={workspaceId}
          linkId={link.id}
          visibility={link.visibility}
          linkLabel={link.link_label}
        />
        <form action={deleteLink.bind(null, workspaceId, link.id)} className="wsl-inline-form">
          <button type="submit" className="wsl-btn">
            Remove
          </button>
        </form>
      </div>
    </li>
  );
}
