import { OnboardingFlow } from "./onboarding-flow";

// Sprint 8, Ticket 41 — guided first-run onboarding. Kept minimal on
// purpose: middleware.ts already auth-gates every /admin/** route, so this
// server component has nothing to check itself, and it deliberately never
// queries workspace count to auto-redirect elsewhere. Recon for this ticket
// found that middleware already redirects unauthenticated requests here to
// /admin/login — layering a second, workspace-count-based redirect on top
// would risk a loop against that (a signed-in seller with zero workspaces
// landing here, being bounced to /admin, and — if /admin ever redirected
// zero-workspace sellers back here — bouncing forever). The empty state on
// /admin (app/admin/page.tsx) links here explicitly instead; this page never
// invites itself.
export default function OnboardingPage() {
  return <OnboardingFlow />;
}
