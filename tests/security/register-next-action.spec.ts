// Sprint 12, Ticket 67 — registerSeller honours a validated `next` and never
// an unsafe one. DB-free: supabase, provisioning, rate limit and
// next/navigation are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { provisionSeller, signInWithPassword, checkDurableRateLimit } = vi.hoisted(() => ({
  provisionSeller: vi.fn(),
  signInWithPassword: vi.fn(),
  checkDurableRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { signInWithPassword } })),
}));
vi.mock("@/lib/auth/provision-seller", () => ({ provisionSeller }));
vi.mock("@/lib/rate-limit-durable", () => ({ checkDurableRateLimit }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

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

const { registerSeller } = await import("@/app/register/actions");

function buildForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  const base = { companyName: "Acme", email: "a@acme.com", password: "longenough1" };
  for (const [key, value] of Object.entries({ ...base, ...fields })) form.set(key, value);
  return form;
}

async function submit(fields: Record<string, string>): Promise<string> {
  try {
    await registerSeller(buildForm(fields));
  } catch (err) {
    if (err instanceof RedirectSignal) return err.location;
    throw err;
  }
  throw new Error("registerSeller did not redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  checkDurableRateLimit.mockResolvedValue({ allowed: true });
  provisionSeller.mockResolvedValue({ ok: true });
  signInWithPassword.mockResolvedValue({ error: null });
});

describe("registerSeller — next", () => {
  it("redirects to a valid next on success", async () => {
    expect(await submit({ next: "/pricing" })).toBe("/pricing");
  });

  it("defaults to /admin/onboarding without next", async () => {
    expect(await submit({})).toBe("/admin/onboarding");
  });

  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "%2F%2Fevil.com", "/evil"])(
    "drops unsafe next %s on success",
    async (next) => {
      expect(await submit({ next })).toBe("/admin/onboarding");
    },
  );

  it("keeps a valid next on validation errors", async () => {
    expect(await submit({ next: "/pricing", password: "short" })).toBe(
      "/register?error=password_too_short&next=%2Fpricing",
    );
  });

  it("keeps a valid next on rate-limit errors", async () => {
    checkDurableRateLimit.mockResolvedValue({ allowed: false });
    expect(await submit({ next: "/pricing" })).toBe(
      "/register?error=rate_limited&next=%2Fpricing",
    );
  });

  it("keeps a valid next on provision errors", async () => {
    provisionSeller.mockResolvedValue({ ok: false, code: "email_taken" });
    expect(await submit({ next: "/settings/billing" })).toBe(
      "/register?error=email_taken&next=%2Fsettings%2Fbilling",
    );
  });

  it("drops a malicious next on the error redirect", async () => {
    expect(await submit({ next: "//evil.com", password: "short" })).toBe(
      "/register?error=password_too_short",
    );
  });

  it("leaves the sign-in-failed fallback pointing at login without next", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "x" } });
    const location = await submit({ next: "/pricing" });
    expect(location.startsWith("/admin/login?error=")).toBe(true);
    expect(new URL(location, "http://x").searchParams.has("next")).toBe(false);
  });
});
