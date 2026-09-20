// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). Unit coverage for
// lib/billing/paddle-signature.ts, the fail-closed verifier standing between
// an anonymous POST and this tenant's billing state.
//
// The scheme under test was confirmed against Paddle's live documentation
// (https://developer.paddle.com/webhooks/signature-verification, fetched
// 2026-09-20): header `ts=<unix seconds>;h1=<hex>`, HMAC-SHA256 over
// `<ts>:<raw body>` keyed with the destination's secret key used AS-IS (not
// hex/base64-decoded), compared in constant time, plus a timestamp
// tolerance to blunt replays.
//
// Every signature below is built here, by this file, from the same primitive
// — a test that reused the implementation's own helper would pass even if
// the implementation signed the wrong string.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  PADDLE_SIGNATURE_TOLERANCE_SECONDS,
  verifyPaddleSignature,
} from "@/lib/billing/paddle-signature";

const SECRET = "pdl_ntfset_test_secret_key";
const RAW_BODY = '{"event_id":"evt_1","event_type":"subscription.created"}';
const NOW_MS = Date.parse("2026-09-20T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

function signatureHeader(timestampSeconds: number, body: string, secret = SECRET): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}:${body}`).digest("hex");
  return `ts=${timestampSeconds};h1=${digest}`;
}

function verify(overrides: Partial<Parameters<typeof verifyPaddleSignature>[0]> = {}) {
  return verifyPaddleSignature({
    rawBody: RAW_BODY,
    signatureHeader: signatureHeader(NOW_SECONDS, RAW_BODY),
    secret: SECRET,
    nowMs: NOW_MS,
    ...overrides,
  });
}

describe("verifyPaddleSignature — genuine requests", () => {
  it("accepts a signature generated with the destination secret over the raw body", () => {
    // Act
    const result = verify();

    // Assert
    expect(result.ok).toBe(true);
  });

  it("accepts a header that carries extra key-value parts alongside ts and h1", () => {
    // Arrange — Paddle's header format is an extensible ;-delimited list.
    const digest = createHmac("sha256", SECRET).update(`${NOW_SECONDS}:${RAW_BODY}`).digest("hex");

    // Act
    const result = verify({ signatureHeader: `ts=${NOW_SECONDS};h1=${digest};h2=ignored` });

    // Assert
    expect(result.ok).toBe(true);
  });

  it("accepts a header carrying TWO h1 values when the first one matches (key rotation)", () => {
    // Arrange — during a secret rotation Paddle signs with both keys.
    const ours = createHmac("sha256", SECRET).update(`${NOW_SECONDS}:${RAW_BODY}`).digest("hex");
    const theirs = createHmac("sha256", "pdl_ntfset_the_other_key").update(`${NOW_SECONDS}:${RAW_BODY}`).digest("hex");

    // Act
    const result = verify({ signatureHeader: `ts=${NOW_SECONDS};h1=${ours};h1=${theirs}` });

    // Assert
    expect(result.ok).toBe(true);
  });

  it("accepts a header carrying TWO h1 values when the SECOND one matches", () => {
    // Arrange — the matching digest must not be lost by keeping only one
    // value per key name (a Map would silently drop it).
    const ours = createHmac("sha256", SECRET).update(`${NOW_SECONDS}:${RAW_BODY}`).digest("hex");
    const theirs = createHmac("sha256", "pdl_ntfset_the_other_key").update(`${NOW_SECONDS}:${RAW_BODY}`).digest("hex");

    // Act
    const result = verify({ signatureHeader: `ts=${NOW_SECONDS};h1=${theirs};h1=${ours}` });

    // Assert
    expect(result.ok).toBe(true);
  });

  it("rejects a header whose h1 values are ALL from other keys", () => {
    // Arrange
    const one = createHmac("sha256", "pdl_ntfset_key_a").update(`${NOW_SECONDS}:${RAW_BODY}`).digest("hex");
    const two = createHmac("sha256", "pdl_ntfset_key_b").update(`${NOW_SECONDS}:${RAW_BODY}`).digest("hex");

    // Act
    const result = verify({ signatureHeader: `ts=${NOW_SECONDS};h1=${one};h1=${two}` });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("signature_mismatch");
  });

  it("signs with the RAW ts substring from the header, not a re-formatted number", () => {
    // Arrange — a timestamp Paddle wrote with a leading zero still has to
    // verify: Number("01758...") would re-render differently and break the
    // digest for a payload Paddle considers valid.
    const rawTs = `0${NOW_SECONDS}`;
    const digest = createHmac("sha256", SECRET).update(`${rawTs}:${RAW_BODY}`).digest("hex");

    // Act
    const result = verify({ signatureHeader: `ts=${rawTs};h1=${digest}` });

    // Assert
    expect(result.ok).toBe(true);
  });

  it("accepts a timestamp at the very edge of the tolerance window", () => {
    // Act
    const result = verify({
      signatureHeader: signatureHeader(NOW_SECONDS - PADDLE_SIGNATURE_TOLERANCE_SECONDS, RAW_BODY),
    });

    // Assert
    expect(result.ok).toBe(true);
  });
});

describe("verifyPaddleSignature — rejected requests", () => {
  it("rejects a body altered after signing", () => {
    // Arrange — same signature, one byte different in the payload.
    const tamperedBody = RAW_BODY.replace("subscription.created", "subscription.updated");

    // Act
    const result = verify({ rawBody: tamperedBody });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("signature_mismatch");
  });

  it("rejects a re-serialised body even when the JSON is semantically identical", () => {
    // Arrange — the classic "we called JSON.stringify(await req.json())" bug.
    const reSerialised = JSON.stringify(JSON.parse(RAW_BODY), null, 2);

    // Act
    const result = verify({ rawBody: reSerialised });

    // Assert
    expect(result.ok).toBe(false);
  });

  it("rejects a timestamp swapped for another after signing", () => {
    // Arrange
    const header = signatureHeader(NOW_SECONDS, RAW_BODY).replace(`ts=${NOW_SECONDS}`, `ts=${NOW_SECONDS - 1}`);

    // Act
    const result = verify({ signatureHeader: header });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("signature_mismatch");
  });

  it("rejects a correctly signed but stale request (replay)", () => {
    // Act
    const result = verify({
      signatureHeader: signatureHeader(NOW_SECONDS - PADDLE_SIGNATURE_TOLERANCE_SECONDS - 1, RAW_BODY),
    });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("timestamp_out_of_tolerance");
  });

  it("rejects a timestamp too far in the future", () => {
    // Act
    const result = verify({
      signatureHeader: signatureHeader(NOW_SECONDS + PADDLE_SIGNATURE_TOLERANCE_SECONDS + 1, RAW_BODY),
    });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("timestamp_out_of_tolerance");
  });

  it("rejects a signature made with a different secret", () => {
    // Act
    const result = verify({ signatureHeader: signatureHeader(NOW_SECONDS, RAW_BODY, "pdl_ntfset_wrong_key") });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("signature_mismatch");
  });

  it("rejects a missing Paddle-Signature header", () => {
    // Act
    const result = verify({ signatureHeader: null });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("missing_header");
  });

  it("rejects a header with no h1 part", () => {
    // Act
    const result = verify({ signatureHeader: `ts=${NOW_SECONDS}` });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("malformed_header");
  });

  it("rejects a header with a non-numeric timestamp", () => {
    // Act
    const result = verify({ signatureHeader: signatureHeader(NOW_SECONDS, RAW_BODY).replace(/ts=\d+/, "ts=soon") });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("malformed_header");
  });

  it("rejects an h1 of the wrong length without leaking the comparison", () => {
    // Arrange — a length mismatch must not throw out of timingSafeEqual.
    const header = `ts=${NOW_SECONDS};h1=abc123`;

    // Act
    const result = verify({ signatureHeader: header });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("signature_mismatch");
  });

  it("fails closed when no destination secret is configured", () => {
    // Act
    const result = verify({ secret: undefined });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("missing_secret");
  });

  it("fails closed when the configured secret is blank", () => {
    // Act
    const result = verify({ secret: "   " });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("missing_secret");
  });
});
