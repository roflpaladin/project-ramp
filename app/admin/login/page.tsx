import type { CSSProperties } from "react";
import { sendMagicLink, signIn } from "./actions";

// Sprint 8, Ticket 39 added the "Email me a sign-in link" option below the
// existing password form (kept as-is) — a <details> disclosure rather than a
// client-side tab switcher, so this page stays a plain Server Component with
// no new "use client" boundary, matching its existing style.
const MAGIC_LINK_SENT_MESSAGE = "If that email has an account, a sign-in link is on its way.";

const successStyle: CSSProperties = {
  margin: 0,
  padding: "0.5rem 0.75rem",
  borderRadius: "6px",
  background: "var(--wash-done)",
  color: "var(--state-done)",
  fontSize: "0.9rem",
};

// Explicit overrides for the global `button` rule in app/globals.css
// (background: var(--onyx); color: var(--paper)) — found live in dark-theme
// testing while building this page: [data-theme="dark"] sets --onyx and
// --paper to two near-identical near-blacks (#0d0e11 / #17181c), which
// collapses "Sign in" to unreadable text-on-background in dark mode. That
// rule is out of scope here (app/globals.css isn't an exclusive file for
// this ticket), so both buttons on this page get an explicit, theme-correct
// style instead — Signal for the primary action (password sign-in, the
// scope's one Signal), neutral ink/paper (which DOES flip correctly between
// themes) for the secondary magic-link action.
const primaryButtonStyle: CSSProperties = {
  background: "var(--signal)",
  color: "var(--signal-fg)",
  border: "none",
};

const secondaryButtonStyle: CSSProperties = {
  background: "var(--paper)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;
  const showSentConfirmation = sent === "1";

  return (
    <main>
      <h1>AE Login</h1>
      <form action={signIn}>
        <label>
          Email
          <input type="email" name="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        <button type="submit" style={primaryButtonStyle}>
          Sign in
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {showSentConfirmation ? (
        <p style={successStyle} role="status">
          {MAGIC_LINK_SENT_MESSAGE}
        </p>
      ) : null}

      <details>
        <summary>Email me a sign-in link instead</summary>
        <form action={sendMagicLink}>
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required />
          </label>
          <button type="submit" style={secondaryButtonStyle}>
            Send sign-in link
          </button>
        </form>
      </details>

      <p>
        New here? <a href="/register">Create an account</a>
      </p>
    </main>
  );
}
