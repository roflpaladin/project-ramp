// Sprint 12, Ticket 65 — "Password Reset Flow" (security review MEDIUM-2/3).
// Component-level DOM assertions for app/auth/recover/page.tsx: the
// one-button step between the emailed link and the reset form. Rendering it
// must not touch Supabase — only the button's POST spends the token.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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

const { default: RecoverPage } = await import("@/app/auth/recover/page");

const TOKEN_HASH = "0fe8d90afc0c988c0d195cb11cb41b485929e8c7e4239904919caa92";

afterEach(() => {
  cleanup();
});

async function renderPage(tokenHash?: string) {
  const ui = await RecoverPage({ searchParams: Promise.resolve({ token_hash: tokenHash }) });
  return render(ui);
}

describe("RecoverPage", () => {
  it("renders exactly one button, named for the action", async () => {
    await renderPage(TOKEN_HASH);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Continue to set a new password");
  });

  it("carries the token in a hidden field for the POST", async () => {
    const { container } = await renderPage(TOKEN_HASH);

    const hidden = container.querySelector('input[type="hidden"][name="token_hash"]');
    expect(hidden).toHaveAttribute("value", TOKEN_HASH);
  });

  it("sends a visitor with no token to request a new link", async () => {
    await expect(renderPage()).rejects.toMatchObject({ location: "/forgot-password?error=link_expired" });
  });

  it("sends a visitor with a malformed token to request a new link", async () => {
    await expect(renderPage('"><script>alert(1)</script>')).rejects.toMatchObject({
      location: "/forgot-password?error=link_expired",
    });
  });
});
