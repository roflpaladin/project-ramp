import type { ReactNode } from "react";
import "./onboarding.css";

// Sprint 8, Ticket 41 — guided first-run onboarding surface ("onboarding IS
// the demo": the flagship flow walked through live on Sep 1). Same pattern as
// app/admin/workspaces/[id]/plan/layout.tsx: this layout only loads the
// Tailwind utilities this surface needs. Brand colour is NOT redefined here —
// the Ramp tokens live globally in app/globals.css so this surface resolves
// the exact same values as every other one.
//
// Nested under app/admin/layout.tsx (data-surface="admin"), itself already
// behind middleware.ts's auth gate for every /admin/** route — no additional
// access control needed here.
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <div data-surface="onboarding">{children}</div>;
}
