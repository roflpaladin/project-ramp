// Sprint 12, Ticket 62 — exhaustive range table for lib/ssrf/ip-ranges.ts.
//
// This is the bottom of the SSRF stack: every "may this URL be fetched?"
// decision eventually reduces to isPublicAddress() on a literal address, so a
// single missing range here silently re-opens the whole hole. The pre-T62
// guard (lib/ssrf-guard.ts) had ZERO tests and, unsurprisingly, missed
// 100.64.0.0/10 (carrier NAT), 192.0.0.0/24, the TEST-NET blocks,
// 198.18.0.0/15 (benchmarking), multicast, 240.0.0.0/4, IPv6 "::",
// hex-form IPv4-mapped addresses (::ffff:7f00:1 — the string-prefix check
// only ever recognised the dotted form), NAT64, 6to4, and most of fe80::/10.
// Each of those is a real, published way to reach 127.0.0.1 or
// 169.254.169.254 (the cloud metadata endpoint) from an "innocent" string.
//
// Table-driven on purpose: the point of this file is coverage of a boundary
// list, not narrative, and boundary addresses (last public / first blocked)
// are listed explicitly because off-by-one prefix lengths are the classic
// bug in hand-written range checks.
//
// Pure computation, no DNS, no network, no Supabase.

import { describe, expect, it } from "vitest";

import { isPublicAddress } from "@/lib/ssrf/ip-ranges";

const BLOCKED_IPV4: readonly (readonly [string, string])[] = [
  ["0.0.0.0", "this-network 0.0.0.0/8 (a documented 127.0.0.1 alias on Linux)"],
  ["0.255.255.255", "this-network, last address"],
  ["10.0.0.0", "private 10/8, first address"],
  ["10.255.255.255", "private 10/8, last address"],
  ["100.64.0.0", "carrier-grade NAT 100.64.0.0/10, first address"],
  ["100.127.255.255", "carrier-grade NAT, last address"],
  ["127.0.0.1", "loopback"],
  ["127.255.255.255", "loopback 127/8, last address"],
  ["169.254.0.1", "link-local"],
  ["169.254.169.254", "the cloud metadata endpoint — the single highest-value SSRF target"],
  ["169.254.255.255", "link-local, last address"],
  ["172.16.0.0", "private 172.16/12, first address"],
  ["172.31.255.255", "private 172.16/12, last address"],
  ["192.0.0.0", "IETF protocol assignments 192.0.0.0/24, first address"],
  ["192.0.0.255", "IETF protocol assignments, last address"],
  ["192.0.2.1", "TEST-NET-1"],
  ["192.168.0.1", "private 192.168/16"],
  ["192.168.255.255", "private 192.168/16, last address"],
  ["198.18.0.0", "benchmarking 198.18.0.0/15, first address"],
  ["198.19.255.255", "benchmarking, last address"],
  ["198.51.100.5", "TEST-NET-2"],
  ["203.0.113.5", "TEST-NET-3"],
  ["224.0.0.1", "multicast 224.0.0.0/4, first address"],
  ["239.255.255.255", "multicast, last address"],
  ["240.0.0.1", "reserved 240.0.0.0/4"],
  ["255.255.255.255", "limited broadcast"],
];

const PUBLIC_IPV4: readonly (readonly [string, string])[] = [
  ["8.8.8.8", "ordinary public resolver"],
  ["1.1.1.1", "ordinary public resolver"],
  ["9.255.255.255", "last address before 10/8"],
  ["11.0.0.0", "first address after 10/8"],
  ["100.63.255.255", "last address before carrier-grade NAT"],
  ["100.128.0.0", "first address after carrier-grade NAT"],
  ["126.255.255.255", "last address before loopback"],
  ["128.0.0.1", "first address after loopback"],
  ["169.253.255.255", "last address before link-local"],
  ["169.255.0.0", "first address after link-local"],
  ["172.15.255.255", "last address before the private 172 block"],
  ["172.32.0.0", "first address after the private 172 block — 172/8 is NOT private as a whole"],
  ["192.0.1.1", "between IETF protocol assignments and TEST-NET-1"],
  ["192.0.3.1", "first block after TEST-NET-1"],
  ["192.167.255.255", "last address before 192.168/16"],
  ["192.169.0.0", "first address after 192.168/16"],
  ["198.17.255.255", "last address before benchmarking"],
  ["198.20.0.0", "first address after benchmarking"],
  ["198.51.99.255", "last address before TEST-NET-2"],
  ["198.51.101.0", "first address after TEST-NET-2"],
  ["203.0.112.255", "last address before TEST-NET-3"],
  ["203.0.114.0", "first address after TEST-NET-3"],
  ["223.255.255.255", "last address before multicast"],
];

