/**
 * THE KEYED NETWORK HASH (src/trust/netKey.ts; docs/trust.md §network key).
 *
 * The one rule everything else here rests on: an address never leaves this file — not into a row, not into a log line, not
 * into an error. What leaves is HMAC-SHA256(TRUST_HASH_KEY, "n1|" + address) cut to 16 bytes, the whole address for IPv4 and
 * the /64 for IPv6, and with no key set, nothing leaves at all.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.SUPABASE_URL = "http://127.0.0.1:1";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.TRUST = "shadow";
  process.env.TRUST_HASH_KEY = "0123456789abcdef0123456789abcdef";
});

const { coarseKey, coarseKeyInput, ipOf, keyOf, netKey, netKeyForLog, netKeyInput, v4Num, v6Hex, v6Words } =
  await import("../src/trust/netKey.js");
const { fastifyLoggerOptions } = await import("../src/observability.js");
const { getConfig, resetConfigForTests } = await import("../src/config.js");
// Something imported by tests/setup.ts reads the config before this file's own environment is in place, so the cached copy
// is thrown away here: every test below wants the TRUST_HASH_KEY set above.
resetConfigForTests();

describe("addresses, read just far enough", () => {
  it("reads IPv4 and IPv6, and counts an IPv4-mapped address as IPv4", () => {
    expect(v4Num("1.2.3.4")).toBe(16_909_060);
    expect(v4Num("256.0.0.1")).toBeNull();
    expect(v6Words("2001:db8::1")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(v6Hex("2001:db8::1")).toBe("20010db8000000000000000000000001");
    expect(v6Words("2001:db8::1::2")).toBeNull();
    expect(ipOf("::ffff:1.2.3.4")).toEqual({ family: "v4", ip: "1.2.3.4" });
    expect(ipOf("[2001:db8::1]")).toEqual({ family: "v6", ip: "2001:db8::1" });
    expect(ipOf("not an address")).toBeNull();
  });

  it("keys IPv4 whole and IPv6 by its /64, so one home is one key", () => {
    expect(netKeyInput("1.2.3.4")).toBe("1.2.3.4");
    expect(netKeyInput("2001:db8:1:2:3:4:5:6")).toBe("20010db800010002/64");
    // Two devices on one home line: the same key.
    expect(netKeyInput("2001:db8:1:2:aaaa::1")).toBe(netKeyInput("2001:db8:1:2:bbbb::2"));
    // A different home: a different key.
    expect(netKeyInput("2001:db8:1:3::1")).not.toBe(netKeyInput("2001:db8:1:2::1"));
  });

  it("has a coarser key for bursts: an IPv4 /24 and an IPv6 /48", () => {
    expect(coarseKeyInput("1.2.3.4")).toBe("1.2.3.0/24");
    expect(coarseKeyInput("1.2.3.200")).toBe("1.2.3.0/24");
    expect(coarseKeyInput("2001:db8:1:2::1")).toBe("20010db80001/48");
    expect(coarseKey("1.2.3.4")).toHaveLength(32);
  });
});

describe("the hash", () => {
  it("is 16 bytes, steady for one address and different for another", () => {
    const a = netKey("1.2.3.4")!;
    expect(a).toHaveLength(16);
    expect(netKey("1.2.3.4")).toEqual(a);
    expect(netKey("1.2.3.5")).not.toEqual(a);
  });

  it("keeps the three kinds of key apart, so one table's key is never found in another", () => {
    const value = "1.2.3.4";
    expect(keyOf("net", value)).not.toEqual(keyOf("email", value));
    expect(keyOf("email", value)).not.toEqual(keyOf("install", value));
  });

  it("holds no address: the key cannot be read back, and a different key gives a different hash", () => {
    const key = netKey("1.2.3.4")!;
    expect(key.toString("hex")).not.toContain("01020304");
    expect(key.toString("latin1")).not.toContain("1.2.3.4");
    expect(keyOf("net", "1.2.3.4", "another key entirely, 32 characters")).not.toEqual(key);
  });

  it("answers nothing at all while TRUST_HASH_KEY is not set, so nothing can be collected", () => {
    delete process.env.TRUST_HASH_KEY;
    resetConfigForTests();
    try {
      expect(netKey("1.2.3.4")).toBeNull();
      expect(coarseKey("1.2.3.4")).toBeNull();
      expect(netKeyForLog("1.2.3.4")).toBeUndefined();
    } finally {
      process.env.TRUST_HASH_KEY = "0123456789abcdef0123456789abcdef";
      resetConfigForTests();
    }
  });
});

describe("which proxy we believe (TRUST_PROXY_CIDRS, docs/trust.md 8.3 fix 3)", () => {
  it("takes the forwarded address from the proxy's own ranges, and ignores a direct caller's header", async () => {
    const proxyAddr = (await import("proxy-addr")).default;
    const list = getConfig().TRUST_PROXY_CIDRS.split(",").map((s) => s.trim());
    const trusted = proxyAddr.compile(list);
    // Through the proxy on the compose network: the client's own address is read from the header the proxy set.
    const viaProxy = { headers: { "x-forwarded-for": "1.2.3.4" }, connection: { remoteAddress: "172.18.0.5" }, socket: { remoteAddress: "172.18.0.5" } };
    expect(proxyAddr(viaProxy as never, trusted)).toBe("1.2.3.4");
    // Straight at the backend (if its port were ever exposed): the header is a forgery and is ignored.
    const direct = { headers: { "x-forwarded-for": "9.9.9.9" }, connection: { remoteAddress: "203.0.113.7" }, socket: { remoteAddress: "203.0.113.7" } };
    expect(proxyAddr(direct as never, trusted)).toBe("203.0.113.7");
    // The default list is addresses, not a hop count: a count would believe whoever was one hop away.
    expect(list.length).toBeGreaterThan(1);
    expect(list.every((c) => c.includes("/"))).toBe(true);
  });
});

describe("no address in a log line", () => {
  it("the request serializer carries the keyed hash and no ip field at all", () => {
    const req = { id: "r1", method: "POST", url: "/v1/app/bootstrap", ip: "1.2.3.4" };
    const line = fastifyLoggerOptions().serializers.req(req) as Record<string, unknown>;
    expect(line).not.toHaveProperty("ip");
    expect(Object.values(line)).not.toContain("1.2.3.4");
    expect(JSON.stringify(line)).not.toContain("1.2.3.4");
    expect(line.net).toBe(netKeyForLog("1.2.3.4"));
    expect(String(line.net)).toHaveLength(12);
  });

  it("logs nothing in place of the address when there is no key", () => {
    delete process.env.TRUST_HASH_KEY;
    resetConfigForTests();
    try {
      const line = fastifyLoggerOptions().serializers.req({ id: "r1", method: "GET", url: "/v1/site", ip: "1.2.3.4" }) as Record<string, unknown>;
      expect(line.net).toBeUndefined();
      expect(JSON.stringify(line)).not.toContain("1.2.3.4");
    } finally {
      process.env.TRUST_HASH_KEY = "0123456789abcdef0123456789abcdef";
      resetConfigForTests();
    }
  });
});
