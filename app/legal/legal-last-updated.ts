// T47 (Sprint 9, Ticket 47). Single shared "last updated" date for the
// three legal pages (/terms, /privacy, /refunds) — one constant, one place
// to edit on publish day, per the coordinator's brief. `null` renders NO
// "Last updated" line at all (LegalPageLayout below), rather than a fake or
// placeholder date: the founder-approved copy is landing ahead of the
// actual publish date, so there is no real date to show yet.
export const LEGAL_LAST_UPDATED: string | null = null;
