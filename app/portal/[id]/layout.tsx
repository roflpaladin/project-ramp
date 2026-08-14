import type { Metadata } from "next";
import type { ReactNode } from "react";

// B5 (plans/sprint-6-7-replan.md §3, fixed T34-3). Data-free, so this is the
// one place noindex has to be declared for the whole /portal/[id] subtree.
// Next merges layout metadata as the base and a page's own generateMetadata
// only overrides the keys it actually returns — so a page-level `{}` (the
// unauthenticated gate branch, app/portal/[id]/page.tsx) inherits this
// instead of overriding it into an indexable page. That covers every branch
// that exists today AND every branch anyone adds later, which per-branch
// `robots` literals in generateMetadata can't guarantee — one is easy to
// forget, and forgetting it is exactly what made B5 exploitable in the first
// place (site: enumeration of live workspace ids).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div data-surface="portal">{children}</div>;
}
