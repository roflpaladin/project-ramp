// T43 (Sprint 8, Ticket 43 — "Own-inbox buyer invite & instant flip").
// Behavioural coverage for app/admin/workspaces/[id]/invite-actions.ts's two
// server actions. Mirrors tests/security/portal-session-cookie.spec.ts's
// mocking strategy for the parts of the Next.js request context a plain
// vitest import can't provide (next/headers, next/navigation) — this file's
// header comment is the canonical explanation of why those two are mocked
// rather than run for real.
//
// requireSeller() (lib/plans/require-seller.ts) is ALSO mocked here, unlike
// portal-session-cookie.spec.ts's gate actions (which never call it) —
// requireSeller() internally calls lib/supabase/server.ts's createClient(),
// which calls next/headers's cookies() to read a real Supabase Auth session
// cookie; reconstructing that cookie's chunked, project-ref-derived format
// by hand (rather than driving @supabase/ssr through a real sign-in, as
// tests/security/support/seller-http-session.ts does for HTTP-level tests)
// buys nothing here. Instead the mock returns a real, RLS-scoped Supabase
// client obtained via an actual signInWithPassword() against a dedicated
// test seller (tests/fixtures/seed-invite-workspace.ts) — so every RLS
// decision this suite asserts on (tenant isolation via a missing workspace
// row) is the database's real answer, not a stubbed one. Only the identity
// of *which* seller session requireSeller() hands back is faked; everything
// that session's client does against Postgres is real.
//
// sendAccessCodeEmail (lib/email/send-access-code.ts) is mocked for the same
// reason tests/api/send-token.spec.ts and
// tests/api/issue-access-token-invite.spec.ts mock it: .env.local's
// placeholder SMTP_HOST would otherwise hang each send for ~2 minutes.
// issueAccessTokenForInvite itself runs for real against Supabase.
//
// Own dedicated fixture (seed-invite-workspace.ts), not the shared
// seed-leaky-workspace.ts one — this file's beforeAll/afterAll must never
// truncate rows a concurrent session's suite may depend on.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { sendAccessCodeEmail as SendAccessCodeEmail } from "@/lib/email/send-access-code";
import type { SellerSession } from "@/lib/plans/require-seller";
import { createAdminClient } from "@/lib/supabase/admin";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";
import { requireTestEnv } from "../fixtures/env";
import {
  INVITE_TARGET_DOMAIN,
  resetInviteWorkspace,
  seedInviteWorkspace,
  teardownInviteWorkspace,
  type InviteWorkspace,
} from "../fixtures/seed-invite-workspace";

const env = requireTestEnv();

interface RecordedCookieSet {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
}

const { cookieSetCalls, redirectSentinel, redirectCalls, requestHeaders, currentSellerSession } = vi.hoisted(() => ({
  cookieSetCalls: [] as RecordedCookieSet[],
  redirectSentinel: Symbol("redirect-sentinel"),
  redirectCalls: [] as string[],
  requestHeaders: new Map<string, string>(),
  currentSellerSession: { value: null as SellerSession | null },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieSetCalls.push({ name, value, options });
    },
  })),
  headers: vi.fn(async () => ({
    get: (name: string) => requestHeaders.get(name.toLowerCase()) ?? null,
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    redirectCalls.push(path);
    throw redirectSentinel;
  }),
}));

// revalidatePath() throws "static generation store missing" outside a real
// Next.js request/render context, the same class of problem next/headers's
// cookies()/headers() and next/navigation's redirect() have — mocked as a
// harmless recorder for the same reason those are.
const revalidatePathCalls: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn((path: string) => {
    revalidatePathCalls.push(path);
  }),
}));

const sendAccessCodeEmail = vi.fn<typeof SendAccessCodeEmail>(async () => ({ ok: true }));
vi.mock("@/lib/email/send-access-code", () => ({
  sendAccessCodeEmail: (...args: Parameters<typeof SendAccessCodeEmail>) => sendAccessCodeEmail(...args),
}));

