// T47 (Sprint 9, Ticket 47). Single shared "last updated" date for the
// three legal pages (/terms, /privacy, /refunds) — one constant, one place
// to edit when the copy changes. `null` renders NO "Last updated" line at
// all (LegalPageLayout below), rather than a fake or placeholder date.
// Set to the date the pages went live on getbrava.tech (PR #45).
export const LEGAL_LAST_UPDATED: string | null = "23 August 2026";
