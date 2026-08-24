"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createWorkspace } from "./new-workspace-actions";
import { INITIAL_NEW_WORKSPACE_STATE, INVALID_DOMAIN_MESSAGE, MISSING_NAME_MESSAGE } from "./workspace-form-state";
import { useCompanyNamePrefill } from "@/lib/use-company-name-prefill";
import { CompanyNameSuggestion } from "@/components/company-name-suggestion";
import "./new-workspace-form.css";

/**
 * Ticket 45 (Sprint 9), Phase 2b. Rebuild of the legacy `<form
 * action={createWorkspace}>` (plain server action, raw `error.message` in a
 * redirect query string) onto this codebase's standard useActionState shape
 * — copied structurally from app/admin/workspaces/[id]/invite-panel.tsx's
 * InvitePanel and app/admin/onboarding/onboarding-flow.tsx's ManualStep
 * (same two fields, same action, this form's manual step and this page are
 * functionally the same operation).
 *
 * One Signal per decision scope (design system MUST): "Create workspace" is
 * this page's sole `data-signal="true"` element. "Back to workspaces" is a
 * plain navigation link, not a second primary.
 */
export function NewWorkspaceForm() {
  const [state, formAction, isCreating] = useActionState(createWorkspace, INITIAL_NEW_WORKSPACE_STATE);

  // Controlled, not uncontrolled — same reasoning as invite-panel.tsx's email
  // field and onboarding-flow.tsx's ManualStep: React resets a form's fields
  // after a Server Action completes, which would otherwise wipe what the
  // seller just typed the instant a validation error comes back.
  //
  // Sprint 9, Ticket 46 — "populate from a link" wiring (both fields'
  // controlled state, the scrape-meta call, and the suggestion/hint
  // affordance below) lives in the shared lib/use-company-name-prefill.ts —
  // see that file's header comment for the full rationale. Same hook as
  // onboarding-flow.tsx's ManualStep (T46's other call site); extracted post
  // review (HIGH finding) so neither call site re-implements it.
  const {
    companyNameValue,
    domainValue,
    suggestedName,
    scrapeStatus,
    onCompanyNameChange,
    onDomainChange,
    onDomainBlur,
    applySuggestedName,
  } = useCompanyNamePrefill();

  const invalidField =
    state.error === MISSING_NAME_MESSAGE ? "name" : state.error === INVALID_DOMAIN_MESSAGE ? "domain" : null;

  return (
    <section className="wf-card" data-surface="new-workspace-form" data-testid="new-workspace-form">
      <h1 className="wf-title">Create a workspace</h1>
      <p className="wf-intro">Tell us who the deal is with — you can fill in the rest once you&apos;re inside.</p>

      <form action={formAction} className="wf-form">
        <label className="wf-field">
          Company name
          <input
            className="wf-input"
            type="text"
            name="target_company_name"
            required
            value={companyNameValue}
            onChange={onCompanyNameChange}
            disabled={isCreating}
            aria-invalid={invalidField === "name" ? true : undefined}
            aria-describedby={invalidField === "name" ? "wf-error" : undefined}
          />
        </label>
        <label className="wf-field">
          Their website domain
          <input
            className="wf-input"
            type="text"
            name="target_domain"
            placeholder="acme.com"
            required
            value={domainValue}
            onChange={onDomainChange}
            onBlur={onDomainBlur}
            disabled={isCreating}
            aria-invalid={invalidField === "domain" ? true : undefined}
            aria-describedby={invalidField === "domain" ? "wf-error" : undefined}
          />
        </label>

        <CompanyNameSuggestion
          classPrefix="wf"
          suggestedName={suggestedName}
          scrapeStatus={scrapeStatus}
          onApply={applySuggestedName}
        />

        {state.error ? (
          <p className="wf-status" data-tone="risk" role="alert" id="wf-error">
            <span className="wf-status-dot" aria-hidden="true" />
            <span>{state.error}</span>
          </p>
        ) : null}

        <div className="wf-actions">
          <Link href="/admin" className="wf-btn wf-btn-tertiary">
            Back to workspaces
          </Link>
          <button
            type="submit"
            className="wf-btn wf-btn-primary"
            disabled={isCreating}
            aria-busy={isCreating}
            aria-label={isCreating ? "Creating workspace" : undefined}
            data-signal="true"
          >
            <span className="wf-btn-label" data-pending={isCreating}>
              Create workspace
            </span>
            {isCreating ? (
              <span className="wf-spinner" aria-hidden="true">
                <span className="wf-spinner-ring" />
              </span>
            ) : null}
          </button>
        </div>
      </form>
    </section>
  );
}
