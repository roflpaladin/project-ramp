import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./view.css";

// Buyer-facing demo portal surface. Loads the buyer (warm-tint) brand tokens.
// The any-@ gate and the demo-tenant access scoping live in page.tsx /
// gate-actions.ts — this layout only loads styling and the base noindex
// metadata below.
//
// B5 (plans/sprint-6-7-replan.md §3, fixed T34-3). This used to be set as a
// literal `robots: { index: false, follow: false }` in all three branches of
// page.tsx's generateMetadata — same value, copy-pasted three times, which is
// one more place to forget on the next branch. Declared once here instead;
// Next merges this as the base for the whole subtree, so a page that returns
// no `robots` key at all still noindexes.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ViewLayout({ children }: { children: ReactNode }) {
  return <div data-surface="view">{children}</div>;
}
