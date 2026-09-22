import { BlockList, isIP } from "node:net";

// Sprint 12, Ticket 62 — "is this literal IP address one we are willing to
// open a socket to?", and nothing else. Pure, synchronous, no DNS, no I/O.
//
// Replaces the hand-rolled string/prefix checks in lib/ssrf-guard.ts, which
// missed (all verified, all reachable):
//   - IPv4: 100.64.0.0/10 (carrier NAT), 192.0.0.0/24, the three TEST-NETs,
//     198.18.0.0/15, multicast, and 240.0.0.0/4 incl. 255.255.255.255.
//   - IPv6: "::", ANY expanded spelling of ::1, IPv4-mapped addresses written
//     in hex (::ffff:7f00:1 — a "::ffff:" + dotted-quad check never sees it),
//     NAT64, 6to4, most of fe80::/10 (only the literal "fe80:" prefix
//     matched, so febf::/fe90:: walked straight through), 2001:db8::/32 and
//     ff00::/8.
//
// Node's net.BlockList does the range arithmetic instead of us: it parses
// the address itself, so every legal spelling of the same address
// (compressed, expanded, mixed-case) lands on the same answer — which is
// exactly the class of bug a prefix-string check cannot avoid.
//
// Two IPv6 families cannot be delegated to BlockList, because whether they
// are safe depends on an IPv4 address carried INSIDE them; both are unwrapped
// here and re-judged as IPv4:
//   - ::ffff:0:0/96  IPv4-mapped  (::ffff:127.0.0.1 IS 127.0.0.1)
//   - 64:ff9b::/96   NAT64        (a NAT64 gateway will happily relay to
//                                  127.0.0.1 or 169.254.169.254)
// 6to4 (2002::/16) embeds an IPv4 address too, but is blocked WHOLESALE
// rather than unwrapped: 6to4 is deprecated (RFC 7526), no legitimate
// scrape target is reachable only that way, and blocking it outright removes
// a relay-based bypass class instead of trying to reason about it.
//
// Fail closed everywhere: anything this module cannot parse is "not public".

type BlockedSubnet = readonly [address: string, prefixLength: number];

// RFC 1918 private + every special-purpose IPv4 block that is not routable
// on the public internet (IANA "IPv4 Special-Purpose Address Registry").
const BLOCKED_IPV4_SUBNETS: readonly BlockedSubnet[] = [
  ["0.0.0.0", 8], // "this network" — 0.0.0.0 reaches localhost on Linux
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255 broadcast
];

const BLOCKED_IPV6_SUBNETS: readonly BlockedSubnet[] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local (the WHOLE /10, not just fe80::/16)
  ["ff00::", 8], // multicast
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 — see the header
];

function buildBlockList(subnets: readonly BlockedSubnet[], type: "ipv4" | "ipv6"): BlockList {
  const list = new BlockList();
  for (const [address, prefixLength] of subnets) {
    list.addSubnet(address, prefixLength, type);
  }
  return list;
}

const BLOCKED_IPV4 = buildBlockList(BLOCKED_IPV4_SUBNETS, "ipv4");
const BLOCKED_IPV6 = buildBlockList(BLOCKED_IPV6_SUBNETS, "ipv6");

const IPV6_GROUP_COUNT = 8;
const HEX_GROUP_PATTERN = /^[0-9a-f]{1,4}$/i;
const OCTET_MAX = 255;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;

/** `::ffff:0:0/96` — IPv4-mapped. */
const IPV4_MAPPED_PREFIX: readonly number[] = [0, 0, 0, 0, 0, 0xffff];
/** `64:ff9b::/96` — the well-known NAT64 prefix. */
const NAT64_PREFIX: readonly number[] = [0x64, 0xff9b, 0, 0, 0, 0];

function splitGroupTokens(half: string): readonly string[] {
  return half === "" ? [] : half.split(":");
}

/** Turns one side of an IPv6 literal into 16-bit groups, expanding a
 * trailing dotted-quad (`::ffff:127.0.0.1`) into the two groups it stands
 * for. Returns null for anything unexpected — callers fail closed. */
function parseGroupTokens(tokens: readonly string[]): readonly number[] | null {
  const groups: number[] = [];

  for (const [index, token] of tokens.entries()) {
    if (!token.includes(".")) {
      if (!HEX_GROUP_PATTERN.test(token)) return null;
      groups.push(Number.parseInt(token, 16));
      continue;
    }

    // A dotted quad is only legal as the very last element.
    if (index !== tokens.length - 1) return null;
    const octets = token.split(".").map(Number);
    if (octets.length !== 4) return null;
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > OCTET_MAX)) return null;
    groups.push((octets[0] << BITS_PER_BYTE) | octets[1], (octets[2] << BITS_PER_BYTE) | octets[3]);
  }

  return groups;
}

/** Expands any IPv6 spelling into exactly 8 groups. Assumes the caller has
 * already confirmed `isIP(ip) === 6`. */
function expandIPv6(ip: string): readonly number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;

  const head = parseGroupTokens(splitGroupTokens(halves[0]));
  const tail = halves.length === 2 ? parseGroupTokens(splitGroupTokens(halves[1])) : [];
  if (!head || !tail) return null;

  if (halves.length === 1) return head.length === IPV6_GROUP_COUNT ? head : null;

  const zeroCount = IPV6_GROUP_COUNT - head.length - tail.length;
  if (zeroCount < 1) return null;
  return [...head, ...Array.from({ length: zeroCount }, () => 0), ...tail];
}

function hasPrefix(groups: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((group, index) => groups[index] === group);
}

/** The IPv4 address an IPv4-mapped or NAT64 address carries, or null when
 * the address carries none. */
function extractEmbeddedIPv4(groups: readonly number[]): string | null {
  if (!hasPrefix(groups, IPV4_MAPPED_PREFIX) && !hasPrefix(groups, NAT64_PREFIX)) return null;

  const [high, low] = [groups[6], groups[7]];
  return [high >> BITS_PER_BYTE, high & BYTE_MASK, low >> BITS_PER_BYTE, low & BYTE_MASK].join(".");
}

function isPublicIPv6(ip: string): boolean {
  // A zone id (`fe80::1%eth0`) only exists for link-scoped addresses, which
  // are never a legitimate scrape target — and BlockList would have to parse
  // the suffix for us to trust its answer. Refuse instead.
  if (ip.includes("%")) return false;

  const groups = expandIPv6(ip);
  if (!groups) return false;

  const embedded = extractEmbeddedIPv4(groups);
  if (embedded) return isPublicAddress(embedded);

  return !BLOCKED_IPV6.check(ip, "ipv6");
}

/**
 * True only for a literal IP address that is safe to open a connection to.
 * False for every blocked range, for a mapped/NAT64 address whose embedded
 * IPv4 is blocked, and for anything that is not a bare, parseable IP literal
 * (a hostname, a bracketed literal, a decimal-encoded address, empty input) —
 * callers resolve names to addresses BEFORE asking this question.
 */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return !BLOCKED_IPV4.check(ip, "ipv4");
  if (version === 6) return isPublicIPv6(ip);
  return false;
}
