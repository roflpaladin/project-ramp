// T36-2 (Sprint 7, Ticket 36; plans/sprint-6-7-replan.md §7). Unit coverage
// for maskBuyerEmail — the function that removes raw buyer_email from
// /api/demo/pulse's activity feed, a session-less, unauthenticated
// endpoint. Pure function, no Supabase, no live server.

import { describe, expect, it } from "vitest";

import { maskBuyerEmail } from "@/lib/pulse/mask-buyer-email";

describe("maskBuyerEmail", () => {
  it("keeps the local part's first character and the domain's TLD", () => {
    expect(maskBuyerEmail("sarah.chen@acme-logistics.example.com")).toBe("s***@***.com");
  });

  it("never leaks any character of the local part beyond the first", () => {
    const masked = maskBuyerEmail("jonathan.reyes@buyer-corp.example.org");
    expect(masked).not.toContain("onathan");
    expect(masked).not.toContain("reyes");
  });

  it("never leaks the domain's second-level name", () => {
    const masked = maskBuyerEmail("buyer@totally-identifiable-company.com");
    expect(masked).not.toContain("totally-identifiable-company");
  });

  it("masks a single-character local part correctly", () => {
    expect(maskBuyerEmail("a@b.co")).toBe("a***@***.co");
  });

  it("falls back to a fully masked placeholder for a domain with no dot", () => {
    expect(maskBuyerEmail("buyer@localhost")).toBe("b***@***");
  });

  it("falls back to a fully masked placeholder when there is no '@' at all", () => {
    expect(maskBuyerEmail("not-an-email")).toBe("***@***");
  });

  it("falls back to a fully masked placeholder for an empty local part", () => {
    expect(maskBuyerEmail("@domain.com")).toBe("***@***");
  });

  it("falls back to a fully masked placeholder for an empty domain", () => {
    expect(maskBuyerEmail("user@")).toBe("***@***");
  });

  it("falls back to a fully masked placeholder for an empty string", () => {
    expect(maskBuyerEmail("")).toBe("***@***");
  });

  it("still reads as a plausible-shaped email, keeping the feed usable", () => {
    const masked = maskBuyerEmail("priya@acme.io");
    expect(masked).toMatch(/^.\*{3}@\*{3}(\.\w+)?$/);
  });
});
