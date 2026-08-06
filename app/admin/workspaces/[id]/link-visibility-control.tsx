import type { LinkVisibility } from "@/lib/links";
import { setLinkVisibility } from "./links-actions";

interface LinkVisibilityControlProps {
  workspaceId: string;
  linkId: string;
  visibility: LinkVisibility;
  linkLabel: string;
}

const VISIBILITY_OPTIONS: readonly { value: LinkVisibility; label: string }[] = [
  { value: "shared", label: "Shared" },
  { value: "private", label: "Private" },
];

/**
 * Shared/Private control for a single link row (T30-3). Two real forms, one
 * per option, each posting its own explicit target value to
 * setLinkVisibility — not a client-side toggle — so it stays keyboard-
 * operable and works without JS, matching this page's existing
 * addLink/deleteLink forms. The current option's button is disabled rather
 * than hidden, so the control always shows both choices and which one is
 * active (a visible segmented pill, never a dropdown — same convention the
 * plan builder's OwnerToggle already established for two-state controls).
 */
export function LinkVisibilityControl({
  workspaceId,
  linkId,
  visibility,
  linkLabel,
}: LinkVisibilityControlProps) {
  return (
    <div className="wsl-visibility" role="group" aria-label={`Visibility for ${linkLabel}`}>
      {VISIBILITY_OPTIONS.map((option) => {
        const isActive = option.value === visibility;
        return (
          <form key={option.value} action={setLinkVisibility.bind(null, workspaceId, linkId, option.value)}>
            <button
              type="submit"
              className="wsl-visibility-option"
              data-active={isActive}
              disabled={isActive}
              aria-pressed={isActive}
            >
              {option.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}
