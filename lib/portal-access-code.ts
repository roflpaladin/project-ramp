// Sprint 12, Ticket 62 ("Self-Serve Hardening Pass", R7) — the ONE place the
// buyer portal's access-code shape is defined.
//
// Until T62 the code was four digits, baked in at five separate places (the
// generator's `randomInt(0, 10000)`, the gate form's copy, the input's
// `pattern`/`maxLength`, the error sentence, two e2e fixtures). Four digits is
// 10,000 possibilities: with five guesses per token row and a new row
// available every 60s, a scripted attacker reached ~72% success per day
// against one known buyer address. Six digits is 1,000,000 — a 100x bigger
// keyspace, and still a code a buyer can retype from an email without
// complaint. The attempt caps in lib/portal-access-token.ts are the other
// half of that fix; neither half is sufficient alone.
//
// CLIENT-SAFE ON PURPOSE: a page component and its form markup derive their
// copy and input attributes from ACCESS_CODE_LENGTH, so this module must not
// import `server-only` or node:crypto. Generation (which needs a CSPRNG) and
// hashing (which needs the app key) live in lib/portal-access-token.ts, the
// server-only module that imports this one.

export const ACCESS_CODE_LENGTH = 6;

/** `pattern` for the gate's <input>, kept in step with the length above. */
export const ACCESS_CODE_INPUT_PATTERN = `[0-9]{${ACCESS_CODE_LENGTH}}`;

const WELL_FORMED_ACCESS_CODE = new RegExp(`^[0-9]{${ACCESS_CODE_LENGTH}}$`);

/**
 * True only for exactly ACCESS_CODE_LENGTH ASCII digits — no surrounding
 * whitespace (callers trim first), no separators, no non-ASCII digits. The
 * server uses this to reject a malformed submission before it costs a
 * database round trip or an attempt from the buyer's hourly budget.
 */
export function isWellFormedAccessCode(value: string): boolean {
  return WELL_FORMED_ACCESS_CODE.test(value);
}