const BLOCKED_IPV6: readonly (readonly [string, string])[] = [
  ["::", "unspecified — binds/connects to localhost on many stacks"],
  ["::1", "loopback"],
  ["0:0:0:0:0:0:0:1", "loopback, semi-expanded form"],
  ["0000:0000:0000:0000:0000:0000:0000:0001", "loopback, fully expanded form"],
  ["::ffff:127.0.0.1", "IPv4-mapped loopback, dotted form"],
  ["::ffff:7f00:1", "IPv4-mapped loopback, HEX form — invisible to a string-prefix check"],
  ["::ffff:169.254.169.254", "IPv4-mapped cloud metadata, dotted form"],
  ["::ffff:a9fe:a9fe", "IPv4-mapped cloud metadata, hex form"],
  ["::ffff:10.0.0.1", "IPv4-mapped private"],
  ["64:ff9b::7f00:1", "NAT64 of 127.0.0.1 — judged by the embedded IPv4"],
  ["64:ff9b::169.254.169.254", "NAT64 of the cloud metadata endpoint"],
  ["fc00::1", "unique local fc00::/7"],
  ["fd12:3456:789a::1", "unique local, fd half"],
  ["fe80::1", "link-local"],
  ["fe80:0000:0000:0000:0000:0000:0000:0001", "link-local, expanded form"],
  ["febf::1", "link-local — the TOP of fe80::/10, which a 'fe80:' prefix match misses"],
  ["fe90::1", "link-local, middle of the /10 — also missed by a 'fe80:' prefix match"],
  ["2001:db8::1", "documentation range"],
  ["2002::1", "6to4"],
  ["2002:7f00:1::1", "6to4 wrapping 127.0.0.1"],
  ["2002:0808:0808::1", "6to4 wrapping a PUBLIC address — the whole /16 is blocked, see the module header"],
  ["ff00::1", "multicast ff00::/8"],
  ["ff02::1", "all-nodes multicast"],
];

const PUBLIC_IPV6: readonly (readonly [string, string])[] = [
  ["2606:4700:4700::1111", "ordinary public resolver"],
  ["2001:4860:4860::8888", "ordinary public resolver"],
  ["2a00:1450:4001:80e::200e", "ordinary public host"],
  ["2001:db9::1", "adjacent to, but outside, the documentation range"],
  ["::ffff:8.8.8.8", "IPv4-mapped PUBLIC address — mapping is not itself a reason to refuse"],
  ["64:ff9b::808:808", "NAT64 of 8.8.8.8 — judged by the embedded IPv4, which is public"],
];

const NOT_AN_ADDRESS: readonly string[] = [
  "",
  " ",
  "not-an-ip",
  "example.com",
  "localhost",
  "1.2.3",
  "1.2.3.4.5",
  "256.1.1.1",
  "999.999.999.999",
  " 8.8.8.8",
  "8.8.8.8 ",
  "127.0.0.1:80",
  "0x7f.0.0.1",
  "2130706433",
  "[::1]",
  "::gggg",
  "fe80::1%eth0",
];

describe("isPublicAddress — IPv4 blocked ranges", () => {
  it.each(BLOCKED_IPV4)("refuses %s (%s)", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("isPublicAddress — IPv4 public addresses and range boundaries", () => {
  it.each(PUBLIC_IPV4)("allows %s (%s)", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe("isPublicAddress — IPv6 blocked ranges", () => {
  it.each(BLOCKED_IPV6)("refuses %s (%s)", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("isPublicAddress — IPv6 public addresses", () => {
  it.each(PUBLIC_IPV6)("allows %s (%s)", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe("isPublicAddress — anything that is not a literal IP", () => {
  // Fail closed: a hostname, a truncated quad, a decimal-encoded address or a
  // zone-suffixed literal is not something this function can reason about, so
  // it is never "public". Callers resolve names BEFORE calling this.
  it.each(NOT_AN_ADDRESS)("refuses %j — not a bare, parseable IP literal", (value) => {
    expect(isPublicAddress(value)).toBe(false);
  });
});
