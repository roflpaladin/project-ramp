// Sprint 8, Ticket 39 — seller self-serve registration. Component-level DOM
// assertions for app/register/page.tsx, mirroring the render-the-async-
// server-component-directly technique used for other RSC pages in this
// suite: RegisterPage is `async`, so it's awaited for its JSX and that JSX
// is handed to RTL's render(), exactly as a Next.js server render would
// produce it. Runs under the "components" Vitest project (happy-dom) — see
// vitest.config.ts. No network/Supabase calls happen here: the page only
// wires <form action={registerSeller}> to a server action, it never calls
// it directly, so nothing in lib/auth or lib/rate-limit executes.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import RegisterPage from "@/app/register/page";

afterEach(() => {
  cleanup();
});

async function renderRegisterPage(error?: string) {
  const ui = await RegisterPage({ searchParams: Promise.resolve({ error }) });
  return render(ui);
}

describe("RegisterPage — fields", () => {
  it("renders company name, work email and password fields, all required", async () => {
    await renderRegisterPage();

    const companyName = screen.getByLabelText("Company name");
    const email = screen.getByLabelText("Work email");
    const password = screen.getByLabelText("Password");

    expect(companyName).toBeRequired();
    expect(email).toBeRequired();
    expect(email).toHaveAttribute("type", "email");
    expect(password).toBeRequired();
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("minLength", "8");
  });

  it("renders a submit button labelled 'Create account', enabled by default", async () => {
    // No client-side pending state exists on this page (plain Server
    // Component + native <form action>, matching app/admin/login and
    // app/admin/workspaces/new — no useActionState/useFormStatus here), so
    // there is no "disabled while pending" behaviour to assert; this just
    // pins the button's default (non-disabled) state.
    await renderRegisterPage();

    const submit = screen.getByRole("button", { name: "Create account" });
    expect(submit).toBeEnabled();
  });

  it("links to /admin/login for an existing seller", async () => {
    await renderRegisterPage();

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/admin/login");
  });
});

describe("RegisterPage — error copy", () => {
  it("renders no error banner when the error search param is absent", async () => {
    await renderRegisterPage();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("maps 'invalid_input' to human copy naming all three fields", async () => {
    await renderRegisterPage("invalid_input");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Company name, work email and password are all required.",
    );
  });

  it("maps 'password_too_short' to the 8-character requirement", async () => {
    await renderRegisterPage("password_too_short");

    expect(screen.getByRole("alert")).toHaveTextContent("Password must be at least 8 characters.");
  });

  it("maps 'rate_limited' to a recoverable retry message, never a raw limiter code", async () => {
    await renderRegisterPage("rate_limited");

    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts. Try again in a few minutes.");
  });

  it("maps 'email_taken' to copy with a recovery link to sign in, not a dead end", async () => {
    await renderRegisterPage("email_taken");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("That email already has an account — sign in instead.");
    // Two "Sign in" links now exist on the page (the error banner's recovery
    // link and the footer's), so scope the query to inside the alert.
    const { getByRole } = within(alert);
    expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/admin/login");
  });

  it("falls back to a generic recoverable message for an unrecognised error code", async () => {
    await renderRegisterPage("something_unexpected");

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });
});
