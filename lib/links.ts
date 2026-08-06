export type LinkVisibility = "shared" | "private";

export type WorkspaceLink = {
  id: string;
  category_header: string;
  link_label: string;
  url_string: string;
  display_order: number;
  visibility: LinkVisibility;
  resource_type: string | null;
};

// Generic over any shape with at least a category_header (not fixed to
// WorkspaceLink): app/portal/[id]/page.tsx and app/view/[id]/page.tsx also
// call this with BuyerResource[] (lib/portal-payload.ts), which deliberately
// has no `visibility` field — that field never crosses the buyer boundary.
// Keeping this generic means neither buyer surface needs to change (or be
// touched at all — T30-6) when WorkspaceLink grows fields the buyer payload
// doesn't carry.
export function groupByCategory<T extends { category_header: string }>(links: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const link of links) {
    const bucket = grouped.get(link.category_header) ?? [];
    bucket.push(link);
    grouped.set(link.category_header, bucket);
  }
  return grouped;
}

// Sprint 6, Ticket 30 (T30-3/T30-5). Free-text, nullable DB column (0005) —
// no CHECK constraint enforces a closed set of values. These are the seller
// builder's suggested options, not a schema-level enum; a seller can still
// leave it blank. Flag for confirmation against the live Notion "UI/UX and
// Design Guidelines" page if a firmer taxonomy is wanted later.
export const RESOURCE_TYPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "doc", label: "Doc" },
  { value: "deck", label: "Deck" },
  { value: "video", label: "Video" },
  { value: "dashboard", label: "Dashboard" },
  { value: "tool", label: "Tool" },
];

const RESOURCE_TYPE_FALLBACK_LABEL = "Other";

/**
 * Normalizes a nullable, free-text resource_type into a display label. Every
 * pre-Ticket-30 link (and every row where the seller left the field blank)
 * has `resource_type: null` — those collapse into one fallback bucket
 * instead of rendering a blank heading.
 */
export function resourceTypeLabel(resourceType: string | null): string {
  const trimmed = resourceType?.trim();
  return trimmed ? trimmed : RESOURCE_TYPE_FALLBACK_LABEL;
}

/**
 * Sibling to groupByCategory (T30-5): reconciles resource_type into the
 * existing category grouping as a nested second level, rather than
 * replacing category_header. category_header stays the seller-authored,
 * free-text top-level heading (e.g. "Legal docs"); resource_type becomes an
 * optional sub-heading within it (e.g. "Doc", "Video"). Kept simple on
 * purpose: callers should only render the sub-heading when a category
 * actually splits into more than one type (see WorkspaceDetailPage) — for
 * every workspace seeded before this ticket, every link's resource_type is
 * null, so every category collapses to a single "Other" bucket and the
 * on-screen result is identical to groupByCategory alone.
 */
export function groupByCategoryAndType(
  links: WorkspaceLink[],
): Map<string, Map<string, WorkspaceLink[]>> {
  const byCategory = groupByCategory(links);
  const result = new Map<string, Map<string, WorkspaceLink[]>>();

  for (const [category, categoryLinks] of byCategory) {
    const byType = new Map<string, WorkspaceLink[]>();
    for (const link of categoryLinks) {
      const label = resourceTypeLabel(link.resource_type);
      byType.set(label, [...(byType.get(label) ?? []), link]);
    }
    result.set(category, byType);
  }

  return result;
}
