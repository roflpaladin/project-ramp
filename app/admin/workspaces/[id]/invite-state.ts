// T43 follow-up (found by T44's demo-path e2e): these lived in
// invite-actions.ts, but a "use server" file may only export async functions
// — a plain-object export passes `next build` and dev mode, then crashes
// EVERY invite submit at runtime in a production build ("A 'use server' file
// can only export async functions, found object.", digest-only in the
// browser). Same Next constraint app/register/page.tsx already documents for
// its MIN_PASSWORD_LENGTH duplication. So the shared state shape lives here,
// in a plain module both the panel (client) and the action (server) import.

export interface SendInviteState {
  readonly status: "idle" | "sent" | "cooldown" | "error";
  /** The invited email, once it has passed validation — null while idle/on a validation or lookup failure. */
  readonly email: string | null;
  /** Human-facing copy for the form to render; null only in the initial idle state. */
  readonly message: string | null;
}

export const INITIAL_SEND_INVITE_STATE: SendInviteState = {
  status: "idle",
  email: null,
  message: null,
};
