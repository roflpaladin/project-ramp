import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, WAITLIST_RATE_LIMIT } from "@/lib/rate-limit";

// Sprint 9, Ticket 47 (phase 1) — public waitlist capture for the Brava
// landing page (getbrava.tech). PUBLIC, unauthenticated, write — same threat
// class as seller self-serve registration (app/register/actions.ts, T39):
// an IP-keyed rate limit (lib/rate-limit.ts, same interim in-memory limiter
// and same budget as REGISTRATION_RATE_LIMIT), and a uniform response
// regardless of whether the email is new or already on the list, matching
// issueAccessToken's uniform-response contract in
// app/api/auth/send-token/route.ts. An insert conflict (Postgres
// unique-violation, error code 23505, from the case-insensitive unique index
// in supabase/migrations/0008_waitlist.sql) is treated as success — the
// response body must never let a caller enumerate who's already waitlisted.
//
// Table access is service-role only (waitlist_signups has RLS enabled with
// zero policies — see 0008's header), so this route is the table's only
// writer.
//
// No schema-validation library here: this codebase has no such dependency
// yet (checked package.json), and every sibling public route
// (app/api/auth/send-token/route.ts, app/api/scrape-meta/route.ts,
// app/register/actions.ts) validates its body the same way — manual type
// narrowing plus explicit checks. Matching that beats introducing a new
// dependency for one route.

const MAX_EMAIL_LENGTH = 254; // RFC 5321 mailbox length ceiling
const MAX_COMPANY_NAME_LENGTH = 200;
const MAX_SOURCE_LENGTH = 200;
// A legitimate signup body (email + companyName + source) is well under
// 1KB; 4KB is a generous cap that still rejects an oversized payload before
// it's ever parsed. Content-Length is a caller-supplied header and can lie
// (omitted, wrong, or spoofed) -- this is a cheap pre-parse gate for the
// common/honest case, NOT a guarantee. The real bound is the per-field
// length caps in validateBody below, which apply to whatever request.json()
// actually parses regardless of what this header claimed.
const MAX_BODY_BYTES = 4096;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNIQUE_VIOLATION_CODE = "23505";

// Mirrors app/register/actions.ts's field naming (companyName) rather than
// inventing "company"/"name" — that flow captures companyName + email +
// password and nothing else, so this endpoint's optional field matches it
// exactly. `source` is new here, for T48's later landing-variant
// attribution (not yet built).
const ALLOWED_BODY_KEYS = new Set(["email", "companyName", "source"]);

const GENERIC_SUCCESS = { ok: true } as const;
const GENERIC_ERROR_MESSAGE = "Something went wrong. Try again.";
const INVALID_BODY_MESSAGE = "Invalid request body.";
const INVALID_EMAIL_MESSAGE = "Enter a valid email address.";
const MISSING_EMAIL_MESSAGE = "A valid email is required.";
const COMPANY_NAME_TOO_LONG_MESSAGE = "Company name is too long.";
const RATE_LIMITED_MESSAGE = "Too many requests. Try again in a few minutes.";

function callerIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstEntry = forwardedFor?.split(",")[0]?.trim();
  return firstEntry || "unknown";
}

/** Cheap pre-parse size gate -- see MAX_BODY_BYTES above for the
 * untrusted-header caveat. Missing or non-numeric Content-Length is treated
 * as "unknown," not "too large," so the happy path never regresses just
 * because a caller omitted the header. */
function isBodyTooLarge(request: Request): boolean {
  const contentLength = Number(request.headers.get("content-length"));
  return Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES;
}

interface ParsedSignup {
  readonly email: string;
  readonly companyName: string | null;
  readonly source: string | null;
}

type ValidationResult =
  | { readonly ok: true; readonly signup: ParsedSignup }
  | { readonly ok: false; readonly error: string };

/** Optional string field: absent is fine, wrong type is a 400, present is
 * trimmed and length-capped. Returns null for the DB when the trimmed value
 * is empty (never stores an empty string). */
function readOptionalText(
  value: unknown,
  maxLength: number,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  if (value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return { ok: false };
  return { ok: true, value: trimmed || null };
}

function validateBody(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: INVALID_BODY_MESSAGE };
  }

  const record = body as Record<string, unknown>;
  const hasUnknownKey = Object.keys(record).some((key) => !ALLOWED_BODY_KEYS.has(key));
  if (hasUnknownKey) {
    return { ok: false, error: INVALID_BODY_MESSAGE };
  }

  const { email, companyName, source } = record;
  if (typeof email !== "string" || !email.trim()) {
    return { ok: false, error: MISSING_EMAIL_MESSAGE };
  }
  const trimmedEmail = email.trim();
  if (trimmedEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(trimmedEmail)) {
    return { ok: false, error: INVALID_EMAIL_MESSAGE };
  }

  const companyNameResult = readOptionalText(companyName, MAX_COMPANY_NAME_LENGTH);
  if (!companyNameResult.ok) {
    return { ok: false, error: COMPANY_NAME_TOO_LONG_MESSAGE };
  }

  const sourceResult = readOptionalText(source, MAX_SOURCE_LENGTH);
  if (!sourceResult.ok) {
    return { ok: false, error: INVALID_BODY_MESSAGE };
  }

  return {
    ok: true,
    signup: {
      email: trimmedEmail.toLowerCase(),
      companyName: companyNameResult.value,
      source: sourceResult.value,
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  const { allowed, retryAfterSeconds } = checkRateLimit(
    `waitlist:${callerIp(request)}`,
    WAITLIST_RATE_LIMIT.limit,
    WAITLIST_RATE_LIMIT.windowMs,
  );
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: RATE_LIMITED_MESSAGE },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  if (isBodyTooLarge(request)) {
    return NextResponse.json({ ok: false, error: INVALID_BODY_MESSAGE }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: INVALID_BODY_MESSAGE }, { status: 400 });
  }

  const validated = validateBody(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("waitlist_signups").insert({
    email: validated.signup.email,
    company_name: validated.signup.companyName,
    source: validated.signup.source,
  });

  // A unique-violation means this email is already on the list -- treated as
  // success so the response can never be used to enumerate existing
  // signups (see file header).
  if (error && error.code !== UNIQUE_VIOLATION_CODE) {
    console.error("[waitlist] insert failed:", { code: error.code, message: error.message });
    return NextResponse.json({ ok: false, error: GENERIC_ERROR_MESSAGE }, { status: 500 });
  }

  return NextResponse.json(GENERIC_SUCCESS);
}
