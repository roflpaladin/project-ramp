// Sprint 12, Ticket 65 — "Password Reset Flow". Pins the one thing T65 adds
// to app/admin/login/page.tsx: the way into the reset flow. Same
// render-the-async-server-component-directly technique as
// register-page.dom.spec.tsx; no server action runs.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import LoginPage from "@/app/admin/login/page";

afterEach(() => {
  cleanup();
});

describe("LoginPage — forgot password", () => {
  it("links to the password reset request page", async () => {
    const ui = await LoginPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
  });

  it("keeps password sign-in as the page's primary action", async () => {
    const ui = await LoginPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});
