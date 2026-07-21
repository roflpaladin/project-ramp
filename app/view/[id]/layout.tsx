import type { ReactNode } from "react";
import "./view.css";

// Buyer-facing demo portal surface. Loads the buyer (warm-tint) brand tokens.
// The any-@ gate and the demo-tenant access scoping live in page.tsx /
// gate-actions.ts — this layout only loads styling.
export default function ViewLayout({ children }: { children: ReactNode }) {
  return <div data-surface="view">{children}</div>;
}
