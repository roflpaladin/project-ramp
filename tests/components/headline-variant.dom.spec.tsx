// T48 (Sprint 9, Ticket 48 — headline variant instrumentation). Unit
// coverage for lib/landing/headline-variant.ts's pure resolver/assigner.
// Deliberately placed under tests/components/ and named .dom.spec.tsx for
// the same reason landing-mode.dom.spec.tsx is: this ticket is scoped to
// the "components" Vitest project only (happy-dom, no Supabase) — the
// "security" project's tests/**/*.spec.ts glob hits a real, currently
// contended dev database this ticket must not touch. happy-dom is a strict
// superset of a plain node environment for these dependency-free pure
// functions, so nothing here is a compromise.

import { describe, expect, it } from "vitest";
import {
  assignHeadlineVariant,
  HEADLINE_VARIANT_COOKIE_NAME,
  HEADLINE_VARIANT_COOKIE_MAX_AGE_SECONDS,
  resolveHeadlineVariant,
} from "@/lib/landing/headline-variant";
import { HEADLINE_VARIANT_IDS } from "@/app/landing-variants";

describe("assignHeadlineVariant", () => {
  it("picks the first id when random() lands below 0.5", () => {
    expect(assignHeadlineVariant(() => 0)).toBe(HEADLINE_VARIANT_IDS[0]);
    expect(assignHeadlineVariant(() => 0.49)).toBe(HEADLINE_VARIANT_IDS[0]);
  });

  it("picks the second id when random() lands at or above 0.5", () => {
    expect(assignHeadlineVariant(() => 0.5)).toBe(HEADLINE_VARIANT_IDS[1]);
    expect(assignHeadlineVariant(() => 0.99)).toBe(HEADLINE_VARIANT_IDS[1]);
  });
});

describe("resolveHeadlineVariant — sticky assignment", () => {
  it("honours an already-valid cookie value and never re-rolls it", () => {
    const random = () => {
      throw new Error("random() must not be called when the cookie is already valid");
    };

    expect(resolveHeadlineVariant("control", random)).toBe("control");
    expect(resolveHeadlineVariant("with-not-at", random)).toBe("with-not-at");
  });
});

describe("resolveHeadlineVariant — invalid/missing cookie fallback", () => {
  it("falls back to a fresh assignment for a missing cookie value", () => {
    expect(resolveHeadlineVariant(undefined, () => 0)).toBe(HEADLINE_VARIANT_IDS[0]);
  });

  it("falls back to a fresh assignment for an unrecognised/malformed value, never throwing", () => {
    expect(resolveHeadlineVariant("", () => 0.9)).toBe(HEADLINE_VARIANT_IDS[1]);
    expect(resolveHeadlineVariant("CONTROL", () => 0)).toBe(HEADLINE_VARIANT_IDS[0]);
    expect(resolveHeadlineVariant("<script>x</script>", () => 0)).toBe(HEADLINE_VARIANT_IDS[0]);
    expect(resolveHeadlineVariant("some-retired-variant-id", () => 0)).toBe(HEADLINE_VARIANT_IDS[0]);
  });
});

describe("headline-variant cookie constants", () => {
  it("names the cookie brava_hl", () => {
    expect(HEADLINE_VARIANT_COOKIE_NAME).toBe("brava_hl");
  });

  it("sets a ~180 day max age", () => {
    const expectedSeconds = 180 * 24 * 60 * 60;
    expect(HEADLINE_VARIANT_COOKIE_MAX_AGE_SECONDS).toBe(expectedSeconds);
  });
});
