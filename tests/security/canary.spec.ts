// TEMPORARY — deliberately failing canary. Removed before this PR merges.
//
// Ticket 23 requires observing that a red test actually blocks a merge, rather
// than assuming branch protection is configured correctly. Protection was already
// shown to refuse a merge once (HTTP 405) when the credentials guard failed, but
// that fired *before* the suite ran. This proves the suite's own assertions are
// what gate the merge.
//
// It imports nothing and touches no database on purpose: a canary that depended
// on the fixture could fail for an unrelated reason and prove nothing.

import { describe, expect, it } from "vitest";

describe("CANARY — expected to fail, delete me", () => {
  it("fails on purpose so the merge gate can be observed blocking", () => {
    expect(
      "the buyer boundary suite is wired into branch protection",
      "If this assertion is failing in CI, the canary is doing its job. If it is " +
        "failing on main, someone merged the canary by mistake — delete this file.",
    ).toBe("this canary should have been deleted before merge");
  });
});
