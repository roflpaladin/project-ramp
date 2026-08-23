"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createFirstWorkspace, startWithSampleDeal } from "./onboarding-actions";
import {
  INITIAL_ONBOARDING_STATE,
  INVALID_DOMAIN_MESSAGE,
  MISSING_NAME_MESSAGE,
} from "./onboarding-state";
import "./onboarding.css";

/**
 * Sprint 8, Ticket 41 — guided first-run onboarding ("onboarding IS the
 * demo": the flagship flow walked through live on Sep 1). A two-step client
 * machine, entirely local state, no route change between steps:
 *
 *   "choose" — the first-run moment. Five population paths as cards: the
 *   sample deal (this step's one Signal, bound to startWithSampleDeal),
 *   manual (secondary, advances the machine to "manual"), CSV import
 *   (secondary, a real navigation link to /admin/import — Sprint 9, Ticket
 *   45, Phase 2b), and two honest, inert placeholders (from your website /
 *   from your CRM).
 *
 *   "manual" — two labelled fields bound to createFirstWorkspace, with a
 *   tertiary "Back" returning to "choose".
 *
 * Both server actions are useActionState-compatible per the T41 backend
 * contract (onboarding-actions.ts) and redirect on success — this component
 * only ever renders the "still here" (idle/pending/error) states; a
 * successful submit never returns here to be handled.
 *
 * Each step component owns its OWN useActionState call (review finding,
 * T41): hoisting both hooks into this parent looked rules-of-hooks-tidy but
 * meant a step's error state survived Back-then-forward navigation — the
 * remounted step showed a stale "Company name is required." alert and
 * aria-invalid on a freshly blank field. Steps are plain components rendered
 * conditionally, so a hook inside each is legal, and unmounting a step now
 * naturally discards its action state together with its local field state.
 * Only one step renders at a time, so exactly one `data-signal="true"`
 * element ever exists in the DOM (asserted in
 * tests/components/onboarding-flow.dom.spec.tsx for every step/state).
 */
type OnboardingStep = "choose" | "manual";

type InvalidField = "name" | "domain" | null;

/**
 * createFirstWorkspace (onboarding-actions.ts) returns one generic
 * `{ error }` string, not a field-scoped error shape — this maps its two
 * validation messages back to the field they describe, so `aria-invalid`
 * lands on the actual offending field. Compared with `===` against the SAME
 * constants the action itself returns (both imported from
 * ./onboarding-state.ts), so a future copy edit cannot silently detach the
 * field highlight from the message (review finding, T41). Any other error
 * (missing tenant, rate limit, insert failure) is a whole-form failure:
 * neither field is marked invalid, and the alert banner alone carries it.
 */
function invalidField(error: string | null): InvalidField {
  if (error === MISSING_NAME_MESSAGE) return "name";
  if (error === INVALID_DOMAIN_MESSAGE) return "domain";
  return null;
}

interface OnboardingSubmitButtonProps {
  label: string;
  pendingLabel: string;
  isPending: boolean;
  isPrimary: boolean;
}

/**
 * Shared submit-button presentation, copied from
 * app/admin/workspaces/[id]/invite-panel.tsx's InviteSubmitButton (T43):
 * the label stays in the DOM at opacity:0 while pending rather than being
 * removed, so the button never changes width, and the spinner itself is
 * `aria-hidden` since `aria-busy` + the accessible-name swap to
 * `pendingLabel` already say what's happening.
 */
function OnboardingSubmitButton({ label, pendingLabel, isPending, isPrimary }: OnboardingSubmitButtonProps) {
  return (
    <button
      type="submit"
      className={`ob-btn ${isPrimary ? "ob-btn-primary" : "ob-btn-secondary"}`}
      disabled={isPending}
      aria-busy={isPending}
      aria-label={isPending ? pendingLabel : undefined}
      data-signal={isPrimary ? "true" : undefined}
    >
      <span className="ob-btn-label" data-pending={isPending}>
        {label}
      </span>
      {isPending ? (
        <span className="ob-spinner" aria-hidden="true">
          <span className="ob-spinner-ring" />
        </span>
      ) : null}
    </button>
  );
}

