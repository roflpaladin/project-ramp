import type { ReactNode } from "react";
import "./plan.css";

// Seller plan-builder surface (Sprint 6, Ticket 29). Access control lives in
// middleware.ts (same as the rest of /admin) — this layout only loads the
// Tailwind utilities this surface's layout needs. Brand colour is NOT
// redefined here: the Ramp tokens live globally in app/globals.css so every
// surface (this one included) resolves the exact same values.
export default function PlanBuilderLayout({ children }: { children: ReactNode }) {
  return <div data-surface="plan-builder">{children}</div>;
}
