// Sprint 12, Ticket 65 — "Password Reset Flow". Unit coverage for the pure
// template function behind the password-reset email, independent of any
// email provider. Same shape as tests/email/templates/access-code.spec.ts.

import { describe, expect, it } from "vitest";

import { buildResetPasswordEmail } from "@/lib/email/templates/reset-password";

const RESET_URL = "https://www.getbrava.tech/auth/confirm?token_hash=abc123&type=recovery";

describe("buildResetPasswordEmail", () => {
  it("returns a Brava-branded, sentence-case subject", () => {
    const result = buildResetPasswordEmail({ resetUrl: RESET_URL });

    expect(result.subject).toBe("Reset your Brava password");
  });

  it("carries the reset link in both bodies", () => {
    const result = buildResetPasswordEmail({ resetUrl: RESET_URL });

    expect(result.text).toContain(RESET_URL);
    expect(result.html).toContain('href="https://www.getbrava.tech/auth/confirm?token_hash=abc123&amp;type=recovery"');
  });

  it("names the action with the same words the app uses", () => {
    const result = buildResetPasswordEmail({ resetUrl: RESET_URL });

    expect(result.html).toContain("Set a new password");
    expect(result.text).toContain("Set a new password");
  });

  it("tells a reader who did not ask for this that nothing changes", () => {
    const result = buildResetPasswordEmail({ resetUrl: RESET_URL });

    expect(result.text).toContain("If you did not ask for this, ignore this email. Your password stays the same.");
    expect(result.html).toContain("If you did not ask for this, ignore this email. Your password stays the same.");
  });

  it("uses no exclamation marks (system copy rule)", () => {
    const result = buildResetPasswordEmail({ resetUrl: RESET_URL });

    expect(result.subject).not.toContain("!");
    expect(result.text).not.toContain("!");
  });

  it("escapes a hostile url before interpolating it into the html body", () => {
    const resetUrl = 'https://www.getbrava.tech/auth/confirm?x="><script>alert(1)</script>';

    const result = buildResetPasswordEmail({ resetUrl });

    expect(result.html).not.toContain('"><script>');
    expect(result.html).toContain("&quot;&gt;&lt;script&gt;");
  });
});
