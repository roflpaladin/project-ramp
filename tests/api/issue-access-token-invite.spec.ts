// T43 (Sprint 8, Ticket 43 — "Own-inbox buyer invite & instant flip").
// Behavioural coverage for lib/portal-access-token.ts's new
// issueAccessTokenForInvite() export — the seller-invite counterpart to the
// existing, uniform-response issueAccessToken() already covered end-to-end
// by tests/api/send-token.spec.ts. Real Supabase reads/writes throughout
// (own dedicated fixture: tests/fixtures/seed-invite-workspace.ts, kept
// separate from seed-leaky-workspace.ts so this file's beforeAll/afterAll
// never truncates rows a concurrent session's suite may be relying on — see
// that fixture's header comment).
//
// The only mock is sendAccessCodeEmail (lib/email/send-access-code.ts) —
// same reasoning as send-token.spec.ts: .env.local's placeholder SMTP_HOST
// makes an unmocked send hang for nodemailer's ~2 minute connection timeout,
// well past this suite's 30s testTimeout, and the function already fails
// soft in production, so stubbing its transport hop changes nothing about
// the behaviour under test.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { sendAccessCodeEmail as SendAccessCodeEmail } from "@/lib/email/send-access-code";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTestEnv } from "../fixtures/env";
import {
  INVITE_TARGET_DOMAIN,
  resetInviteWorkspace,
  seedInviteWorkspace,
  teardownInviteWorkspace,
  type InviteWorkspace,
} from "../fixtures/seed-invite-workspace";

requireTestEnv();

const sendAccessCodeEmail = vi.fn<typeof SendAccessCodeEmail>(async () => ({ ok: true }));
vi.mock("@/lib/email/send-access-code", () => ({
  sendAccessCodeEmail: (...args: Parameters<typeof SendAccessCodeEmail>) => sendAccessCodeEmail(...args),
}));

const { issueAccessTokenForInvite, INVITE_ISSUANCE_CAP_PER_WORKSPACE } = await import("@/lib/portal-access-token");

async function countPendingTokens(workspaceId: string, email: string): Promise<number> {
  const db = createAdminClient();
  const { data } = await db
    .from("portal_access_tokens")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .is("consumed_at", null);
  return data?.length ?? 0;
}

let seeded: InviteWorkspace;

beforeAll(async () => {
  seeded = await seedInviteWorkspace();
});

afterAll(async () => {
  await teardownInviteWorkspace();
});

afterEach(async () => {
  sendAccessCodeEmail.mockClear();
  sendAccessCodeEmail.mockImplementation(async () => ({ ok: true }));
  await resetInviteWorkspace();
});

