// T31-8 (Sprint 6, Ticket 31; plans/sprint-6-7-replan.md §6). Unit tests for
// app/admin/workspaces/[id]/crm-format.ts, focused on the stale-timestamp
// rendering path: crm_synced_at must render visibly ("as of <time>") rather
// than silently wrong (T31-3's own stated requirement). Pure functions, no
// DOM needed — run under the "security" (node) Vitest project.

import { describe, expect, it } from "vitest";
import { formatCrmAmount, formatCrmCloseDate, formatSyncedAt } from "@/app/admin/workspaces/[id]/crm-format";

describe("formatSyncedAt — staleness visibility", () => {
  it("renders a recent synced-at timestamp as a readable absolute date and time", () => {
    // Arrange
    const recentlySynced = new Date().toISOString();
    // Act
    const formatted = formatSyncedAt(recentlySynced);
    // Assert — not the fallback, and not the raw ISO string (i.e. actually formatted).
    expect(formatted).not.toBe("—");
    expect(formatted).not.toBe(recentlySynced);
  });

  it("renders a stale (weeks-old) synced-at timestamp visibly, not silently as if current", () => {
    const staleTimestamp = "2020-01-15T09:30:00.000Z";
    const formatted = formatSyncedAt(staleTimestamp);
    // The actual stale date must be present in the rendered string — this is
    // the crux of "staleness is visible rather than silently wrong": a
    // seller reading this strip can tell the sync is years old because the
    // formatted date says so, not because of any separate "stale" flag.
    expect(formatted).toContain("2020");
    expect(formatted).not.toBe("never synced");
  });

  it("renders distinctly different output for a stale timestamp vs a fresh one", () => {
    const stale = formatSyncedAt("2020-01-15T09:30:00.000Z");
    const fresh = formatSyncedAt("2026-08-01T09:30:00.000Z");
    expect(stale).not.toBe(fresh);
  });

  it("renders 'never synced' (not blank, not a crash) when crm_synced_at is null", () => {
    expect(formatSyncedAt(null)).toBe("never synced");
  });

  it("falls back to 'never synced' for an unparsable synced-at string, rather than rendering garbage", () => {
    expect(formatSyncedAt("not-a-real-timestamp")).toBe("never synced");
  });
});

describe("formatCrmAmount", () => {
  it("formats a numeric amount as whole-dollar USD currency", () => {
    expect(formatCrmAmount(48000)).toBe("$48,000");
  });

  it("renders the em-dash fallback for a null amount", () => {
    expect(formatCrmAmount(null)).toBe("—");
  });
});

describe("formatCrmCloseDate", () => {
  it("formats a Postgres date string as a short human date", () => {
    expect(formatCrmCloseDate("2026-09-30")).toBe("Sep 30, 2026");
  });

  it("renders the em-dash fallback for a null close date", () => {
    expect(formatCrmCloseDate(null)).toBe("—");
  });

  it("renders the em-dash fallback for an unparsable close date string", () => {
    expect(formatCrmCloseDate("not-a-date")).toBe("—");
  });
});
