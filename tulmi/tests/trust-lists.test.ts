/**
 * THE PUBLIC NETWORK LISTS, AND THE KIND OF NETWORK THEY SAY A REQUEST CAME FROM
 * (src/trust/lists.ts, src/trust/netClass.ts; docs/trust.md §lists, §kinds).
 *
 * Every list is parsed from a fixture of the real shape, searched by binary search, and read for the KIND of network only:
 * no country, no city, no place. Two rules have to hold or the whole thing misreads real people as bots:
 *   - iCloud Private Relay wins over a data centre, because its egress runs inside Akamai's, Cloudflare's and Fastly's ranges
 *   - a mobile network's IPv4 is never countable, because carrier NAT puts thousands of real people behind one address
 */
import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.TRUST = "shadow";
  process.env.TRUST_HASH_KEY = "0123456789abcdef0123456789abcdef";
});

const {
  AsnTable, LIST_FILES, cidrRange, emptyLists, loadLists, loadListsAsync, parseAsnTsv, parseAsnTsvInChunks,
  parseHostingJson, parseLines, parseRelayCsv, rangeSetOf, refreshLists,
} = await import("../src/trust/lists.js");
const { netClassOf, CARRIER_ASNS } = await import("../src/trust/netClass.js");
const { resetConfigForTests } = await import("../src/config.js");
resetConfigForTests();

/** iptoasn's combined file: start, end, AS number, country, description. The country column must never be used. */
const ASN_TSV = [
  "1.2.3.0\t1.2.3.255\t64496\tIN\tEXAMPLE-HOME",
  "5.5.0.0\t5.5.255.255\t24940\tDE\tHETZNER-AS",
  "49.32.0.0\t49.47.255.255\t55836\tIN\tRELIANCEJIO-IN",
  "0.0.0.0\t0.255.255.255\t0\tNone\tNot routed",
  "2001:db8::\t2001:db8:ffff:ffff:ffff:ffff:ffff:ffff\t64497\tIN\tEXAMPLE-V6",
].join("\n");

const AWS_JSON = JSON.stringify({
  prefixes: [{ ip_prefix: "13.32.0.0/16", region: "ap-south-1", service: "AMAZON" }],
  ipv6_prefixes: [{ ipv6_prefix: "2600:1f00::/24" }],
});
const GCP_JSON = JSON.stringify({ prefixes: [{ ipv4Prefix: "34.64.0.0/11" }, { ipv6Prefix: "2600:1900::/28" }] });
const ORACLE_JSON = JSON.stringify({ regions: [{ region: "ap-mumbai-1", cidrs: [{ cidr: "140.238.0.0/16" }] }] });
const CF_V4 = "# Cloudflare\n104.16.0.0/13\n172.64.0.0/13\n";
const TOR = "# exits\n185.220.101.1\n2001:db9::5\n";
/** The relay's CSV: the first column only; the country, region and city columns are dropped as it is read. */
const RELAY_CSV = "104.16.5.0/24,IN,Karnataka,Bengaluru,\n172.64.9.0/24,US,California,Cupertino,\n";

function listsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-lists-"));
  fs.writeFileSync(path.join(dir, LIST_FILES.asn), gzipSync(Buffer.from(ASN_TSV, "utf8")));
  fs.writeFileSync(path.join(dir, LIST_FILES.tor), TOR);
  fs.writeFileSync(path.join(dir, LIST_FILES.relay), RELAY_CSV);
  fs.writeFileSync(path.join(dir, LIST_FILES.hosting[0]!), AWS_JSON);
  fs.writeFileSync(path.join(dir, LIST_FILES.hosting[1]!), GCP_JSON);
  fs.writeFileSync(path.join(dir, LIST_FILES.hosting[2]!), ORACLE_JSON);
  fs.writeFileSync(path.join(dir, LIST_FILES.hosting[3]!), CF_V4);
  fs.writeFileSync(path.join(dir, LIST_FILES.disposable), "# ours\nthrowaway.test\n");
  return dir;
}

