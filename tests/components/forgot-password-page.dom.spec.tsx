// Sprint 12, Ticket 65 — "Password Reset Flow". Component-level DOM
// assertions for app/forgot-password/page.tsx, using the same
// render-the-async-server-component-directly technique as
// register-page.dom.spec.tsx. No network/Supabase calls: the page only wires
// <form action={requestReset}>, it never calls it.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ForgotPasswordPage from "@/app/forgot-password/page";

afterEach(() => {
  cleanup();
});

async function renderPage(params: { error?: string; sent?: string } = {}) {
  const ui = await ForgotPasswordPage({ searchParams: Promise.resolve(params) });
  return render(ui);
}

describe("ForgotPasswordPage — request form", () => {
  it("renders a single required email field with its label above it", async () => {
    await renderPage();

    const email = screen.getByLabelText("Email");
    expect(email).toBeRequired();
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).not.toHaveAttribute("placeholder");
  });

  it("renders exactly one button, named for the action", async () => {
    await renderPage();

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Send reset link");
  });

  it("links back to sign in", async () => {
    await renderPage();

    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/admin/login");
  });

  it("shows no status or alert by default", async () => {
    await renderPage();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("ForgotPasswordPage — after sending", () => {
  it("shows the neutral confirmation as a dot plus text, never naming whether an account exists", async () => {
    await renderPage({ sent: "1" });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("If an account exists for that email, a reset link is on its way.");
    expect(status.querySelector("[data-status-dot]")).not.toBeNull();
  });

  it("replaces the form with a way to try a different email", async () => {
    await renderPage({ sent: "1" });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Use a different email" })).toHaveAttribute("href", "/forgot-password");
  });
});

describe("ForgotPasswordPage — error copy", () => {
  it("explains an expired or used link and keeps the request form in place", async () => {
    await renderPage({ error: "link_expired" });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("That reset link has expired or was already used. Request a new one.");
    expect(alert.querySelector("[data-status-dot]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
  });

  it("maps 'invalid_email' to human copy", async () => {
    await renderPage({ error: "invalid_email" });

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
  });

  it("falls back to a generic message for an unrecognised code, never echoing it", async () => {
    await renderPage({ error: "<script>alert(1)</script>" });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Try again.");
    expect(alert).not.toHaveTextContent("script");
  });
});
