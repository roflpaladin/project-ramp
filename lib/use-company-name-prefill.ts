"use client";

import { useCallback, useRef, useState, type ChangeEvent, type FocusEvent } from "react";
import { useScrapeMetaPrefill, type ScrapeMetaPrefillStatus } from "@/lib/use-scrape-meta-prefill";

// Sprint 9, Ticket 46 — "populate from a link" wiring for the manual
// workspace-creation fields, shared by ManualStep (onboarding-flow.tsx) and
// NewWorkspaceForm (new-workspace-form.tsx). Extracted post-review (HIGH
// finding: both call sites duplicated this entire block — the live ref, the
// suggestedName state, the useScrapeMetaPrefill callback, applySuggestedName,
// and the two fields' change/blur wiring — with only their `ob-`/`wf-` class
// prefixes differing). This is now the SINGLE implementation; both call
// sites consume it as-is.
//
// Calls the EXISTING Sprint 2, Ticket 12 scrape-meta endpoint
// (app/api/scrape-meta/route.ts) via lib/use-scrape-meta-prefill.ts only —
// that hook owns the endpoint-contract detail (request/response shape,
// SSRF-guard boundary, timeout/failure degrade) in its own header comment;
// this hook is purely about composing it with the two controlled form
// fields. Tertiary, best-effort: on success with an empty company-name field
// it prefills silently (matches the existing link-url-field.tsx precedent);
// with a non-empty field it never overwrites what the seller typed, instead
// surfacing an explicit "use this" suggestion; any failure degrades to a
// single quiet status, never blocking, no retry loop.
export interface UseCompanyNamePrefillReturn {
  readonly companyNameValue: string;
  readonly domainValue: string;
  readonly suggestedName: string | null;
  readonly scrapeStatus: ScrapeMetaPrefillStatus;
  readonly onCompanyNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onDomainChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onDomainBlur: (event: FocusEvent<HTMLInputElement>) => void;
  readonly applySuggestedName: () => void;
}

export function useCompanyNamePrefill(): UseCompanyNamePrefillReturn {
  // Controlled, not uncontrolled: React resets a form's fields after a
  // Server Action completes (mirroring native <form> submission behaviour),
  // which would otherwise wipe what the seller just typed the instant a
  // validation error comes back — same reasoning as invite-panel.tsx's email
  // field.
  const [companyNameValue, setCompanyNameValue] = useState("");
  const [domainValue, setDomainValue] = useState("");

  // Live mirror of companyNameValue, updated in the company-name field's own
  // onChange (never during render) — read at scrape-response time, which can
  // land well after the render that started the fetch, so the "did the
  // seller already type a name" check is never against a stale closure.
  const companyNameLiveRef = useRef("");
  const [suggestedName, setSuggestedName] = useState<string | null>(null);

  const { status: scrapeStatus, requestSuggestion, reset: resetScrape } = useScrapeMetaPrefill((title) => {
    if (companyNameLiveRef.current.trim()) {
      setSuggestedName(title);
      return;
    }
    companyNameLiveRef.current = title;
    setCompanyNameValue(title);
  });

  const onCompanyNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    companyNameLiveRef.current = event.target.value;
    setCompanyNameValue(event.target.value);
    // Review finding (MEDIUM): mirror the domain field's own clear-on-edit
    // below — once the seller edits the company name themselves, a stale
    // suggestion must never be able to overwrite what they just typed.
    setSuggestedName(null);
  }, []);

  const onDomainChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setDomainValue(event.target.value);
      setSuggestedName(null);
      resetScrape();
    },
    [resetScrape],
  );

  const onDomainBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      // A blur with no intervening edit (e.g. refocus-then-blur) starts a
      // fresh request for the same domain — the previous response's
      // suggestion is no longer guaranteed current, so it's cleared here
      // too, not just on edit.
      setSuggestedName(null);
      requestSuggestion(event.target.value);
    },
    [requestSuggestion],
  );

  const applySuggestedName = useCallback(() => {
    if (!suggestedName) return;
    companyNameLiveRef.current = suggestedName;
    setCompanyNameValue(suggestedName);
    setSuggestedName(null);
  }, [suggestedName]);

  return {
    companyNameValue,
    domainValue,
    suggestedName,
    scrapeStatus,
    onCompanyNameChange,
    onDomainChange,
    onDomainBlur,
    applySuggestedName,
  };
}
