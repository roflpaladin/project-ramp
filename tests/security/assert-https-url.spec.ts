// T32-5 (Sprint 6, Ticket 32; plans/sprint-6-7-replan.md §6). Scheme-rejection
// unit tests for `assertHttpsUrl` (lib/ssrf-guard.ts). Flagged as XSS-adjacent:
// chat_url / internal_chat_url are seller-controlled strings that end up
// rendered as a raw, clickable href in the buyer's browser
// (app/admin/workspaces/[id]/chat-url-actions.ts), never fetched server-side —
// so the risk here is a stored `javascript:`/`data:`/`vbscript:` URL
// executing on click, not SSRF. assertHttpsUrl is deliberately synchronous,
// pure, and does no DNS/network I/O, so this file needs no live Supabase
// server and no live-server harness, unlike most of this directory.

import { describe, expect, it } from "vitest";

import { assertHttpsUrl } from "@/lib/ssrf-guard";

describe("assertHttpsUrl", () => {
  it("rejects a javascript: scheme", () => {
    expect(() => assertHttpsUrl("javascript:alert(1)")).toThrow(
      "URL scheme must be https.",
    );
  });

  it("rejects a data: scheme", () => {
    expect(() => assertHttpsUrl("data:text/html,<script>alert(1)</script>")).toThrow(
      "URL scheme must be https.",
    );
  });

  it("rejects a vbscript: scheme", () => {
    expect(() => assertHttpsUrl("vbscript:msgbox(1)")).toThrow(
      "URL scheme must be https.",
    );
  });

  it("rejects a plain http: URL — https only, unlike assertPublicHttpUrl", () => {
    expect(() => assertHttpsUrl("http://example.com")).toThrow(
      "URL scheme must be https.",
    );
  });

  it("rejects malformed, non-URL input with a distinct error message", () => {
    expect(() => assertHttpsUrl("not a url")).toThrow("Not a valid URL.");
  });

  it("rejects an empty string with the malformed-URL message", () => {
    expect(() => assertHttpsUrl("")).toThrow("Not a valid URL.");
  });

  it("keeps the malformed-URL and wrong-scheme error messages distinct", () => {
    // Guards against a future regression that collapses both failure modes
    // into one generic message, which would make it impossible for a caller
    // (or a future test) to distinguish "not a URL at all" from "URL, wrong
    // scheme". chat-url-actions.ts's setChatUrls() currently discards the
    // message (bare `catch { ... }`, re-rendering with no inline error), so
    // today only this test observes the distinction — but that's a documented,
    // deliberate deferral in that file's own comment, not a defect here.
    let malformedMessage: string | undefined;
    let schemeMessage: string | undefined;

    try {
      assertHttpsUrl("not a url");
    } catch (error) {
      malformedMessage = error instanceof Error ? error.message : undefined;
    }

    try {
      assertHttpsUrl("javascript:alert(1)");
    } catch (error) {
      schemeMessage = error instanceof Error ? error.message : undefined;
    }

    expect(malformedMessage).toBe("Not a valid URL.");
    expect(schemeMessage).toBe("URL scheme must be https.");
    expect(malformedMessage).not.toBe(schemeMessage);
  });

  it("accepts a normal https: URL and returns a URL instance", () => {
    const result = assertHttpsUrl("https://chat.example.com/shared/room-1");

    expect(result).toBeInstanceOf(URL);
    expect(result.href).toBe("https://chat.example.com/shared/room-1");
    expect(result.protocol).toBe("https:");
  });
});
