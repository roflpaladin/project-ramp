// Sprint 12, Ticket 65 — "Password Reset Flow" (security review MEDIUM-2/3).
// Behavioural coverage for app/auth/recover/actions.ts's continueRecovery:
// the ONLY place a recovery token is spent. It runs on a form POST, never on
// the GET an email link produces, so a mail scanner that pre-opens the link
// (Outlook Safe Links, Proofpoint, Mimecast) cannot burn the seller's
// one-time token or be handed a live session.
//
// DB-free: the Supabase server client, next/headers and next/navigation are
// mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RECOVERY_MARKER_COOKIE, verifyRecoveryMarker } from "@/lib/auth/recovery-marker";

const USER_ID = "7e570000-0000-4000-8000-000000006506";
const TOKEN_HASH = "0fe8d90afc0c988c0d195cb11cb41b485929e8c7e4239904919caa92";
const LINK_EXPIRED_LOCATION = "/forgot-password?error=link_expired";

interface CookieWrite {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
}

const { verifyOtp, cookieWrites } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  cookieWrites: [] as CookieWrite[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { verifyOtp } })),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieWrites.push({ name, value, options });
    },
  })),
}));

class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`redirect:${location}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new RedirectSignal(location);
  },
}));

const { continueRecovery } = await import("@/app/auth/recover/actions");

async function submit(tokenHash: string | null): Promise<string> {
  const form = new FormData();
  if (tokenHash !== null) form.set("token_hash", tokenHash);
  try {
    await continueRecovery(form);
  } catch (error) {
    if (error instanceof RedirectSignal) return error.location;
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  cookieWrites.length = 0;
  vi.stubEnv("APP_ENCRYPTION_KEY", "a".repeat(64));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("continueRecovery", () => {
  it("spends the token as a recovery link and lands on the reset page", async () => {
    const location = await submit(TOKEN_HASH);

    expect(location).toBe("/auth/reset");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: TOKEN_HASH, type: "recovery" });
  });

  it("sets a signed, http-only recovery marker scoped to the reset page", async () => {
    await submit(TOKEN_HASH);

    expect(cookieWrites).toHaveLength(1);
    const [write] = cookieWrites;
    expect(write.name).toBe(RECOVERY_MARKER_COOKIE);
    expect(verifyRecoveryMarker(write.value, USER_ID)).toBe(true);
    expect(write.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/auth/reset" });
    expect(write.options.maxAge).toBeGreaterThan(0);
  });

  it("sends an expired or used token to the request page, not a raw error", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "otp_expired" } });

    const location = await submit(TOKEN_HASH);

    expect(location).toBe(LINK_EXPIRED_LOCATION);
    expect(cookieWrites).toHaveLength(0);
  });

  it.each([null, "", "not hex!", "a".repeat(300), "../../admin"])(
    "refuses a malformed token (%j) without calling Supabase",
    async (tokenHash) => {
      const location = await submit(tokenHash);

      expect(location).toBe(LINK_EXPIRED_LOCATION);
      expect(verifyOtp).not.toHaveBeenCalled();
    },
  );

  it("does not spend the token when the marker cannot be signed", async () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const location = await submit(TOKEN_HASH);

    expect(location).toBe(LINK_EXPIRED_LOCATION);
    expect(verifyOtp).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
