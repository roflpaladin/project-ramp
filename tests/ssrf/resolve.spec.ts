// Sprint 12, Ticket 62 — unit spec for lib/ssrf/resolve.ts.
//
// The DNS lookup is injected, so this file never touches the network (and
// never depends on what a real resolver happens to answer today). What it
// pins is the POLICY around the lookup, which is where the pre-T62 guard was
// wrong:
//
//   1. the old guard called dns.lookup() WITHOUT `all: true` and judged only
//      the first address — a hostname with one public and one private A
//      record passed the check and then let the OS pick the private one at
//      connect time. Here, one private record poisons the whole answer.
//   2. the old guard returned only the URL, so the caller re-resolved at
//      fetch() time (classic DNS-rebinding TOCTOU). Here the validated
//      addresses are RETURNED so the caller can pin one to the socket.
//
// Policy refusals are BlockedUrlError (the route turns those into a 400);
// anything else is an ordinary Error (a 502).

import { describe, expect, it } from "vitest";

import { BlockedUrlError } from "@/lib/ssrf/errors";
import { resolvePublicAddresses, type LookupAllFn } from "@/lib/ssrf/resolve";

function lookupReturning(...addresses: readonly { address: string; family: number }[]): LookupAllFn {
  return async () => addresses;
}

const NEVER_CALLED: LookupAllFn = async () => {
  throw new Error("DNS lookup must not be called for this input.");
};

describe("resolvePublicAddresses — literal IP hostnames skip DNS entirely", () => {
  it("returns a public IPv4 literal as its own single pinned address", async () => {
    const resolved = await resolvePublicAddresses("8.8.8.8", NEVER_CALLED);

    expect(resolved).toEqual([{ address: "8.8.8.8", family: 4 }]);
  });

  it("accepts a bracketed IPv6 literal (the form a URL hostname carries) and strips the brackets", async () => {
    const resolved = await resolvePublicAddresses("[2606:4700:4700::1111]", NEVER_CALLED);

    expect(resolved).toEqual([{ address: "2606:4700:4700::1111", family: 6 }]);
  });

  it("refuses a private IPv4 literal", async () => {
    await expect(resolvePublicAddresses("169.254.169.254", NEVER_CALLED)).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("refuses a loopback IPv6 literal in its bracketed form", async () => {
    await expect(resolvePublicAddresses("[::1]", NEVER_CALLED)).rejects.toBeInstanceOf(BlockedUrlError);
  });
});

describe("resolvePublicAddresses — the localhost family never reaches DNS", () => {
  it.each(["localhost", "LOCALHOST", "api.localhost", "deep.nested.localhost"])(
    "refuses %s outright",
    async (hostname) => {
      await expect(resolvePublicAddresses(hostname, NEVER_CALLED)).rejects.toBeInstanceOf(BlockedUrlError);
    },
  );
});

describe("resolvePublicAddresses — DNS answers", () => {
  it("returns every address when they are all public", async () => {
    const resolved = await resolvePublicAddresses(
      "example.com",
      lookupReturning({ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }),
    );

    expect(resolved).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });

  it("refuses the whole answer when ONE record is private (the multi-record rebinding trick)", async () => {
    await expect(
      resolvePublicAddresses(
        "rebind.example",
        lookupReturning({ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }),
      ),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("refuses an empty answer rather than returning nothing for a caller to mis-handle", async () => {
    await expect(resolvePublicAddresses("void.example", lookupReturning())).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("refuses an answer whose only record is the cloud metadata address", async () => {
    await expect(
      resolvePublicAddresses("metadata.example", lookupReturning({ address: "169.254.169.254", family: 4 })),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("translates a lookup failure into a BlockedUrlError that keeps the underlying error as `cause`", async () => {
    const underlying = Object.assign(new Error("getaddrinfo ENOTFOUND nope.example"), { code: "ENOTFOUND" });
    const failing: LookupAllFn = async () => {
      throw underlying;
    };

    // "can't be resolved" stays a 400 (the pre-T62 behaviour of this route),
    // not a 502 — but the original error is preserved for server-side logging
    // rather than swallowed.
    const error = await resolvePublicAddresses("nope.example", failing).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BlockedUrlError);
    expect((error as Error).cause).toBe(underlying);
  });
});

describe("resolvePublicAddresses — error messages are safe to surface", () => {
  it("never embeds the resolved address or the hostname in the message", async () => {
    const error = await resolvePublicAddresses(
      "rebind.example",
      lookupReturning({ address: "169.254.169.254", family: 4 }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("169.254.169.254");
    expect((error as Error).message).not.toContain("rebind.example");
  });
});
