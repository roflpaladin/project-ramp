// Pure unit spec for the run-id helpers — no database, no requireTestEnv().
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScopedEmail, runScopedId, TEST_RUN_ID } from "./run-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("TEST_RUN_ID", () => {
  it("is the 11-hex token vitest.config.ts put on the environment", () => {
    expect(TEST_RUN_ID).toMatch(/^[0-9a-f]{11}$/);
    expect(TEST_RUN_ID).toBe(process.env.TEST_RUN_ID);
  });
});

describe("runScopedId", () => {
  it("returns a v4-shaped uuid that keeps the prefix and suffix", () => {
    const id = runScopedId("7e57", "00000000000a");
    expect(id).toMatch(UUID_V4);
    expect(id.startsWith("7e57")).toBe(true);
    expect(id.endsWith("-00000000000a")).toBe(true);
  });

  it("embeds the run id in the middle groups", () => {
    const id = runScopedId("7e58", "0000000000e1");
    const r = TEST_RUN_ID;
    expect(id).toBe(`7e58${r.slice(0, 4)}-${r.slice(4, 8)}-4${r.slice(8, 11)}-8000-0000000000e1`);
  });

  it("gives different ids for different suffixes", () => {
    expect(runScopedId("7e57", "000000000001")).not.toBe(runScopedId("7e57", "000000000002"));
  });

  it("rejects a suffix that is not 12 hex chars", () => {
    expect(() => runScopedId("7e57", "xyz")).toThrow(/suffix/i);
    expect(() => runScopedId("7e57", "0000000000001")).toThrow(/suffix/i);
    expect(() => runScopedId("7e57", "00000000000G")).toThrow(/suffix/i);
  });
});

describe("runScopedEmail", () => {
  it("puts the run id in a plus-tag", () => {
    expect(runScopedEmail("t23-harness", "projectramp.invalid")).toBe(
      `t23-harness+${TEST_RUN_ID}@projectramp.invalid`,
    );
  });
});

describe("a different run id", () => {
  const original = process.env.TEST_RUN_ID;
  beforeEach(() => {
    vi.resetModules();
    process.env.TEST_RUN_ID = "abcdef01234";
  });
  afterEach(() => {
    vi.resetModules();
    process.env.TEST_RUN_ID = original;
  });

  it("produces different ids and emails from a fresh module load", async () => {
    const other = await import("./run-id");
    expect(other.TEST_RUN_ID).toBe("abcdef01234");
    expect(other.runScopedId("7e57", "000000000001")).not.toBe(runScopedId("7e57", "000000000001"));
    expect(other.runScopedId("7e57", "000000000001")).toMatch(UUID_V4);
    expect(other.runScopedEmail("a", "b.invalid")).not.toBe(runScopedEmail("a", "b.invalid"));
  });

  it("throws when the env value is malformed", async () => {
    process.env.TEST_RUN_ID = "NOT-HEX";
    await expect(import("./run-id")).rejects.toThrow(/TEST_RUN_ID/);
  });

  it("throws when the env value is missing", async () => {
    delete process.env.TEST_RUN_ID;
    await expect(import("./run-id")).rejects.toThrow(/TEST_RUN_ID not set/);
  });
});
