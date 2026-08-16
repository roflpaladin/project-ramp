// Sprint 8, Ticket 41 — guided first-run onboarding. Deliberately NOT inside
// onboarding-actions.ts's "use server" module: a plain-object export from a
// "use server" file crashes every form submit in a production build (Next
// only allows async-function exports from a "use server" module there) —
// Session A hit and fixed the same shape of bug for the T43 files (PR #38).
// So the useActionState state type + its initial value live in this plain
// module instead, and onboarding-actions.ts imports them rather than
// re-exporting them itself.

export interface OnboardingActionState {
  readonly error: string | null;
}

export const INITIAL_ONBOARDING_STATE: OnboardingActionState = { error: null };

// User-facing error copy, shared by BOTH sides of the wire (review finding,
// T41): onboarding-actions.ts returns these exact strings as
// OnboardingActionState.error, and onboarding-flow.tsx compares against the
// same constants (===) to map a message back to the field it describes for
// aria-invalid. Keeping them here — the one plain module both already import
// — turns what were three hand-copied variants of each sentence (action,
// client matcher, test literal) into a single source that cannot silently
// drift when the copy changes.
export const MISSING_TENANT_MESSAGE =
  "Your account is missing its workspace home. Sign out and back in, then try again.";
export const MISSING_NAME_MESSAGE = "Company name is required.";
export const INVALID_DOMAIN_MESSAGE = "Enter a valid domain, e.g. acme.com.";
export const INSERT_FAILED_MESSAGE = "Couldn't create the workspace. Try again in a moment.";
export const RATE_LIMITED_MESSAGE =
  "You've set up several workspaces in a short time. Wait a few minutes, then try again.";
