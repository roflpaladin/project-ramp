// Sprint 12, Ticket 65 — "Password Reset Flow". Behavioural coverage for
// app/auth/reset/actions.ts's setNewPassword. Pins the two guards in front
// of the password change — a signed-in session AND the recovery marker that
// only a just-verified reset link produces — so a borrowed, already
// signed-in browser cannot change a password without knowing the old one.
//
// DB-free: the Supabase server client, next/headers and next/navigation are
// mocked. The real "new password works, old one is rejected" contract is
// pinned live in tests/security/password-reset.spec.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { RECOVERY_MARKER_COOKIE, signRecoveryMarker } from "@/lib/auth/recovery-marker";

const USER_ID = "7e570000-0000-4000-8000-000000006504";
const OTHER_USER_ID = "7e570000-0000-4000-8000-000000006505";
const LINK_EXPIRED_LOCATION = "/forgot-password?error=link_expired";
const GOOD_PASSWORD = "correct-horse-9";

const { getUser, updateUser, signOut, cookieJar, deletedCookies } = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  cookieJar: new Map<string, string>(),
  deletedCookies: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser, updateUser, signOut } })),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
    delete: (options: { name: string } | string) => {
      deletedCookies.push(typeof options === "string" ? options : options.name);
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

const { setNewPassword } = await import("@/app/auth/reset/actions");

async function submit(password: string, confirmPassword: string): Promise<string> {
  const form = new FormData();
  form.set("password", password);
  form.set("confirmPassword", confirmPassword);
  try {
    await setNewPassword(form);
  } catch (error) {
    if (error instanceof RedirectSignal) return error.location;
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  updateUser.mockReset().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  cookieJar.clear();
  cookieJar.set(RECOVERY_MARKER_COOKIE, signRecoveryMarker(USER_ID));
  deletedCookies.length = 0;
});

describe("setNewPassword — guards", () => {
  it("sends a signed-out caller to request a new link", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const location = await submit(GOOD_PASSWORD, GOOD_PASSWORD);

    expect(location).toBe(LINK_EXPIRED_LOCATION);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses a signed-in caller who did not arrive through a reset link", async () => {
    cookieJar.clear();

    const location = await submit(GOOD_PASSWORD, GOOD_PASSWORD);

    expect(location).toBe(LINK_EXPIRED_LOCATION);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses a recovery marker that belongs to a different account", async () => {
    cookieJar.set(RECOVERY_MARKER_COOKIE, signRecoveryMarker(OTHER_USER_ID));

    const location = await submit(GOOD_PASSWORD, GOOD_PASSWORD);

    expect(location).toBe(LINK_EXPIRED_LOCATION);
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("setNewPassword — input", () => {
  it("asks for a password when none is given", async () => {
    const location = await submit("", "");

    expect(location).toBe("/auth/reset?error=password_required");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("applies the registration minimum length", async () => {
    const location = await submit("short-7", "short-7");

    expect(location).toBe("/auth/reset?error=password_too_short");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("requires both fields to match", async () => {
    const location = await submit(GOOD_PASSWORD, "correct-horse-8");

    expect(location).toBe("/auth/reset?error=password_mismatch");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("keeps the recovery marker after an input error so the seller can retry", async () => {
    await submit("short-7", "short-7");

    expect(deletedCookies).toHaveLength(0);
  });
});

describe("setNewPassword — saving", () => {
  it("saves the password, signs out other devices, clears the marker and lands on /admin", async () => {
    const location = await submit(GOOD_PASSWORD, GOOD_PASSWORD);

    expect(location).toBe("/admin");
    expect(updateUser).toHaveBeenCalledWith({ password: GOOD_PASSWORD });
    expect(signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(deletedCookies).toEqual([RECOVERY_MARKER_COOKIE]);
  });

  it("maps a Supabase failure to a code, never a raw message", async () => {
    updateUser.mockResolvedValue({ data: { user: null }, error: { code: "unexpected_failure", message: "pg: boom" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const location = await submit(GOOD_PASSWORD, GOOD_PASSWORD);

    expect(location).toBe("/auth/reset?error=update_failed");
    expect(deletedCookies).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("tells the seller when the new password is the one they already had", async () => {
    updateUser.mockResolvedValue({ data: { user: null }, error: { code: "same_password", message: "same" } });

    const location = await submit(GOOD_PASSWORD, GOOD_PASSWORD);

    expect(location).toBe("/auth/reset?error=same_password");
  });

  it("still lands on /admin when signing out other devices fails", async () => {
    signOut.mockResolvedValue({ error: { message: "network" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const location = await submit(GOOD_PASSWORD, GOOD_PASSWORD);

    expect(location).toBe("/admin");
    vi.restoreAllMocks();
  });
});