vi.mock("@/lib/plans/require-seller", () => ({
  requireSeller: vi.fn(async () => currentSellerSession.value),
}));

const { sendBuyerInvite, flipToBuyerView } = await import(
  "@/app/admin/workspaces/[id]/invite-actions"
);
const { INITIAL_SEND_INVITE_STATE } = await import("@/app/admin/workspaces/[id]/invite-state");

async function signInAsSeller(seeded: InviteWorkspace): Promise<SupabaseClient> {
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: seeded.ownerEmail,
    password: seeded.ownerPassword,
  });
  if (error) throw new Error(`seller sign-in failed: ${error.message}`);
  return client;
}

async function approvedEmailsOf(workspaceId: string): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db.from("workspaces").select("approved_emails").eq("id", workspaceId).single();
  return data?.approved_emails ?? [];
}

async function pendingTokenCount(workspaceId: string, email: string): Promise<number> {
  const db = createAdminClient();
  const { data } = await db
    .from("portal_access_tokens")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("email", email)
    .is("consumed_at", null);
  return data?.length ?? 0;
}

async function analyticsCount(workspaceId: string): Promise<number> {
  const db = createAdminClient();
  const { data } = await db.from("workspace_analytics").select("id").eq("workspace_id", workspaceId);
  return data?.length ?? 0;
}

function formDataWithEmail(email: string): FormData {
  const formData = new FormData();
  formData.set("email", email);
  return formData;
}

let seeded: InviteWorkspace;
let sellerClient: SupabaseClient;

beforeAll(async () => {
  await teardownInviteWorkspace();
  seeded = await seedInviteWorkspace();
  sellerClient = await signInAsSeller(seeded);
});

afterAll(async () => {
  await teardownInviteWorkspace();
});

beforeEach(() => {
  cookieSetCalls.length = 0;
  redirectCalls.length = 0;
  requestHeaders.clear();
  requestHeaders.set("x-forwarded-proto", "https");
  requestHeaders.set("x-forwarded-host", "getbrava.io");
  currentSellerSession.value = { client: sellerClient, userId: "unused-in-tests", email: seeded?.ownerEmail ?? null };
});

afterEach(async () => {
  sendAccessCodeEmail.mockClear();
  sendAccessCodeEmail.mockImplementation(async () => ({ ok: true }));
  await resetInviteWorkspace();
});

