// Sprint 10, Ticket 53 — unit coverage for
// lib/crm-import/summarize-crm-import.ts. Pure aggregation, no I/O.

import { describe, expect, it } from "vitest";

import { summarizeCrmImport } from "@/lib/crm-import/summarize-crm-import";
import type { CrmDealWriteResult } from "@/lib/crm-import/write-crm-import";

const UNMAPPED_FIELDS = [{ sourceField: "dealtype", sourceLabel: "Deal type" }];

describe("summarizeCrmImport — status derivation", () => {
  it("all succeeded -> complete", () => {
    const results: CrmDealWriteResult[] = [
      { externalId: "1", ok: true },
      { externalId: "2", ok: true },
    ];
    const summary = summarizeCrmImport(results, UNMAPPED_FIELDS);
    expect(summary.status).toBe("complete");
    expect(summary.importedCount).toBe(2);
    expect(summary.failedCount).toBe(0);
    expect(summary.totalCount).toBe(2);
  });

  it("all failed -> failed", () => {
    const results: CrmDealWriteResult[] = [
      { externalId: "1", ok: false, reason: "invalid_data", message: "bad" },
      { externalId: "2", ok: false, reason: "unknown", message: "oops" },
    ];
    const summary = summarizeCrmImport(results, UNMAPPED_FIELDS);
    expect(summary.status).toBe("failed");
    expect(summary.importedCount).toBe(0);
    expect(summary.failedCount).toBe(2);
  });

  it("some succeeded, some failed -> partial", () => {
    const results: CrmDealWriteResult[] = [
      { externalId: "1", ok: true },
      { externalId: "2", ok: false, reason: "invalid_data", message: "bad" },
    ];
    const summary = summarizeCrmImport(results, UNMAPPED_FIELDS);
    expect(summary.status).toBe("partial");
    expect(summary.importedCount).toBe(1);
    expect(summary.failedCount).toBe(1);
  });

  it("empty input -> complete, all counts zero (nothing requested, vacuously nothing failed)", () => {
    const summary = summarizeCrmImport([], UNMAPPED_FIELDS);
    expect(summary.status).toBe("complete");
    expect(summary.importedCount).toBe(0);
    expect(summary.failedCount).toBe(0);
    expect(summary.totalCount).toBe(0);
    expect(summary.failures).toEqual([]);
  });
});

describe("summarizeCrmImport — failures list, never silently dropped", () => {
  it("carries externalId, reason, and message for every failure", () => {
    const results: CrmDealWriteResult[] = [
      { externalId: "deal-1", ok: false, reason: "rate_limited", message: "Too many requests." },
    ];
    const summary = summarizeCrmImport(results, UNMAPPED_FIELDS);
    expect(summary.failures).toEqual([{ externalId: "deal-1", reason: "rate_limited", message: "Too many requests." }]);
  });
});

describe("summarizeCrmImport — unmappedFields passthrough", () => {
  it("returns exactly the unmappedFields it was given, unmodified", () => {
    const summary = summarizeCrmImport([], UNMAPPED_FIELDS);
    expect(summary.unmappedFields).toBe(UNMAPPED_FIELDS);
  });
});

describe("summarizeCrmImport — retryable derivation", () => {
  it("retryable when some failure is rate_limited", () => {
    const results: CrmDealWriteResult[] = [{ externalId: "1", ok: false, reason: "rate_limited", message: "x" }];
    expect(summarizeCrmImport(results, UNMAPPED_FIELDS).retryable).toBe(true);
  });

  it("retryable when some failure is unknown", () => {
    const results: CrmDealWriteResult[] = [{ externalId: "1", ok: false, reason: "unknown", message: "x" }];
    expect(summarizeCrmImport(results, UNMAPPED_FIELDS).retryable).toBe(true);
  });

  it("not retryable when every failure is invalid_data", () => {
    const results: CrmDealWriteResult[] = [{ externalId: "1", ok: false, reason: "invalid_data", message: "x" }];
    expect(summarizeCrmImport(results, UNMAPPED_FIELDS).retryable).toBe(false);
  });

  it("not retryable when every failure is token_expired", () => {
    const results: CrmDealWriteResult[] = [{ externalId: "1", ok: false, reason: "token_expired", message: "x" }];
    expect(summarizeCrmImport(results, UNMAPPED_FIELDS).retryable).toBe(false);
  });

  it("not retryable when there are no failures", () => {
    const results: CrmDealWriteResult[] = [{ externalId: "1", ok: true }];
    expect(summarizeCrmImport(results, UNMAPPED_FIELDS).retryable).toBe(false);
  });
});

describe("summarizeCrmImport — reconnectRequired derivation", () => {
  it("reconnectRequired when some failure is token_expired", () => {
    const results: CrmDealWriteResult[] = [{ externalId: "1", ok: false, reason: "token_expired", message: "x" }];
    expect(summarizeCrmImport(results, UNMAPPED_FIELDS).reconnectRequired).toBe(true);
  });

  it("not reconnectRequired when no failure is token_expired", () => {
    const results: CrmDealWriteResult[] = [
      { externalId: "1", ok: false, reason: "rate_limited", message: "x" },
      { externalId: "2", ok: false, reason: "invalid_data", message: "x" },
      { externalId: "3", ok: false, reason: "unknown", message: "x" },
    ];
    expect(summarizeCrmImport(results, UNMAPPED_FIELDS).reconnectRequired).toBe(false);
  });
});

describe("summarizeCrmImport — disconnected-tenant short-circuit shape (SETTLED decision)", () => {
  it("one token_expired failure per requested externalId -> status failed, reconnectRequired true, retryable false", () => {
    const requestedIds = ["deal-1", "deal-2", "deal-3"];
    const results: CrmDealWriteResult[] = requestedIds.map((externalId) => ({
      externalId,
      ok: false,
      reason: "token_expired",
      message: "Connect HubSpot before importing deals.",
    }));

    const summary = summarizeCrmImport(results, UNMAPPED_FIELDS);

    expect(summary.status).toBe("failed");
    expect(summary.totalCount).toBe(3);
    expect(summary.failedCount).toBe(3);
    expect(summary.importedCount).toBe(0);
    expect(summary.reconnectRequired).toBe(true);
    expect(summary.retryable).toBe(false);
  });
});
