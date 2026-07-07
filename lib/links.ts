export type WorkspaceLink = {
  id: string;
  category_header: string;
  link_label: string;
  url_string: string;
  display_order: number;
};

export function groupByCategory(links: WorkspaceLink[]): Map<string, WorkspaceLink[]> {
  const grouped = new Map<string, WorkspaceLink[]>();
  for (const link of links) {
    const bucket = grouped.get(link.category_header) ?? [];
    bucket.push(link);
    grouped.set(link.category_header, bucket);
  }
  return grouped;
}
