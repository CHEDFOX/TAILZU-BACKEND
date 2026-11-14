/**
 * WHAT KIND OF NETWORK A REQUEST CAME FROM (docs/trust.md §kinds).
 *
 * Six kinds and "unknown", worked out from the downloaded lists (lists.ts) and three short lists of operator numbers kept
 * here in the repo, where a review can read them. The kind is all that is kept: never a country, a city or a place, and never
 * anything about the phone's own network (Apple names "the user's network connection" among its fingerprinting examples, so
 * the app sends us nothing of the sort and this file only ever sees the address the request arrived from).
 *
 * The order matters. iCloud Private Relay is checked FIRST, because its egress runs on Akamai's, Cloudflare's and Fastly's
 * networks: a relay match must win over a data-centre match, or every Safari sign-up would look like a bot. The relay's own
 * weight is zero.
 *
 * Mobile networks are a kind of their own because of carrier NAT: thousands of real people share one IPv4 address on Jio or
 * Airtel, so accounts are NEVER counted per address there (`countable: false`); only the IPv6 /64 and the in-memory burst
 * counters apply.
 */
import { lists, type Lists } from "./lists.js";
import type { NetClass } from "./netKey.js";
import { ipOf, v4Num } from "./netKey.js";

/** India's four big mobile operators (each U: checked against iptoasn's description on the server, docs/trust.md). */
export const CARRIER_ASNS: Readonly<Record<number, string>> = {
  55836: "jio",
  45609: "airtel",
  24560: "airtel",
  38266: "vi",
  9829: "bsnl",
};

/** Data centres that are not in anybody's published prefix file. Each U until the ASN list is read on the server. */
export const HOSTING_ASNS: Readonly<Record<number, string>> = {
  24940: "hetzner",
  16276: "ovh",
  14061: "digitalocean",
  63949: "linode",
  20473: "vultr",
  51167: "contabo",
  47583: "hostinger",
  9009: "m247",
  60068: "datacamp",
};

/**
 * Consumer VPN exits that are not data centres. Deliberately tiny: most VPN traffic already lands in `hosting` above, no
 * reputation API is called (that would send an address to a third party), and a wrong entry here costs a real person 15
 * points on a score that only ever logs, slows or holds the free plan. Each U.
 */
export const VPN_ASNS: Readonly<Record<number, string>> = {
  39351: "31173-services",
  212238: "datacamp-cdn77",
  51815: "m247-ro",
};

/** Apple's own network. Never a negative signal (docs/trust.md rule 5): a request from it scores nothing either way. */
const APPLE_ASN = 714;
const APPLE_V4 = { s: v4Num("17.0.0.0")!, e: v4Num("17.255.255.255")! };

export interface NetSeen {
  netClass: NetClass;
  /** The operator's number, when a list covers the address. Kept with the row so a wrong list can be explained later. */
  asn: number | null;
  /** Whether accounts may be counted per this key. False on a mobile network's IPv4 (carrier NAT). */
  countable: boolean;
  /** Apple's own network: no weight, up or down. */
  apple: boolean;
}

/** The kind of network an address is on. Unknown while no list is loaded, which scores nothing. */
export function netClassOf(raw: unknown, l: Lists = lists()): NetSeen {
  const got = ipOf(raw);
  if (!got) return { netClass: "unknown", asn: null, countable: false, apple: false };
  const asn = l.asn.of(got.ip);
  const apple = asn === APPLE_ASN
    || (got.family === "v4" && (() => { const n = v4Num(got.ip)!; return n >= APPLE_V4.s && n <= APPLE_V4.e; })());
  if (apple) return { netClass: "unknown", asn, countable: false, apple: true };
  // The relay first: its egress sits inside the big clouds' own ranges.
  if (l.relay.has(got.ip)) return { netClass: "relay", asn, countable: true, apple: false };
  if (l.tor.has(got.ip)) return { netClass: "tor", asn, countable: true, apple: false };
  if (asn !== null && CARRIER_ASNS[asn]) {
    return { netClass: "mobile", asn, countable: got.family === "v6", apple: false };
  }
  if (l.hosting.has(got.ip) || (asn !== null && HOSTING_ASNS[asn])) {
    return { netClass: "hosting", asn, countable: true, apple: false };
  }
  if (asn !== null && VPN_ASNS[asn]) return { netClass: "vpn", asn, countable: true, apple: false };
  // A known operator that is none of the above is somebody's home or office line.
  return { netClass: asn === null ? "unknown" : "home", asn, countable: asn !== null, apple: false };
}

/** The reason code a kind adds to a score, or null for the kinds that cost nothing (home, mobile, relay, unknown). */
export function netClassReason(k: NetClass): "tor" | "hosting" | "vpn" | null {
  return k === "tor" || k === "hosting" || k === "vpn" ? k : null;
}
