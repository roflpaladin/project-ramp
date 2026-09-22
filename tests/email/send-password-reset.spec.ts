// Sprint 12, Ticket 65 — "Password Reset Flow". Pure unit coverage for
// lib/email/send-password-reset.ts. Mirrors
// tests/email/send-access-code.spec.ts: mocks ONLY the `resend` SDK, so the
// sender's own env-var validation, its delegation to the template, and the
// { ok: boolean } return contract all run for real.

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

// `Resend` is used as `new Resend(apiKey)`, so the mock must be a real class.
class MockResend {
  emails = { send };
}

vi.mock("resend", () => ({ Resend: MockResend }));

const { sendPasswordResetEmail } = await import("@/lib/email/send-password-reset");

const RESET_URL = "https://www.getbrava.tech/auth/confirm?token_hash=abc123&type=recovery";
const RECIPIENT = "seller@example.com";

describe("sendPasswordResetEmail", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("RESEND_FROM", "Brava <noreply@getbrava.tech>");
    send.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends the branded reset email to the recipient", async () => {
    const result = await sendPasswordResetEmail({ to: RECIPIENT, resetUrl: RESET_URL });

    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe(RECIPIENT);
    expect(mail.from).toBe("Brava <noreply@getbrava.tech>");
    expect(mail.subject).toBe("Reset your Brava password");
    expect(mail.text).toContain(RESET_URL);
  });

  it("returns ok:false and sends nothing when Resend is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");

    const result = await sendPasswordResetEmail({ to: RECIPIENT, resetUrl: RESET_URL });

    expect(result).toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("returns ok:false when Resend rejects the send", async () => {
    send.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "domain not verified", statusCode: 403 },
    });

    const result = await sendPasswordResetEmail({ to: RECIPIENT, resetUrl: RESET_URL });

    expect(result).toEqual({ ok: false });
  });

  it("returns ok:false (never throws) on a network failure", async () => {
    send.mockRejectedValueOnce(new Error("socket hang up"));

    const result = await sendPasswordResetEmail({ to: RECIPIENT, resetUrl: RESET_URL });

    expect(result).toEqual({ ok: false });
  });

  it("never writes the reset link or its token to the log", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    send.mockRejectedValueOnce(new Error("socket hang up"));

    await sendPasswordResetEmail({ to: RECIPIENT, resetUrl: RESET_URL });

    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("abc123");
  });
});
