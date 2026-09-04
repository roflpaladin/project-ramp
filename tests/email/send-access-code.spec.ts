// T43 (Sprint 8, Ticket 43 — "Own-inbox buyer invite & instant flip"), updated
// for T57 (Sprint 11, Ticket 57 — "Transactional email deliverability").
// Pure unit coverage for lib/email/send-access-code.ts: the optional
// `portalUrl` link and the Brava-branded subject/copy added for the invite
// flow, now sent via Resend instead of nodemailer/SMTP. Deliberately does
// not touch the real Resend API -- mocks ONLY the `resend` SDK, so
// sendAccessCodeEmail's own env-var validation, its delegation to
// lib/email/templates/access-code.ts, and the { ok: boolean } return
// contract all run for real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SentEmail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

interface SendResult {
  readonly data: { id: string } | null;
  readonly error: { name: string; message: string; statusCode: number | null } | null;
}

const send = vi.fn(async (_mail: SentEmail): Promise<SendResult> => ({ data: { id: "test" }, error: null }));

// `Resend` must be a constructible class (used as `new Resend(apiKey)` in
// lib/email/send-access-code.ts) -- vi.fn()'s mockImplementation only
// accepts a plain function/arrow implementation, neither of which vitest
// will invoke with `new`, so this mocks the export with a real (if trivial)
// class instead.
class MockResend {
  emails = { send };
}

vi.mock("resend", () => ({ Resend: MockResend }));

const { sendAccessCodeEmail } = await import("@/lib/email/send-access-code");

const REQUIRED_ENV = {
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM: "Brava <noreply@getbrava.tech>",
} as const;

describe("sendAccessCodeEmail (T43, updated T57)", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of Object.keys(REQUIRED_ENV) as (keyof typeof REQUIRED_ENV)[]) {
      originalEnv[key] = process.env[key];
      process.env[key] = REQUIRED_ENV[key];
    }
    send.mockClear();
  });

  afterEach(() => {
    for (const key of Object.keys(REQUIRED_ENV)) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("uses the Brava-branded subject on the user-facing send, per product naming rules", async () => {
    const result = await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234" });

    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0][0];
    expect(call.subject).toBe("Your Brava deal room access code");
    expect(call.text).toContain("Brava");
    expect(call.html).toContain("Brava");
  });

  it("sends from RESEND_FROM and to the given recipient", async () => {
    await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234" });

    const call = send.mock.calls[0][0];
    expect(call.from).toBe(REQUIRED_ENV.RESEND_FROM);
    expect(call.to).toBe("buyer@example.invalid");
  });

  it("omits any deal-room link when no portalUrl is given (unchanged existing-caller behaviour)", async () => {
    await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234" });

    const call = send.mock.calls[0][0];
    expect(call.text).not.toContain("http");
    expect(call.html).not.toContain("<a ");
  });

  it("includes an 'Open your deal room' link in both text and html bodies when portalUrl is given", async () => {
    const portalUrl = "https://getbrava.tech/portal/7e570000-0000-4000-8000-000000004302";

    await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234", portalUrl });

    const call = send.mock.calls[0][0];
    expect(call.text).toContain("Open your deal room");
    expect(call.text).toContain(portalUrl);
    expect(call.html).toContain("Open your deal room");
    expect(call.html).toContain(`href="${portalUrl}"`);
  });

  it("still reports { ok: false } and sends nothing when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;

    const result = await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234" });

    expect(result).toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("still reports { ok: false } and sends nothing when RESEND_FROM is missing", async () => {
    delete process.env.RESEND_FROM;

    const result = await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234" });

    expect(result).toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("still reports { ok: false } without throwing when Resend resolves an API-level error", async () => {
    send.mockResolvedValueOnce({
      data: null,
      error: { name: "invalid_api_key", message: "API key is invalid", statusCode: 401 },
    });

    const result = await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234" });

    expect(result).toEqual({ ok: false });
  });

  it("still reports { ok: false } when the SDK call rejects (network failure), without throwing", async () => {
    send.mockRejectedValueOnce(new Error("network down"));

    const result = await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234" });

    expect(result).toEqual({ ok: false });
  });

  it("escapes a hostile portalUrl before interpolating it into the html body (T43 security review)", async () => {
    // portalUrl can be derived from forwarded request headers upstream
    // (invite-actions.ts's buildPortalUrl) — a value carrying `"` or `<` must
    // not break out of the href attribute or inject markup into an email we
    // send to a third party.
    const portalUrl = 'https://getbrava.tech/portal/x"><script>alert(1)</script>';

    await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234", portalUrl });

    const call = send.mock.calls[0][0];
    expect(call.html).not.toContain('"><script>');
    expect(call.html).toContain("&quot;&gt;&lt;script&gt;");
  });
});
