"use client";

import { useEffect } from "react";
import type { HeadlineVariantId } from "./landing-variants";

// T48 (Sprint 9, Ticket 48 — headline variant instrumentation). Fires
// exactly one impression ping per browser session for the headline variant
// this load was assigned to, POSTing to /api/landing-events (built in
// parallel by the backend agent — contract: 200 {ok:true} on success, 400/429
// on failure; this component never inspects the response). Kept as its own
// tiny client component, separate from WaitlistForm, so it fires in every
// landing-page CTA mode (waitlist AND signup, lib/landing/mode.ts) rather
// than only when the waitlist form happens to mount. Renders nothing.

const IMPRESSION_SESSION_KEY = "brava_hl_impression";
const LANDING_EVENTS_ENDPOINT = "/api/landing-events";

interface HeadlineImpressionPingProps {
  readonly variant: HeadlineVariantId;
}

/** sessionStorage can throw (private browsing, storage disabled) — treated
 * as "not yet pinged" on read and a silent no-op on write, since a failed
 * dedupe guard must never block the ping or crash the page. Worst case on a
 * write failure is an extra ping, which is far safer than losing the
 * dedupe's read side and never pinging at all. */
function hasAlreadyPinged(): boolean {
  try {
    return window.sessionStorage.getItem(IMPRESSION_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markPinged(): void {
  try {
    window.sessionStorage.setItem(IMPRESSION_SESSION_KEY, "1");
  } catch {
    // Swallowed on purpose — see the function-group comment above.
  }
}

export function HeadlineImpressionPing({ variant }: HeadlineImpressionPingProps) {
  useEffect(() => {
    if (hasAlreadyPinged()) return;
    markPinged();

    try {
      // A failed impression ping must never affect the page — the .catch
      // below swallows an async rejection (network failure, non-2xx status
      // is never even inspected), and the try/catch around the call itself
      // swallows the rarer case of fetch throwing synchronously. No console
      // noise, no UI change, no retry either way.
      fetch(LANDING_EVENTS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "impression", variant }),
      }).catch(() => {});
    } catch {
      // See the comment above.
    }
  }, [variant]);

  return null;
}
