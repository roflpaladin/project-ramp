// T47 (Sprint 9, Ticket 47). Single shared "last updated" date for the
// three legal pages (/terms, /privacy, /refunds) — one constant, one place
// to edit when the copy changes. `null` renders NO "Last updated" line at
// all (LegalPageLayout below), rather than a fake or placeholder date.
// Set to the date of the last copy change (Paddle KYB revision).
export const LEGAL_LAST_UPDATED: string | null = "11 October 2026";
