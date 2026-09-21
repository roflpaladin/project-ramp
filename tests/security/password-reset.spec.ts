// Sprint 12, Ticket 65 — "Password Reset Flow". Live-Supabase spec (security
// project, serial): a mock cannot prove that the link WE build from
// admin.generateLink's hashed token is one GoTrue's verifyOtp accepts, or
// that the old password really stops working — the ticket's Definition of
// Done. Only the email transport is mocked (it captures the link instead of
// sending it); every Supabase call is real.
//
//   1. A known email gets exactly one email whose link points at
//      /auth/confirm with type=recovery on the origin we passed in.
//   2. That link's token verifies, the password changes, the new password
//      signs in and the old one is rejected.
//   3. The link is single-use.
//   4. An unknown email sends nothing and does not throw.
//   5. A second request inside the cooldown sends nothing and leaves the
//      first link working (security review HIGH-1 — this is the only
//      durable, instance-independent brake on reset emails, and it rests on
//      two GoTrue behaviours only a live run can pin: generateLink stamps
//      recovery_sent_at, and the admin users endpoint filters by email).
//
// Each scenario gets its OWN seller: with the cooldown in place, a second
// request for the same account inside the window is — correctly — a no-op.
//
// Test rows are tagged with a per-run UUID and deleted in afterAll — this
// suite shares the dev Supabase project with CI and the other session.

import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { provisionSeller } from "@/lib/auth/provision-seller";
import { requireTestEnv } from "../fixtures/env";

interface CapturedEmail {
  readonly to: string;
  readonly resetUrl: string;
}

const { sentEmails } = vi.hoisted(() => ({ sentEmails: [] as CapturedEmail[] }));

vi.mock("@/lib/email/send-password-reset", () => ({
  sendPasswordResetEmail: vi.fn(async (mail: CapturedEmail) => {
    sentEmails.push(mail);
    return { ok: true };
  }),
}));

const { requestPasswordReset } = await import("@/lib/auth/password-reset");

const env = requireTestEnv();
const ORIGIN = "https://www.getbrava.tech";
const OLD_PASSWORD = "old-correct-horse-9";
const NEW_PASSWORD = "new-battery-staple-7";

const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { persistSession: false },
});

const runId = randomUUID();
const companyMarker = `T65 spec ${runId}`;
const createdUserIds: string[] = [];

interface SeededSeller {
  readonly email: string;
  readonly userId: string;
}

async function seedSeller(label: string): Promise<SeededSeller> {
  const email = `t65-${label}-${runId}@example.com`;
  const result = await provisionSeller({ email, password: OLD_PASSWORD, companyName: companyMarker });
  if (!result.ok) throw new Error(`seeding the T65 seller failed: ${result.code}`);
  createdUserIds.push(result.userId);
  return { email, userId: result.userId };
}

function anonClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function tokenHashOf(resetUrl: string): string {
  const tokenHash = new URL(resetUrl).searchParams.get("token_hash");
  if (!tokenHash) throw new Error("reset link carried no token_hash");
  return tokenHash;
}

beforeEach(() => {
  sentEmails.length = 0;
});

afterAll(async () => {
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
  await admin.from("tenants").delete().eq("company_name", companyMarker);
});

describe("requestPasswordReset (live)", () => {
  it("emails a known seller one link to /auth/confirm on the given origin", async () => {
    const seller = await seedSeller("link");

    const result = await requestPasswordReset({ email: seller.email, origin: ORIGIN });

    expect(result).toEqual({ sent: true });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(seller.email);

    const link = new URL(sentEmails[0].resetUrl);
    expect(link.origin).toBe(ORIGIN);
    expect(link.pathname).toBe("/auth/confirm");
    expect(link.searchParams.get("type")).toBe("recovery");
    expect(link.searchParams.get("token_hash")).toBeTruthy();
    expect([...link.searchParams.keys()].sort()).toEqual(["token_hash", "type"]);
  });

  it("sends nothing for an unknown email, does not throw, and logs nothing", async () => {
    // A log line per unknown address would be an enumeration record and a
    // cheap way to flood the logs; lib/auth/password-reset.ts stays silent on
    // GoTrue's user_not_found. Pinned live because the code is GoTrue's.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await requestPasswordReset({
      email: `t65-nobody-${runId}@example.com`,
      origin: ORIGIN,
    });

    expect(result).toEqual({ sent: false });
    expect(sentEmails).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("lets the seller set a new password that works, and rejects the old one", async () => {
    const seller = await seedSeller("change");
    await requestPasswordReset({ email: seller.email, origin: ORIGIN });
    const tokenHash = tokenHashOf(sentEmails[0].resetUrl);

    const recovering = anonClient();
    const verified = await recovering.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    expect(verified.error).toBeNull();
    expect(verified.data.user?.id).toBe(seller.userId);

    const updated = await recovering.auth.updateUser({ password: NEW_PASSWORD });
    expect(updated.error).toBeNull();

    const withNew = await anonClient().auth.signInWithPassword({ email: seller.email, password: NEW_PASSWORD });
    expect(withNew.error).toBeNull();

    const withOld = await anonClient().auth.signInWithPassword({ email: seller.email, password: OLD_PASSWORD });
    expect(withOld.error).not.toBeNull();
    expect(withOld.data.session).toBeNull();
  });

  it("rejects a link that was already used", async () => {
    const seller = await seedSeller("reuse");
    await requestPasswordReset({ email: seller.email, origin: ORIGIN });
    const tokenHash = tokenHashOf(sentEmails[0].resetUrl);

    const first = await anonClient().auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    expect(first.error).toBeNull();

    const second = await anonClient().auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    expect(second.error).not.toBeNull();
    expect(second.data.session).toBeNull();
  });

  it("sends nothing for a second request inside the cooldown, and leaves the first link working", async () => {
    const seller = await seedSeller("cooldown");

    const first = await requestPasswordReset({ email: seller.email, origin: ORIGIN });
    const second = await requestPasswordReset({ email: seller.email, origin: ORIGIN });

    expect(first).toEqual({ sent: true });
    expect(second).toEqual({ sent: false });
    expect(sentEmails).toHaveLength(1);

    // The skipped request must not have minted a new token — that would
    // silently kill the link already sitting in the seller's inbox.
    const verified = await anonClient().auth.verifyOtp({
      token_hash: tokenHashOf(sentEmails[0].resetUrl),
      type: "recovery",
    });
    expect(verified.error).toBeNull();
  });
});
