import type { SVGProps } from "react";

// Exported (not just used locally) so the seller-private CRM/forecast strip
// (Ticket 31, crm-forecast-strip.tsx) can reuse the exact same fenced-private
// lock glyph rather than duplicating the SVG — same fence idiom, one icon.
export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3.5" y="7" width="9" height="6" rx="1.25" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

/**
 * Fenced private treatment (T30-4). A private link must be unmistakable at a
 * glance: lock icon PLUS the text "Private to you" — never colour alone.
 * Neutral/Slate only; a private resource is a STATE, not an action, so it
 * never earns Signal amber. The row's dashed border (workspace-links.css)
 * is the third leg of the same "unmistakable at a glance" requirement.
 */
export function PrivateBadge() {
  return (
    <span className="wsl-private-badge">
      <LockIcon aria-hidden="true" className="wsl-private-icon" />
      Private to you
    </span>
  );
}
