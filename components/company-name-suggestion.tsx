"use client";

import type { ScrapeMetaPrefillStatus } from "@/lib/use-scrape-meta-prefill";

export type CompanyNameSuggestionClassPrefix = "ob" | "wf";

export interface CompanyNameSuggestionProps {
  readonly classPrefix: CompanyNameSuggestionClassPrefix;
  readonly suggestedName: string | null;
  readonly scrapeStatus: ScrapeMetaPrefillStatus;
  readonly onApply: () => void;
}

/**
 * Sprint 9, Ticket 46 — the "populate from a link" suggestion button + quiet
 * failure hint, shared by ManualStep (onboarding-flow.tsx) and
 * NewWorkspaceForm (new-workspace-form.tsx). Extracted post-review (HIGH
 * finding: identical JSX at both call sites, only the `ob-`/`wf-` class
 * prefix differing) — `classPrefix` selects which surface's already-defined
 * classes (onboarding.css / new-workspace-form.css, both under their own
 * "populate from a link" section) render this, so no new class name is
 * introduced anywhere and each surface's existing tokens/dark-mode styling
 * apply unchanged.
 *
 * Review finding (HIGH, accessibility): the suggestion button and the
 * "Couldn't fetch details" hint both appear asynchronously, well after the
 * domain field's blur event has already finished — with no synchronous
 * focus change, a screen-reader user would otherwise never learn either
 * exists. `aria-live="polite"` on this wrapper (never `role="alert"` — the
 * failure hint is a quiet, non-blocking degrade, not an error) announces
 * whichever one lands. For that announcement to fire, this wrapper must
 * already be part of the DOM/accessibility tree *before* the content
 * changes — so it always renders, even with nothing to show yet.
 * `display: contents` (declared on `.ob-scrape-live`/`.wf-scrape-live` in
 * each surface's CSS) keeps it present for that purpose while removing it
 * from the flex box tree, so it never becomes a visible empty flex item and
 * its children take the exact same `gap`-governed layout slot the two
 * conditionals occupied before this wrapper existed.
 */
export function CompanyNameSuggestion({ classPrefix, suggestedName, scrapeStatus, onApply }: CompanyNameSuggestionProps) {
  return (
    <div aria-live="polite" className={`${classPrefix}-scrape-live`}>
      {suggestedName ? (
        <button
          type="button"
          className={`${classPrefix}-btn ${classPrefix}-btn-tertiary ${classPrefix}-scrape-suggestion`}
          onClick={onApply}
        >
          {`Use "${suggestedName}" as the company name`}
        </button>
      ) : null}
      {scrapeStatus === "unavailable" ? (
        <p className={`${classPrefix}-scrape-hint`}>Couldn&apos;t fetch details — enter them manually.</p>
      ) : null}
    </div>
  );
}
