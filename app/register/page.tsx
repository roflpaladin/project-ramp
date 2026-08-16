import type { CSSProperties } from "react";
import { registerSeller } from "./actions";

// Sprint 8, Ticket 39 — seller self-serve registration. Kept as a bare
// Server Component + native <form action> on purpose, matching the existing
// app/admin/login and app/admin/workspaces/new pages (no client JS, no
// useActionState) rather than inventing a new pattern for one page. Colour
// still comes exclusively from the app/globals.css custom properties (never
// a hardcoded hex) via inline `style`, since this route has no scoped CSS
// file of its own — see plan-details-form.tsx / create-plan-form.tsx for the
// same "var(--token)" inline-style precedent elsewhere in the app.
interface ErrorCopy {
  message: string;
  helpHref?: string;
  helpLabel?: string;
}

// Codes come from either this page's own pre-validation (invalid_input,
// invalid_email, password_too_short, rate_limited) or provisionSeller's
// ProvisionSellerError union (email_taken, invalid_input,
// provisioning_failed) — every code either source can produce is mapped
// here so a raw Supabase/internal string never reaches the user.
const ERROR_COPY: Record<string, ErrorCopy> = {
  invalid_input: { message: "Company name, work email and password are all required." },
  invalid_email: { message: "Enter a valid work email address." },
  password_too_short: { message: "Password must be at least 8 characters." },
  email_taken: {
    message: "That email already has an account — sign in instead.",
    helpHref: "/admin/login",
    helpLabel: "Sign in",
  },
  provisioning_failed: {
    message: "Something went wrong creating your account. Try again in a moment.",
  },
  rate_limited: { message: "Too many attempts. Try again in a few minutes." },
};
const DEFAULT_ERROR_MESSAGE = "Something went wrong. Try again.";

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.9rem",
};

const submitStyle: CSSProperties = {
  background: "var(--signal)",
  color: "var(--signal-fg)",
  border: "none",
};

const errorStyle: CSSProperties = {
  margin: 0,
  padding: "0.5rem 0.75rem",
  borderRadius: "6px",
  background: "var(--wash-risk)",
  color: "var(--state-risk)",
  fontSize: "0.9rem",
};

const helperStyle: CSSProperties = {
  color: "var(--slate)",
  fontSize: "0.9rem",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorCopy = error ? (ERROR_COPY[error] ?? { message: DEFAULT_ERROR_MESSAGE }) : null;

  return (
    <main data-surface="register">
      <h1>Create your Brava account</h1>
      <p style={helperStyle}>Set up your workspace and start your first success plan.</p>
      <form action={registerSeller}>
        <label style={fieldStyle}>
          Company name
          <input type="text" name="companyName" autoComplete="organization" required />
        </label>
        <label style={fieldStyle}>
          Work email
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label style={fieldStyle}>
          Password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        {errorCopy ? (
          <p style={errorStyle} role="alert">
            {errorCopy.message}
            {errorCopy.helpHref ? (
              <>
                {" "}
                <a href={errorCopy.helpHref}>{errorCopy.helpLabel}</a>
              </>
            ) : null}
          </p>
        ) : null}
        <button type="submit" style={submitStyle}>
          Create account
        </button>
      </form>
      <p style={helperStyle}>
        Already have an account? <a href="/admin/login">Sign in</a>
      </p>
    </main>
  );
}
