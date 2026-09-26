// Sprint 12 follow-up. lib/billing/active-deals-label.ts's
// activeDealsAllowanceLabel — pins the exact wording pricing-tiers.tsx and
// the billing page's plan summary share. Singular/plural must follow the
// cap itself: "Up to 1 active deal" (a Free tenant's cap), not the
// grammatically wrong "Up to 1 active deals".

import { describe, expect, it } from "vitest";
import { activeDealsAllowanceLabel } from "@/lib/billing/active-deals-label";

describe("activeDealsAllowanceLabel", () => {
  it("says 'deal' (singular) for a cap of exactly 1", () => {
    expect(activeDealsAllowanceLabel(1)).toBe("Up to 1 active deal");
  });

  it("says 'deals' (plural) for a cap greater than 1", () => {
    expect(activeDealsAllowanceLabel(3)).toBe("Up to 3 active deals");
    expect(activeDealsAllowanceLabel(8)).toBe("Up to 8 active deals");
  });

  it("says 'Unlimited active deals' for a null (uncapped) tier", () => {
    expect(activeDealsAllowanceLabel(null)).toBe("Unlimited active deals");
  });
});
