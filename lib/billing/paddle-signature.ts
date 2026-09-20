// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). The gate on the only
// unauthenticated POST in this app that can change what a tenant is
// entitled to (app/api/billing/paddle/webhook/route.ts).
//
// Scheme confirmed against Paddle's live documentation on 2026-09-20
// (https://developer.paddle.com/webhooks/signature-verification, fetched
// with curl while writing this file):
//   - header: `Paddle-Signature: ts=<unix seconds>;h1=<hex digest>`
//     (a `;`-delimited, extensible key=value list — unknown parts ignored)
//   - signed payload: `<ts>:<RAW request body>` — the bytes Paddle sent,
//     never a re-serialised JSON.stringify of a parsed object
//   - digest: HMAC-SHA256 keyed with the notification destination's secret
//     key USED AS-IS (not hex- or base64-decoded)
//   - comparison: constant time
//   - replay: reject a timestamp outside a tolerance window
//
// Implemented here with node:crypto rather than @paddle/paddle-node-sdk:
// the algorithm is six lines, this repo has no Paddle server dependency yet,
// and the SDK's helper hard-codes a 5-second tolerance we would have had to
// work around anyway (see PADDLE_SIGNATURE_TOLERANCE_SECONDS below).
//
// Fail-closed by construction: every path returns `ok: false` with a
// reason; there is no path that returns ok on an error.

import { createHmac, timingSafeEqual } from "node:crypto";

export const PADDLE_SIGNATURE_HEADER = "Paddle-Signature";

/**
 * Paddle's own SDKs use five seconds, which assumes a tightly NTP-synced
 * clock; on a serverless host a few seconds of skew (or a queued retry)
 * would silently drop a real billing event, and a dropped event means a
 * paying tenant never gets their plan. Five minutes is the compromise:
 * still far too short for a harvested-signature replay to be useful, and
 * the event_id primary key on paddle_webhook_events makes an in-window
 * replay a no-op anyway.
 */
export const PADDLE_SIGNATURE_TOLERANCE_SECONDS = 300;

const MS_PER_SECOND = 1000;

export type SignatureFailureReason =
  | "missing_secret"
  | "missing_header"
  | "malformed_header"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch";

export type SignatureVerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SignatureFailureReason };

export interface VerifyPaddleSignatureInput {
  /** The body EXACTLY as received — `await request.text()`, never re-serialised. */
  readonly rawBody: string;
  readonly signatureHeader: string | null;
  readonly secret: string | null | undefined;
  readonly nowMs?: number;
}

interface ParsedSignatureHeader {
  readonly timestampSeconds: number;
  readonly digest: string;
}

function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  const parts = header.split(";");
  const values = new Map<string, string>();

  for (const part of parts) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;
    values.set(part.slice(0, separatorIndex).trim(), part.slice(separatorIndex + 1).trim());
  }

  const rawTimestamp = values.get("ts");
  const digest = values.get("h1");
  if (!rawTimestamp || !digest) return null;

  const timestampSeconds = Number(rawTimestamp);
  if (!Number.isFinite(timestampSeconds)) return null;

  return { timestampSeconds, digest };
}

/** Constant-time compare that tolerates a length mismatch instead of throwing. */
function digestsMatch(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(received, "utf8");
  if (expectedBytes.length !== receivedBytes.length) return false;
  return timingSafeEqual(expectedBytes, receivedBytes);
}

export function verifyPaddleSignature(input: VerifyPaddleSignatureInput): SignatureVerificationResult {
  const secret = input.secret?.trim();
  if (!secret) return { ok: false, reason: "missing_secret" };

  if (!input.signatureHeader) return { ok: false, reason: "missing_header" };

  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return { ok: false, reason: "malformed_header" };

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / MS_PER_SECOND);
  if (Math.abs(nowSeconds - parsed.timestampSeconds) > PADDLE_SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestampSeconds}:${input.rawBody}`)
    .digest("hex");

  if (!digestsMatch(expected, parsed.digest)) return { ok: false, reason: "signature_mismatch" };

  return { ok: true };
}
