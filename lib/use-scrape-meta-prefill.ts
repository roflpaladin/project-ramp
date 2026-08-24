"use client";

import { useCallback, useRef, useState } from "react";
import { isValidDomain, normalizeDomain } from "@/lib/domain";

// Sprint 9, Ticket 46 — "populate from a link" wiring for the manual
// workspace-creation fields (ManualStep in onboarding-flow.tsx,
// NewWorkspaceForm). Calls the Sprint 2, Ticket 12 scrape-meta endpoint
// (app/api/scrape-meta/route.ts) to suggest a company name once the seller
// has typed a domain. This hook, and every component that calls it, is a
// PURE CONSUMER of that endpoint's existing public contract:
//
//   POST /api/scrape-meta { url: string } -> 200 { title, desc, favicon }
//                                             (each string | null)
//                          -> 400/502 { error: string } on any failure
//
// The endpoint's SSRF guard (lib/ssrf-guard.ts) and its validation are
// explicitly frozen until Sprint 12 — this file never touches that
// boundary, never re-implements it client-side, and never bypasses it (the
// URL sent below is always reconstructed from the seller's own typed
// domain via lib/domain.ts's existing normalizeDomain/isValidDomain, the
// same validation new-workspace-actions.ts/onboarding-actions.ts already
// apply server-side to the same field).
//
// Every failure mode (bad response, non-JSON/garbage body, network error,
// client-side timeout) degrades to the same "unavailable" status with no
// retry — manual entry always works, and a fetch that never resolves must
// not block the field. Mirrors the existing try/catch shape in
// app/admin/workspaces/[id]/link-url-field.tsx (Sprint 2, Ticket 12).
const SCRAPE_TIMEOUT_MS = 6000;

export type ScrapeMetaPrefillStatus = "idle" | "loading" | "unavailable";

interface ScrapedTitleResponse {
  readonly title: string;
}

// Boundary validation for the endpoint's response body (external data, not
// trusted implicitly) — a non-string, missing, or blank title is treated
// exactly like any other failure.
function hasUsableTitle(data: unknown): data is ScrapedTitleResponse {
  if (typeof data !== "object" || data === null || !("title" in data)) return false;
  const { title } = data as { title: unknown };
  return typeof title === "string" && title.trim().length > 0;
}

export interface UseScrapeMetaPrefillReturn {
  readonly status: ScrapeMetaPrefillStatus;
  readonly requestSuggestion: (rawDomain: string) => void;
  readonly reset: () => void;
}

/**
 * `onTitle` fires at most once per successful fetch, with the trimmed
 * scraped title. It is stashed in a ref (not a `useCallback` dependency) so
 * callers can pass a fresh inline closure every render without re-creating
 * `requestSuggestion` or racing a stale closure against a slow response.
 */
export function useScrapeMetaPrefill(onTitle: (title: string) => void): UseScrapeMetaPrefillReturn {
  const [status, setStatus] = useState<ScrapeMetaPrefillStatus>("idle");
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;

  // Guards against a stale response landing after a newer request (or a
  // reset) — only the most recent request's result is ever applied.
  const requestIdRef = useRef(0);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setStatus("idle");
  }, []);

  const requestSuggestion = useCallback((rawDomain: string) => {
    const domain = normalizeDomain(rawDomain);
    // An invalid/incomplete domain is not a request at all — it's the same
    // "nothing in flight" state a caller gets from reset(), so it reuses
    // that path rather than re-deriving it inline.
    if (!isValidDomain(domain)) {
      reset();
      return;
    }

    const requestId = (requestIdRef.current += 1);
    setStatus("loading");

    fetch("/api/scrape-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://${domain}` }),
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    })
      .then(async (response) => {
        if (requestIdRef.current !== requestId) return;
        if (!response.ok) {
          setStatus("unavailable");
          return;
        }

        const data: unknown = await response.json();
        if (!hasUsableTitle(data)) {
          setStatus("unavailable");
          return;
        }

        setStatus("idle");
        onTitleRef.current(data.title.trim());
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setStatus("unavailable");
      });
  }, [reset]);

  return { status, requestSuggestion, reset };
}