describe("reading a range", () => {
  it("turns a CIDR into a range, and refuses what is not one", () => {
    expect(cidrRange("1.2.3.0/24")).toEqual({ family: "v4", s: 16_909_056, e: 16_909_311 });
    expect(cidrRange("1.2.3.4")).toEqual({ family: "v4", s: 16_909_060, e: 16_909_060 });
    expect(cidrRange("2001:db8::/32")).toEqual({
      family: "v6", s: "20010db8000000000000000000000000", e: "20010db8ffffffffffffffffffffffff",
    });
    expect(cidrRange("1.2.3.0/33")).toBeNull();
    expect(cidrRange("hello")).toBeNull();
    expect(cidrRange("")).toBeNull();
  });

  it("searches a set of ranges, in both families, and misses what is outside", () => {
    const set = rangeSetOf(["10.0.0.0/8", "192.168.5.0/24", "2001:db8::/32"]);
    expect(set.has("10.9.9.9")).toBe(true);
    expect(set.has("192.168.5.255")).toBe(true);
    expect(set.has("192.168.6.1")).toBe(false);
    expect(set.has("2001:db8:1::9")).toBe(true);
    expect(set.has("2001:db9::9")).toBe(false);
    expect(set.has("not an address")).toBe(false);
  });

  it("finds the right operator in a table of many, and nothing outside it", () => {
    const table = parseAsnTsv(ASN_TSV);
    expect(table.of("1.2.3.9")).toBe(64496);
    expect(table.of("5.5.1.1")).toBe(24940);
    expect(table.of("2001:db8::1")).toBe(64497);
    expect(table.of("8.8.8.8")).toBeNull();
    // AS 0 is "not routed" and says nothing, so it is dropped as the list is read.
    expect(table.of("0.1.2.3")).toBeNull();
    expect(new AsnTable().of("1.2.3.9")).toBeNull();
  });

  /**
   * The real file is about half a million rows and takes well over a second to read. Done in one go — at start and again
   * at every daily refresh — that is a second in which the server answers nothing, so the server's own reader does it a
   * chunk at a time. Same rows out, and the event loop gets a turn in between.
   */
  it("reads the same table in chunks, letting the server answer in between", async () => {
    const rows: string[] = [];
    for (let i = 0; i < 2_500; i++) rows.push(`10.${(i >> 8) & 255}.${i & 255}.0\t10.${(i >> 8) & 255}.${i & 255}.255\t${64500 + i}\tIN\tROW-${i}`);
    const text = [ASN_TSV, ...rows].join("\n");

    let turns = 0;
    const tick = setInterval(() => { turns += 1; }, 1);
    const chunked = await parseAsnTsvInChunks(text, 200);
    clearInterval(tick);

    const atOnce = parseAsnTsv(text);
    expect(chunked.size).toBe(atOnce.size);
    for (const ip of ["1.2.3.9", "5.5.1.1", "10.0.7.4", "10.9.100.2", "2001:db8::1", "8.8.8.8"]) {
      expect(chunked.of(ip)).toBe(atOnce.of(ip));
    }
    // The loop really did get its turns: a timer fired while the file was being read.
    expect(turns).toBeGreaterThan(0);
  });

  it("reads the lists off the disk without stopping for the gunzip either", async () => {
    const { gzipSync } = await import("node:zlib");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-lists-async-"));
    fs.writeFileSync(path.join(dir, LIST_FILES.asn), gzipSync(Buffer.from(ASN_TSV, "utf8")));
    fs.writeFileSync(path.join(dir, LIST_FILES.tor), "185.220.101.0/24\n");
    const got = await loadListsAsync(dir);
    expect(got.asn.of("1.2.3.9")).toBe(64496);
    expect(got.tor.has("185.220.101.7")).toBe(true);
    // The same answer the one-shot reader gives.
    expect(got.counts).toEqual(loadLists(dir).counts);
  });
});

