// T57 (Sprint 11, Ticket 57 — "Transactional email deliverability"). Unit
// coverage for the pure template function extracted from
// lib/email/send-access-code.ts, independent of any email provider.

import { describe, expect, it } from "vitest";

import { buildAccessCodeEmail } from "@/lib/email/templates/access-code";

describe("buildAccessCodeEmail", () => {
  it("returns the Brava-branded subject and includes the code in both bodies", () => {
    const result = buildAccessCodeEmail({ code: "1234" });

    expect(result.subject).toBe("Your Brava deal room access code");
    expect(result.text).toContain("1234");
    expect(result.html).toContain("1234");
    expect(result.text).toContain("Brava");
    expect(result.html).toContain("Brava");
  });

  it("omits any deal-room link when no portalUrl is given", () => {
    const result = buildAccessCodeEmail({ code: "1234" });

    expect(result.text).not.toContain("http");
    expect(result.html).not.toContain("<a ");
  });

  it("includes an 'Open your deal room' link in both bodies when portalUrl is given", () => {
    const portalUrl = "https://getbrava.tech/portal/7e570000-0000-4000-8000-000000004302";

    const result = buildAccessCodeEmail({ code: "1234", portalUrl });

    expect(result.text).toContain("Open your deal room");
    expect(result.text).toContain(portalUrl);
    expect(result.html).toContain("Open your deal room");
    expect(result.html).toContain(`href="${portalUrl}"`);
  });

  it("escapes a hostile portalUrl before interpolating it into the html body", () => {
    const portalUrl = 'https://getbrava.tech/portal/x"><script>alert(1)</script>';

    const result = buildAccessCodeEmail({ code: "1234", portalUrl });

    expect(result.html).not.toContain('"><script>');
    expect(result.html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("leaves the plain-text body unescaped (no HTML context to break out of)", () => {
    const portalUrl = 'https://getbrava.tech/portal/x"y';

    const result = buildAccessCodeEmail({ code: "1234", portalUrl });

    expect(result.text).toContain(portalUrl);
  });

  it("returns a new object on every call (no shared mutable state)", () => {
    const first = buildAccessCodeEmail({ code: "1234" });
    const second = buildAccessCodeEmail({ code: "5678" });

    expect(first).not.toBe(second);
    expect(first.text).toContain("1234");
    expect(second.text).toContain("5678");
  });
});
