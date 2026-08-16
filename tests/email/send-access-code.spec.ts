// T43 (Sprint 8, Ticket 43 — "Own-inbox buyer invite & instant flip").
// Pure unit coverage for lib/email/send-access-code.ts: the optional
// `portalUrl` link and the Brava-branded subject/copy added for the invite
// flow. Deliberately does NOT touch the real SMTP transport — .env.local
// ships a PLACEHOLDER SMTP_HOST ("smtp.your-provider.com"), and nodemailer's
// default connection timeout (2 minutes) would starve this file past
// Vitest's testTimeout, exactly as tests/api/send-token.spec.ts's header
// comment documents for the same reason. Mocks ONLY `nodemailer` itself (the
// transport), so sendAccessCodeEmail's own env-var validation, subject/body
// construction, and the { ok: boolean } return contract all run for real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SentMail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const sendMail = vi.fn(async (_mail: SentMail) => ({ messageId: "test" }));
const createTransport = vi.fn((..._args: unknown[]) => ({ sendMail }));

vi.mock("nodemailer", () => ({
  default: { createTransport: (...args: unknown[]) => createTransport(...args) },
}));

const { sendAccessCodeEmail } = await import("@/lib/email/send-access-code");

const REQUIRED_ENV = {
  SMTP_HOST: "smtp.test.invalid",
  SMTP_PORT: "587",
  SMTP_USER: "test-user",
  SMTP_PASSWORD: "test-password",
  SMTP_FROM: "noreply@getbrava.io",
} as const;

describe("sendAccessCodeEmail (T43)", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of Object.keys(REQUIRED_ENV) as (keyof typeof REQUIRED_ENV)[]) {
      originalEnv[key] = process.env[key];
      process.env[key] = REQUIRED_ENV[key];
    }
    sendMail.mockClear();
    createTransport.mockClear();
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
    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0][0];
    expect(call.subject).toBe("Your Brava deal room access code");
    expect(call.text).toContain("Brava");
    expect(call.html).toContain("Brava");
  });

  it("omits any deal-room link when no portalUrl is given (unchanged existing-caller behaviour)", async () => {
    await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234" });

    const call = sendMail.mock.calls[0][0];
    expect(call.text).not.toContain("http");
    expect(call.html).not.toContain("<a ");
  });

  it("includes an 'Open your deal room' link in both text and html bodies when portalUrl is given", async () => {
    const portalUrl = "https://getbrava.io/portal/7e570000-0000-4000-8000-000000004302";

    await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234", portalUrl });

    const call = sendMail.mock.calls[0][0];
    expect(call.text).toContain("Open your deal room");
    expect(call.text).toContain(portalUrl);
    expect(call.html).toContain("Open your deal room");
    expect(call.html).toContain(`href="${portalUrl}"`);
  });

  it("still reports { ok: false } and sends nothing when SMTP env vars are missing", async () => {
    delete process.env.SMTP_HOST;

    const result = await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234" });

    expect(result).toEqual({ ok: false });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("still reports { ok: false } when the transport rejects, without throwing", async () => {
    sendMail.mockRejectedValueOnce(new Error("smtp down"));

    const result = await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234" });

    expect(result).toEqual({ ok: false });
  });

  it("escapes a hostile portalUrl before interpolating it into the html body (T43 security review)", async () => {
    // portalUrl can be derived from forwarded request headers upstream
    // (invite-actions.ts's buildPortalUrl) — a value carrying `"` or `<` must
    // not break out of the href attribute or inject markup into an email we
    // send to a third party.
    const portalUrl = 'https://getbrava.io/portal/x"><script>alert(1)</script>';

    await sendAccessCodeEmail({ to: "buyer@example.invalid", code: "1234", portalUrl });

    const call = sendMail.mock.calls[0][0];
    expect(call.html).not.toContain('"><script>');
    expect(call.html).toContain("&quot;&gt;&lt;script&gt;");
  });
});
