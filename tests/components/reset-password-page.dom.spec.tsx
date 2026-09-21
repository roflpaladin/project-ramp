// Sprint 12, Ticket 65 — "Password Reset Flow". Component-level DOM
// assertions for app/auth/reset/page.tsx. /auth/* is outside the middleware
// matcher, so the page itself must refuse anyone who did not just arrive
// through a verified reset link — that guard
// (lib/auth/recovery-session.ts's hasRecoverySession) is mocked here and
// covered on its own in tests/auth/reset-password-action.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { recoverySession } = vi.hoisted(() => ({
  recoverySession: { value: true },
}));

vi.mock("@/lib/auth/recovery-session", () => ({
  hasRecoverySession: vi.fn(async () => recoverySession.value),
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

const { default: ResetPasswordPage } = await import("@/app/auth/reset/page");

beforeEach(() => {
  recoverySession.value = true;
});

afterEach(() => {
  cleanup();
});

async function renderPage(error?: string) {
  const ui = await ResetPasswordPage({ searchParams: Promise.resolve({ error }) });
  return render(ui);
}

describe("ResetPasswordPage — guard", () => {
  it("sends a visitor without a verified reset link to request a new one", async () => {
    recoverySession.value = false;

    await expect(renderPage()).rejects.toMatchObject({ location: "/forgot-password?error=link_expired" });
  });
});

describe("ResetPasswordPage — form", () => {
  it("renders password and confirm fields with the registration minimum length", async () => {
    await renderPage();

    const password = screen.getByLabelText("New password");
    const confirm = screen.getByLabelText("Confirm new password");

    for (const field of [password, confirm]) {
      expect(field).toBeRequired();
      expect(field).toHaveAttribute("type", "password");
      expect(field).toHaveAttribute("autocomplete", "new-password");
      expect(field).toHaveAttribute("minLength", "8");
    }
  });

  it("states the length rule up front", async () => {
    await renderPage();

    expect(screen.getByText("At least 8 characters.")).toBeInTheDocument();
  });

  it("renders exactly one button, named for the action", async () => {
    await renderPage();

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Set new password");
  });
});

describe("ResetPasswordPage — error copy", () => {
  it.each([
    ["password_required", "Enter a new password in both fields."],
    ["password_too_short", "Password must be at least 8 characters."],
    ["password_mismatch", "The two passwords do not match. Enter the same password in both fields."],
    ["same_password", "That is your current password. Choose a different one."],
    ["update_failed", "Your password was not changed. Try again in a moment."],
  ])("maps '%s' to human copy with a status dot", async (code, message) => {
    await renderPage(code);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert.querySelector("[data-status-dot]")).not.toBeNull();
  });

  it("falls back to a generic message for an unrecognised code", async () => {
    await renderPage("pg: boom");

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });
});