function ErrorStatus({ message }: { message: string }) {
  return (
    <p className="ob-status" data-tone="risk" role="alert">
      <span className="ob-status-dot" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

interface PlaceholderCardProps {
  title: string;
  body: string;
}

/**
 * The two remaining honest, inert placeholders (from your website / from
 * your CRM — CSV import graduated to CsvImportCard below, Sprint 9, Ticket
 * 45, Phase 2b). A real `disabled` button — not a styled-to-look-disabled
 * `<div>` — for two reasons: it shares the exact same card anatomy as the
 * sample-deal and manual cards (title, body, action element), and native
 * `disabled` semantics already remove the control from the tab order, so it
 * is trivially "not a focus trap, keyboard-skippable" with no extra
 * aria-disabled/no-op wiring needed.
 */
function PlaceholderCard({ title, body }: PlaceholderCardProps) {
  return (
    <div className="ob-card">
      <h2 className="ob-card-title">{title}</h2>
      <p className="ob-card-body">{body}</p>
      <button type="button" className="ob-btn ob-btn-secondary" disabled>
        {title}
      </button>
    </div>
  );
}

/**
 * Sprint 9, Ticket 45, Phase 2b — the CSV import card, no longer a
 * placeholder: a real navigation link to /admin/import (csv-import-panel.tsx,
 * this same phase). Same card anatomy as PlaceholderCard/the manual card
 * (title, body, action element), secondary weight like "Set up manually" —
 * never `data-signal`, so "Start with a sample deal" stays this step's one
 * Signal.
 */
function CsvImportCard() {
  return (
    <div className="ob-card">
      <h2 className="ob-card-title">CSV import</h2>
      <p className="ob-card-body">Bring deal details in from a spreadsheet.</p>
      <Link href="/admin/import" className="ob-btn ob-btn-secondary">
        CSV import
      </Link>
    </div>
  );
}

function ChooseStep({ onManual }: { onManual: () => void }) {
  // Owned here, not in OnboardingFlow — unmounting this step (navigating to
  // "manual") discards any stale sample-seed error with it. See the header
  // comment.
  const [sampleState, sampleFormAction, isSamplePending] = useActionState(
    startWithSampleDeal,
    INITIAL_ONBOARDING_STATE,
  );

  return (
    <>
      <header className="ob-header">
        <h1 className="ob-title">Set up your first deal</h1>
        <p className="ob-intro">
          Bring in your own deal, or explore Ramp with a ready-made sample — you can always add more later.
        </p>
      </header>

      <div className="ob-grid">
        <form action={sampleFormAction} className="ob-card">
          <p className="ob-card-eyebrow">Recommended</p>
          <h2 className="ob-card-title">Start with a sample deal</h2>
          <p className="ob-card-body">A complete mid-market SaaS deal, ready to explore.</p>
          <OnboardingSubmitButton
            label="Start with a sample deal"
            pendingLabel="Setting up your sample deal"
            isPending={isSamplePending}
            isPrimary
          />
          {sampleState.error ? <ErrorStatus message={sampleState.error} /> : null}
        </form>

        <div className="ob-card">
          <h2 className="ob-card-title">Set up manually</h2>
          <p className="ob-card-body">Enter your buyer&apos;s company name and domain yourself.</p>
          <button type="button" className="ob-btn ob-btn-secondary" onClick={onManual}>
            Set up manually
          </button>
        </div>

        <CsvImportCard />
        <PlaceholderCard
          title="From your website"
          body="Pull company details from your buyer's website. Follows CRM import."
        />
        <PlaceholderCard
          title="From your CRM"
          body="Sync deal data directly from your CRM. Arrives next."
        />
      </div>
    </>
  );
}

function ManualStep({ onBack }: { onBack: () => void }) {
  // Owned here, not in OnboardingFlow — Back-then-forward remounts this step,
  // clearing both the fields below AND any previous submission's error state
  // together. See the header comment.
  const [manualState, manualFormAction, isManualPending] = useActionState(
    createFirstWorkspace,
    INITIAL_ONBOARDING_STATE,
  );

  const invalid = invalidField(manualState.error);

  // Controlled, not uncontrolled: React resets a form's fields after a
  // Server Action completes (mirroring native <form> submission behaviour),
  // which would otherwise wipe what the seller just typed the instant a
  // validation error comes back — the same reason invite-panel.tsx controls
  // its own email field via useState rather than leaving it uncontrolled.
  const [companyNameValue, setCompanyNameValue] = useState("");
  const [domainValue, setDomainValue] = useState("");

  return (
    <>
      <header className="ob-header">
        <h1 className="ob-title">Create your first workspace</h1>
        <p className="ob-intro">Tell us who the deal is with — you can fill in the rest once you&apos;re inside.</p>
      </header>

      <form action={manualFormAction} className="ob-form">
        <label className="ob-field">
          Company name
          <input
            className="ob-input"
            type="text"
            name="target_company_name"
            required
            value={companyNameValue}
            onChange={(event) => setCompanyNameValue(event.target.value)}
            disabled={isManualPending}
            aria-invalid={invalid === "name" ? true : undefined}
          />
        </label>
        <label className="ob-field">
          Their website domain
          <input
            className="ob-input"
            type="text"
            name="target_domain"
            placeholder="acme.com"
            required
            value={domainValue}
            onChange={(event) => setDomainValue(event.target.value)}
            disabled={isManualPending}
            aria-invalid={invalid === "domain" ? true : undefined}
          />
        </label>

        {manualState.error ? <ErrorStatus message={manualState.error} /> : null}

        <div className="ob-actions">
          <button type="button" className="ob-btn ob-btn-tertiary" onClick={onBack} disabled={isManualPending}>
            Back
          </button>
          <OnboardingSubmitButton
            label="Create workspace"
            pendingLabel="Creating workspace"
            isPending={isManualPending}
            isPrimary
          />
        </div>
      </form>
    </>
  );
}

export function OnboardingFlow() {
  const [step, setStep] = useState<OnboardingStep>("choose");

  return (
    <main className="ob-page" data-testid="onboarding-flow">
      {step === "choose" ? (
        <ChooseStep onManual={() => setStep("manual")} />
      ) : (
        <ManualStep onBack={() => setStep("choose")} />
      )}
    </main>
  );
}
