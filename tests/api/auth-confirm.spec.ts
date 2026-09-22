// Sprint 12, Ticket 65 — "Password Reset Flow". Route-handler coverage for
// app/auth/confirm/route.ts. Pins the Sprint 12 panel finding: the route used
// to cast ANY `type` straight into verifyOtp and always land on /admin. Now
// the link type is allow-listed, a recovery link is forwarded (unspent) to
// the /auth/recover continue page, and every destination is a fixed internal
// path — a `next`/`redirect_to` param in the link is ignored (no open
// redirect).
//
// DB-free: the Supabase server client, next/headers and next/navigation are
// mocked, so only the route's own branching runs. The real GoTrue
// token_hash contract is pinned live in tests/security/password-reset.spec.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "7e570000-0000-4000-8000-000000006503";

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

const { GET } = await import("@/app/auth/confirm/route");

async function visit(query: string): Promise<string> {
  try {
    await GET(new Request(`https://www.getbrava.tech/auth/confirm${query}`));
  } catch (error) {
    if (error instanceof RedirectSignal) return error.location;
    throw error;
  }
  throw new Error("route returned without redirecting");
}

beforeEach(() => {
  verifyOtp.mockReset();
  verifyOtp.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  cookieWrites.length = 0;
});

describe("GET /auth/confirm — link type allow-list", () => {
  it.each(["?type=recovery", "?token_hash=abc", ""])(
    "sends a link missing its token or type (%j) back to sign-in without calling Supabase",
    async (query) => {
      const location = await visit(query);

      expect(location.startsWith("/admin/login?error=")).toBe(true);
      expect(verifyOtp).not.toHaveBeenCalled();
    },
  );

  it.each(["invite", "email_change", "phone_change", "bogus", "RECOVERY"])(
    "rejects link type %s without calling Supabase",
    async (type) => {
      const location = await visit(`?token_hash=abc&type=${type}`);

      expect(location.startsWith("/admin/login?error=")).toBe(true);
      expect(verifyOtp).not.toHaveBeenCalled();
    },
  );

  it.each(["email", "magiclink", "signup"])("lands a verified %s link on /admin", async (type) => {
    const location = await visit(`?token_hash=abc&type=${type}`);

    expect(location).toBe("/admin");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type });
    expect(cookieWrites).toHaveLength(0);
  });

  it("sends a failed sign-in link back to sign-in with the fixed message", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "otp_expired" } });

    const location = await visit("?token_hash=abc&type=email");

    expect(location.startsWith("/admin/login?error=")).toBe(true);
    expect(decodeURIComponent(location)).not.toContain("otp_expired");
  });
});

describe("GET /auth/confirm — recovery", () => {
  // Security review MEDIUM-2/3: a GET must never spend a recovery token —
  // mail scanners pre-open links. The route only forwards the token to the
  // /auth/recover page, whose button POSTs it
  // (tests/auth/continue-recovery-action.spec.ts).
  it("forwards a recovery link to the continue page without calling Supabase", async () => {
    const location = await visit("?token_hash=abc123DEF456ghi789&type=recovery");

    expect(location).toBe("/auth/recover?token_hash=abc123DEF456ghi789");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(cookieWrites).toHaveLength(0);
  });

  it.each(["short", "has space 0123456789abcdef", "a".repeat(300), "../../admin/0123456789"])(
    "sends a malformed recovery token (%j) to the request page",
    async (tokenHash) => {
      const location = await visit(`?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`);

      expect(location).toBe("/forgot-password?error=link_expired");
      expect(verifyOtp).not.toHaveBeenCalled();
    },
  );

  it.each([
    "&next=https://evil.example",
    "&next=//evil.example",
    "&redirect_to=https://evil.example",
    "&next=/admin/settings",
  ])("ignores a caller-supplied destination (%s)", async (extra) => {
    const location = await visit(`?token_hash=abc123DEF456ghi789&type=recovery${extra}`);

    expect(location).toBe("/auth/recover?token_hash=abc123DEF456ghi789");
  });
});
