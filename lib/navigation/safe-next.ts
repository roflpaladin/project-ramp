// Sprint 12, Ticket 67 — open-redirect guard for post-auth `?next=` returns.
//
// A `next` value comes straight from the URL / a form field, so it is
// attacker-controlled. Rather than trying to detect every bad shape
// (`//host`, `/\host`, `javascript:`, encoded variants...), this accepts only
// what is provably a same-origin, known path:
//   1. a strict character allow-list — no `%` (so encoded slashes/backslashes
//      can't be smuggled through a later decode), no `\`, `#`, whitespace or
//      control chars, and no `:` (so no scheme can appear);
//   2. a single leading `/` that is not followed by another `/`;
//   3. a pathname on an explicit prefix allow-list, matched at a segment
//      boundary (`/admin` and `/admin/x`, not `/administrator`).
// Query strings on an allowed path are kept (e.g. `/pricing?plan=starter`)
// since the character allow-list already makes them inert; fragments are not.
// Returns the original string unchanged, or null.

export const MAX_NEXT_LENGTH = 200;

export const SAFE_NEXT_PATH_PREFIXES: readonly string[] = [
  "/pricing",
  "/settings/billing",
  "/admin",
];

// Allowed by prefix above but never a valid return target: /admin/login
// renders its raw `error` query param, so a `next` pointing at it would let a
// crafted link inject content into the login page.
export const DENIED_NEXT_PATHS: readonly string[] = ["/admin/login"];

function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

const SAFE_NEXT_PATTERN = /^\/(?!\/)[A-Za-z0-9\-._~/?=&+,@!$'()*]*$/;

function isAllowedPath(pathname: string): boolean {
  if (pathname.split("/").includes("..")) return false;
  if (DENIED_NEXT_PATHS.some((denied) => matchesPath(pathname, denied))) return false;
  return SAFE_NEXT_PATH_PREFIXES.some((prefix) => matchesPath(pathname, prefix));
}

export function parseSafeNext(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_NEXT_LENGTH) return null;
  if (!SAFE_NEXT_PATTERN.test(raw)) return null;
  const [pathname] = raw.split("?");
  return isAllowedPath(pathname) ? raw : null;
}