describe("issueAccessTokenForInvite (T43)", () => {
  it("returns { status: 'sent', email } and creates a pending token when the email is approved", async () => {
    const email = "buyer-sent@invite-test.invalid";
    const db = createAdminClient();
    await db.from("workspaces").update({ approved_emails: [email] }).eq("id", seeded.workspaceId);

    const before = await countPendingTokens(seeded.workspaceId, email);
    const result = await issueAccessTokenForInvite(seeded.workspaceId, email, {
      portalUrl: `https://getbrava.io/portal/${seeded.workspaceId}`,
    });
    const after = await countPendingTokens(seeded.workspaceId, email);

    expect(result).toEqual({ status: "sent", email });
    expect(after).toBe(before + 1);
    expect(sendAccessCodeEmail).toHaveBeenCalledTimes(1);
    expect(sendAccessCodeEmail.mock.calls[0][0]).toMatchObject({
      to: email,
      portalUrl: `https://getbrava.io/portal/${seeded.workspaceId}`,
    });
  });

  it("approves via the workspace's target_domain match too, not only the explicit whitelist", async () => {
    const email = `domain-match@${INVITE_TARGET_DOMAIN}`;

    const result = await issueAccessTokenForInvite(seeded.workspaceId, email);

    expect(result).toEqual({ status: "sent", email });
  });

  it("returns { status: 'not-approved' } and writes no token for an email outside the whitelist and domain", async () => {
    const email = "not-approved@somewhere-else.invalid";

    const result = await issueAccessTokenForInvite(seeded.workspaceId, email);

    expect(result).toEqual({ status: "not-approved" });
    expect(await countPendingTokens(seeded.workspaceId, email)).toBe(0);
    expect(sendAccessCodeEmail).not.toHaveBeenCalled();
  });

  it("returns { status: 'cooldown', retryAfterMs } when a pending token was issued within the resend window", async () => {
    const email = "cooldown@invite-test.invalid";
    const db = createAdminClient();
    await db.from("workspaces").update({ approved_emails: [email] }).eq("id", seeded.workspaceId);

    const first = await issueAccessTokenForInvite(seeded.workspaceId, email);
    expect(first).toEqual({ status: "sent", email });
    sendAccessCodeEmail.mockClear();

    const second = await issueAccessTokenForInvite(seeded.workspaceId, email);

    expect(second.status).toBe("cooldown");
    if (second.status === "cooldown") {
      expect(second.retryAfterMs).toBeGreaterThan(0);
      expect(second.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
    // Still only the one token row from the first call — the cooldown branch
    // returns before ever inserting a second row or sending a second email.
    expect(await countPendingTokens(seeded.workspaceId, email)).toBe(1);
    expect(sendAccessCodeEmail).not.toHaveBeenCalled();
  });

  it("propagates sendAccessCodeEmail's { ok: false } as { status: 'send-failed' } instead of swallowing it", async () => {
    const email = "send-failed@invite-test.invalid";
    const db = createAdminClient();
    await db.from("workspaces").update({ approved_emails: [email] }).eq("id", seeded.workspaceId);
    sendAccessCodeEmail.mockImplementationOnce(async () => ({ ok: false }));

    const result = await issueAccessTokenForInvite(seeded.workspaceId, email);

    expect(result).toEqual({ status: "send-failed" });
    // The token row is still created before the send attempt (matches
    // issueAccessToken's existing order of operations) — a failed email
    // must not silently discard an otherwise-valid code.
    expect(await countPendingTokens(seeded.workspaceId, email)).toBe(1);
  });

  it("returns { status: 'rate-limited' } at the per-workspace hourly cap, before writing a token or sending (T43 security review)", async () => {
    const email = "capped@invite-test.invalid";
    const db = createAdminClient();
    await db.from("workspaces").update({ approved_emails: [email] }).eq("id", seeded.workspaceId);

    // Fill the workspace's hourly issuance window right up to the cap with
    // pre-existing token rows (distinct recipients — the fan-out the cap
    // exists to bound). resetInviteWorkspace() deletes them in afterEach.
    const fillerRows = Array.from({ length: INVITE_ISSUANCE_CAP_PER_WORKSPACE }, (_, index) => ({
      workspace_id: seeded.workspaceId,
      email: `cap-filler-${index}@invite-test.invalid`,
      token_hash: `cap-filler-hash-${index}`,
      expires_at: new Date(Date.now() + 1000 * 60 * 15).toISOString(),
    }));
    const { error } = await db.from("portal_access_tokens").insert(fillerRows);
    expect(error).toBeNull();

    const result = await issueAccessTokenForInvite(seeded.workspaceId, email);

    expect(result).toEqual({ status: "rate-limited" });
    expect(await countPendingTokens(seeded.workspaceId, email)).toBe(0);
    expect(sendAccessCodeEmail).not.toHaveBeenCalled();
  });

  it("returns { status: 'not-approved' } for a nonexistent workspace, mirroring issueAccessToken's non-enumeration guard", async () => {
    const nonexistentWorkspaceId = "7e570000-0000-4000-8000-0000000000ec";

    const result = await issueAccessTokenForInvite(nonexistentWorkspaceId, "anyone@invite-test.invalid");

    expect(result).toEqual({ status: "not-approved" });
    expect(sendAccessCodeEmail).not.toHaveBeenCalled();
  });
});
