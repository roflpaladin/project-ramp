"use client";

import { useState, type FormEvent } from "react";

/**
 * T47 (Sprint 9, Ticket 47 — public landing page, phase 1). The landing
 * page's default CTA (lib/landing/mode.ts, "waitlist" mode). POSTs
 * `{ email }` as JSON to /api/waitlist — a Route Handler built in parallel
 * by the backend agent (out of this file's scope; see the ticket brief's
 * contract). Plain useState, not useActionState: this hits a Route Handler
 * over fetch, not a "use server" Server Action, so there is no
 * action/pending machinery to plug into.
 *
 * Handled defensively per the contract: ANY 2xx response is success (the
 * exact envelope shape is the backend's to evolve — this never depends on
 * response body fields beyond status), 429 gets its own "too many
 * attempts" copy, and every other failure (other non-2xx status, or fetch
 * itself throwing on a network error) collapses to the same generic
 * recoverable message. The success confirmation is identical whichever way
 * the request actually resolved server-side, so there is no way to tell
 * from this UI whether the email had already been on the list.
 *
 * Pending presentation copies the house pattern (onboarding-flow.tsx's
 * OnboardingSubmitButton, invite-panel.tsx's InviteSubmitButton): the label
 * stays in the DOM at opacity:0 while submitting rather than being removed,
 * so the button never changes width, and the spinner is aria-hidden since
 * aria-busy + the accessible-name swap already say what's happening.
 */
type SubmitStatus = "idle" | "submitting" | "success" | "error";

const RATE_LIMITED_MESSAGE = "Too many attempts. Try again shortly.";
const GENERIC_ERROR_MESSAGE = "Something went wrong. Try again.";
const SUCCESS_MESSAGE = "You're on the list — we'll email you when Brava is ready.";
const RATE_LIMIT_STATUS = 429;

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setStatus("success");
        return;
      }

      setStatus("error");
      setErrorMessage(response.status === RATE_LIMIT_STATUS ? RATE_LIMITED_MESSAGE : GENERIC_ERROR_MESSAGE);
    } catch {
      setStatus("error");
      setErrorMessage(GENERIC_ERROR_MESSAGE);
    }
  }

  if (status === "success") {
    return (
      <p className="lp-status" data-tone="done" role="status">
        <span className="lp-status-dot" aria-hidden="true" />
        <span>{SUCCESS_MESSAGE}</span>
      </p>
    );
  }

  const isSubmitting = status === "submitting";

  return (
    <form className="lp-form" onSubmit={handleSubmit} data-testid="waitlist-form">
      <label className="lp-field" htmlFor="waitlist-email">
        Work email
        <input
          id="waitlist-email"
          className="lp-input"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isSubmitting}
          aria-invalid={status === "error" ? true : undefined}
        />
      </label>

      {status === "error" && errorMessage ? (
        <p className="lp-status" data-tone="risk" role="alert">
          <span className="lp-status-dot" aria-hidden="true" />
          <span>{errorMessage}</span>
        </p>
      ) : null}

      <button
        type="submit"
        className="lp-btn lp-btn-primary"
        data-signal="true"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        aria-label={isSubmitting ? "Joining waitlist" : undefined}
      >
        <span className="lp-btn-label" data-pending={isSubmitting}>
          Join the waitlist
        </span>
        {isSubmitting ? (
          <span className="lp-spinner" aria-hidden="true">
            <span className="lp-spinner-ring" />
          </span>
        ) : null}
      </button>
    </form>
  );
}