describe("sendBuyerInvite (T43)", () => {
  it("unauthenticated seller: redirects to /admin/login and writes nothing", async () => {
    currentSellerSession.value = null;
    const email = "unauth-attempt@buyer-inbox-test.invalid";

    await expect(
      sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email)),
    ).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toEqual(["/admin/login"]);
    expect(await approvedEmailsOf(seeded.workspaceId)).toEqual([]);
  });

  it("rejects an implausible email with a validation error state, before touching the database", async () => {
    const result = await sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail("not-an-email"));

    expect(result.status).toBe("error");
    expect(result.email).toBeNull();
    expect(await approvedEmailsOf(seeded.workspaceId)).toEqual([]);
  });

  it("wrong-tenant workspace: returns an error state (not a throw/redirect) and writes no whitelist entry", async () => {
    const email = "cross-tenant-attempt@buyer-inbox-test.invalid";

    const result = await sendBuyerInvite(seeded.foreignWorkspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email));

    expect(result.status).toBe("error");
    expect(await approvedEmailsOf(seeded.foreignWorkspaceId)).toEqual([]);
  });

  it("happy path: approves the email, creates a pending token, and returns status 'sent' with the email", async () => {
    const email = "happy-path@buyer-inbox-test.invalid";

    const result = await sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email));

    expect(result).toEqual({ status: "sent", email, message: `Invite sent to ${email}.` });
    expect(await approvedEmailsOf(seeded.workspaceId)).toEqual([email]);
    expect(await pendingTokenCount(seeded.workspaceId, email)).toBe(1);
    expect(sendAccessCodeEmail).toHaveBeenCalledTimes(1);
    expect(sendAccessCodeEmail.mock.calls[0][0]).toMatchObject({
      to: email,
      portalUrl: `https://getbrava.io/portal/${seeded.workspaceId}`,
    });
  });

  it("repeat send for the same email does not duplicate the approved_emails entry", async () => {
    const email = "repeat-invite@buyer-inbox-test.invalid";

    await sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email));
    // Second call lands inside the resend cooldown (asserted separately
    // below) — the point of THIS test is only the whitelist's shape.
    await sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email));

    expect(await approvedEmailsOf(seeded.workspaceId)).toEqual([email]);
  });

  it("cooldown: a second invite for the same email within the resend window surfaces status 'cooldown'", async () => {
    const email = "cooldown-invite@buyer-inbox-test.invalid";

    const first = await sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email));
    expect(first.status).toBe("sent");
    sendAccessCodeEmail.mockClear();

    const second = await sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email));

    expect(second.status).toBe("cooldown");
    expect(second.email).toBe(email);
    expect(second.message).toMatch(/again/i);
    expect(sendAccessCodeEmail).not.toHaveBeenCalled();
    expect(await pendingTokenCount(seeded.workspaceId, email)).toBe(1);
  });

  it("send-failed: a mocked email failure surfaces status 'error' but still leaves the whitelist entry and token row in place", async () => {
    const email = "send-failed-invite@buyer-inbox-test.invalid";
    sendAccessCodeEmail.mockImplementationOnce(async () => ({ ok: false }));

    const result = await sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email));

    expect(result.status).toBe("error");
    expect(await approvedEmailsOf(seeded.workspaceId)).toEqual([email]);
    expect(await pendingTokenCount(seeded.workspaceId, email)).toBe(1);
  });

  it("approves via the workspace's target_domain match too, without duplicating the domain-covered email into approved_emails", async () => {
    const email = `domain-match-invite@${INVITE_TARGET_DOMAIN}`;

    const result = await sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email));

    expect(result.status).toBe("sent");
    // Already covered by target_domain matching (lib/portal-access.ts) —
    // isEmailApproved treated it as approved before the write step ever ran,
    // so it is never appended to the explicit approved_emails array.
    expect(await approvedEmailsOf(seeded.workspaceId)).toEqual([]);
  });

  it("builds the emailed portal link from NEXT_PUBLIC_APP_URL when set, ignoring forwarded headers (T43 security review)", async () => {
    const email = "env-origin-invite@buyer-inbox-test.invalid";
    requestHeaders.set("x-forwarded-host", "attacker.invalid");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.getbrava.io");
    try {
      const result = await sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email));

      expect(result.status).toBe("sent");
      expect(sendAccessCodeEmail.mock.calls[0][0]).toMatchObject({
        portalUrl: `https://app.getbrava.io/portal/${seeded.workspaceId}`,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("falls back to the production origin when the forwarded host is malformed and no NEXT_PUBLIC_APP_URL is set (T43 security review)", async () => {
    const email = "malformed-host-invite@buyer-inbox-test.invalid";
    // `"` is a forbidden host code point — `new URL` rejects it, so the
    // attribute-breakout shape can never reach the emailed link at all.
    requestHeaders.set("x-forwarded-host", 'attacker.invalid"><script>');

    const result = await sendBuyerInvite(seeded.workspaceId, INITIAL_SEND_INVITE_STATE, formDataWithEmail(email));

    expect(result.status).toBe("sent");
    expect(sendAccessCodeEmail.mock.calls[0][0]).toMatchObject({
      portalUrl: `https://getbrava.io/portal/${seeded.workspaceId}`,
    });
  });
});

describe("flipToBuyerView (T43)", () => {
  it("unauthenticated seller: redirects to /admin/login and sets no cookie", async () => {
    currentSellerSession.value = null;

    await expect(flipToBuyerView(seeded.workspaceId, formDataWithEmail("anyone@invite-test.invalid"))).rejects.toBe(
      redirectSentinel,
    );

    expect(redirectCalls).toEqual(["/admin/login"]);
    expect(cookieSetCalls).toHaveLength(0);
  });

  it("happy path: mints the pinned-options session cookie for the whitelisted email and redirects to /portal/[id]", async () => {
    const email = "flip-happy-path@invite-test.invalid";
    const db = createAdminClient();
    await db.from("workspaces").update({ approved_emails: [email] }).eq("id", seeded.workspaceId);

    await expect(flipToBuyerView(seeded.workspaceId, formDataWithEmail(email))).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toEqual([`/portal/${seeded.workspaceId}`]);
    expect(cookieSetCalls).toHaveLength(1);
    const [call] = cookieSetCalls;
    expect(call.name).toBe(portalCookieName(seeded.workspaceId));
    expect(call.options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: expect.any(Date),
    });
    // The minted cookie value actually verifies back to this email — not
    // merely that SOME cookie was set.
    expect(verifyPortalSessionValue(seeded.workspaceId, call.value)).toEqual({ email });
  });

  it("flips a domain-approved email that was never explicitly whitelisted — same isEmailApproved contract as the invite (T43 review regression)", async () => {
    // Review finding: sendBuyerInvite deliberately skips the whitelist append
    // for a domain-covered address, so a literal array-membership check here
    // made the flip silently refuse the most common approval path right
    // after the invite reported "sent". The flip must honour the exact same
    // isEmailApproved contract (explicit list OR target_domain match).
    const email = `flip-domain-match@${INVITE_TARGET_DOMAIN}`;

    await expect(flipToBuyerView(seeded.workspaceId, formDataWithEmail(email))).rejects.toBe(redirectSentinel);

    expect(redirectCalls).toEqual([`/portal/${seeded.workspaceId}`]);
    expect(cookieSetCalls).toHaveLength(1);
    expect(verifyPortalSessionValue(seeded.workspaceId, cookieSetCalls[0].value)).toEqual({ email });
  });

  it("refuses a wrong-tenant workspace: no cookie set, redirects back to the admin workspace page", async () => {
    const email = "flip-wrong-tenant@invite-test.invalid";
    const db = createAdminClient();
    await db.from("workspaces").update({ approved_emails: [email] }).eq("id", seeded.foreignWorkspaceId);

    await expect(flipToBuyerView(seeded.foreignWorkspaceId, formDataWithEmail(email))).rejects.toBe(redirectSentinel);

    expect(cookieSetCalls).toHaveLength(0);
    expect(redirectCalls).toEqual([`/admin/workspaces/${seeded.foreignWorkspaceId}`]);
  });

  it("refuses an email that is neither whitelisted nor domain-matched on the seller's own workspace: no cookie set", async () => {
    // Off the workspace's target_domain on purpose: since the flip honours
    // the full isEmailApproved contract (T43 review regression above), an
    // address on the target domain is legitimately approved — real refusal
    // needs an address outside both the explicit list and the domain.
    await expect(
      flipToBuyerView(seeded.workspaceId, formDataWithEmail("never-invited@somewhere-else.invalid")),
    ).rejects.toBe(redirectSentinel);

    expect(cookieSetCalls).toHaveLength(0);
    expect(redirectCalls).toEqual([`/admin/workspaces/${seeded.workspaceId}`]);
  });

  it("inserts NO workspace_analytics row — a seller's own flip is not buyer engagement", async () => {
    const email = "flip-no-analytics@invite-test.invalid";
    const db = createAdminClient();
    await db.from("workspaces").update({ approved_emails: [email] }).eq("id", seeded.workspaceId);

    const before = await analyticsCount(seeded.workspaceId);
    await expect(flipToBuyerView(seeded.workspaceId, formDataWithEmail(email))).rejects.toBe(redirectSentinel);
    const after = await analyticsCount(seeded.workspaceId);

    expect(after).toBe(before);
  });
});