describe("the files, as they really arrive", () => {
  it("reads every hosting shape: AWS, GCP, Oracle and Cloudflare's plain list", () => {
    expect(parseHostingJson(AWS_JSON)).toEqual(["13.32.0.0/16", "2600:1f00::/24"]);
    expect(parseHostingJson(GCP_JSON)).toEqual(["34.64.0.0/11", "2600:1900::/28"]);
    expect(parseHostingJson(ORACLE_JSON)).toEqual(["140.238.0.0/16"]);
    expect(parseHostingJson("not json at all")).toEqual([]);
    expect(parseLines(CF_V4)).toEqual(["104.16.0.0/13", "172.64.0.0/13"]);
  });

  it("takes only the first column of the relay's CSV, so no country or city is ever read", () => {
    expect(parseRelayCsv(RELAY_CSV)).toEqual(["104.16.5.0/24", "172.64.9.0/24"]);
    expect(parseRelayCsv(RELAY_CSV).join("|")).not.toMatch(/Bengaluru|Karnataka|IN|US/);
  });

  it("loads what is on the disk, counts it, and reads an empty folder as nothing", () => {
    const dir = listsDir();
    const l = loadLists(dir);
    expect(l.counts.asn).toBe(4);   // five rows, less the "not routed" AS 0 one
    expect(l.counts.tor).toBe(2);
    expect(l.counts.relay).toBe(2);
    expect(l.counts.hosting).toBe(7);   // 2 AWS + 2 GCP + 1 Oracle + 2 Cloudflare
    expect(l.disposable.has("someone@throwaway.test")).toBe(true);
    const bare = loadLists(fs.mkdtempSync(path.join(os.tmpdir(), "trust-empty-")));
    expect(bare.counts.asn).toBe(0);
    expect(bare.asn.of("1.2.3.4")).toBeNull();
  });

  it("keeps the last good copy when a list cannot be fetched, and still loads the rest", async () => {
    const dir = listsDir();
    const fetchFn = (async (url: unknown) => {
      if (String(url).includes("torproject")) return new Response("", { status: 500 });
      return new Response(Buffer.from("8.8.8.0/24\n", "utf8"), { status: 200 });
    }) as unknown as typeof fetch;
    const got = await refreshLists({
      dir,
      urls: { asn: "https://a/asn.gz", tor: "https://check.torproject.org/x", relay: "https://r/relay.csv", hosting: ["https://h/cf-v4"] },
      fetchFn,
    });
    expect(got.failed).toEqual(["tor"]);
    // Tor's file was left exactly as it was.
    expect(fs.readFileSync(path.join(dir, LIST_FILES.tor), "utf8")).toBe(TOR);
    expect(got.got).toContain("relay");
  });
});

describe("the kind of network", () => {
  const dir = listsDir();
  const l = loadLists(dir);

  it("a home line is home, and countable", () => {
    expect(netClassOf("1.2.3.9", l)).toEqual({ netClass: "home", asn: 64496, countable: true, apple: false });
  });

  it("a data centre is hosting, by its prefix file or by its operator number", () => {
    expect(netClassOf("13.32.1.1", l).netClass).toBe("hosting");
    expect(netClassOf("34.70.1.1", l).netClass).toBe("hosting");
    expect(netClassOf("140.238.1.1", l).netClass).toBe("hosting");
    // Hetzner is not in anybody's prefix file: the repo's short ASN list catches it.
    expect(netClassOf("5.5.1.1", l).netClass).toBe("hosting");
  });

  it("Tor is Tor, in both families", () => {
    expect(netClassOf("185.220.101.1", l).netClass).toBe("tor");
    expect(netClassOf("2001:db9::5", l).netClass).toBe("tor");
  });

  it("iCloud Private Relay WINS over the data centre its egress sits in", () => {
    // 104.16.5.0/24 is inside Cloudflare's 104.16.0.0/13, which is in the hosting set.
    expect(l.hosting.has("104.16.5.9")).toBe(true);
    expect(netClassOf("104.16.5.9", l).netClass).toBe("relay");
    // And an address in the same cloud but not in the relay's list is still hosting.
    expect(netClassOf("104.17.0.1", l).netClass).toBe("hosting");
  });

  it("a mobile network is mobile, and its IPv4 is NEVER counted (carrier NAT)", () => {
    expect(Object.keys(CARRIER_ASNS)).toContain("55836");
    const seen = netClassOf("49.33.1.1", l);
    expect(seen.netClass).toBe("mobile");
    expect(seen.countable).toBe(false);
  });

  it("Apple's own network scores nothing either way", () => {
    const seen = netClassOf("17.1.2.3", l);
    expect(seen.apple).toBe(true);
    expect(seen.netClass).toBe("unknown");
    expect(seen.countable).toBe(false);
  });

  it("with no lists at all, every kind is unknown and nothing is counted", () => {
    const seen = netClassOf("1.2.3.9", emptyLists());
    expect(seen.netClass).toBe("unknown");
    expect(seen.countable).toBe(false);
  });
});
