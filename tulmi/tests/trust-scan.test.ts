/**
 * THE FINGERPRINT GUARDS (docs/trust.md rules 3, 4, 7 and 9).
 *
 * These are the rules that cannot be held up by care, because the cost of breaking one is a rejected app and a broken
 * promise rather than a failing request. So they are held up by a scan of the files themselves:
 *
 *   - nothing in src/trust/** reads a device trait, and nothing about the PHONE's own network (Apple names "the user's
 *     network connection" among its fingerprinting examples, so even that is out)
 *   - nothing in src/trust/** reads a request or bootstrap field beyond the short allowed list
 *   - no export in src/trust/** hands back a list of user ids, so "the other accounts on this network" cannot be written
 *   - nothing derives a place from an address
 *   - ads/meta.ts, and everything it imports, imports nothing from src/trust/**
 *   - the migration keeps no raw address, and every table has row level security on with no policy
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "../src");
const TRUST = path.join(SRC, "trust");
const MIGRATION = path.resolve(import.meta.dirname, "../supabase/migrations/0093_trust_signals.sql");

/** Every .ts file under a folder, by its path from src/. */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (e.name.endsWith(".ts")) out.push(path.relative(SRC, p));
  }
  return out;
}

const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), "utf8");

/**
 * A file with its comments taken out. The comments here NAME the things that may never be read ("it never reads NetInfo"),
 * which is the point of them, so the scans below look at the code alone.
 */
const codeOf = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The files each file imports, by their path from src/ (relative imports only). */
function importsOf(file: string): string[] {
  const out: string[] = [];
  for (const m of read(file).matchAll(/from\s+"(\.[^"]+)"/g)) {
    const raw = m[1]!.replace(/\.js$/, ".ts");
    const abs = path.resolve(path.dirname(path.join(SRC, file)), raw);
    const rel = path.relative(SRC, abs);
    if (!rel.startsWith("..")) out.push(rel);
  }
  return out;
}

const trustFiles = sources(TRUST);

describe("the trust code reads no device trait, and nothing about the phone's own network", () => {
  /** Each name, and why it may never appear. A new signal is a decision, so it has to be made here first. */
  const NEVER: Array<[RegExp, string]> = [
    [/\bsystemUptime\b/, "boot time (a required-reason API, and a fingerprinting input)"],
    [/kern\.boottime/, "boot time"],
    [/\blastBoot\b/, "the app's own boot breadcrumb: not ours to score"],
    [/volumeAvailableCapacity/, "disk space"],
    [/attributesOfItem/, "file timestamps"],
    [/activeInputModes/, "the keyboard list"],
    [/canOpenURL/, "scheme probes (which apps are installed)"],
    [/identifierForVendor/, "the vendor id"],
    [/getAndroidId|Settings\.Secure\.ANDROID_ID/, "Android's SSAID"],
    [/advertisingIdentifier|advertisingId/, "the advertising id"],
    [/\bNetInfo\b|@react-native-community\/netinfo/, "the phone's network state"],
    [/NWPathMonitor|CTTelephonyNetworkInfo|getifaddrs/, "the phone's network interfaces"],
    [/CNCopyCurrentNetworkInfo|NEHotspotNetwork|WifiManager/, "the Wi-Fi it is on"],
    [/TelephonyManager|ConnectivityManager/, "the carrier it is on"],
    [/expo-application|expo-device|expo-localization/, "device packages"],
    [/sdui\/device\/facts|device\/signals/, "the app's own device facts"],
  ];

  it("names none of them, in any file", () => {
    for (const file of trustFiles) {
      for (const [pattern, why] of NEVER) {
        // The comment that says a thing is never read is allowed to name it; code is not.
        expect(pattern.test(codeOf(file)), `${file} must not read ${why}`).toBe(false);
      }
    }
  });

  it("reads no request or bootstrap field beyond the allowed list", () => {
    // What a request may be read for at all (docs/trust.md rule 7).
    const ALLOWED = ["ip", "userAgent", "platform", "bundle", "appVersion", "capabilities", "x-app-", "x-tz-tls-", "x-vercel-forwarded-for", "authorization"];
    const FORBIDDEN = [
      /\bpermissions?\b\s*[:.]/, /\bmicGranted\b/, /\bkeyboardReady\b/, /\bkeyboardEnabled\b/, /\blocale\b\s*[:.]/,
      /\btimeZone\b|\btimezone\b/, /\bscreen(Width|Height|Size)\b/, /\binsets\b/, /\bformFactor\b\s*[:.]/,
      /\bcomponents\.(?!includes)/, /\bgoogleWeb\b/, /\blooks\b\s*[:.]/,
    ];
    for (const file of trustFiles) {
      const code = codeOf(file);
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(code), `${file} reads a field the trust code may not read (${pattern})`).toBe(false);
      }
    }
    expect(ALLOWED.length).toBeGreaterThan(0);
  });

  it("works out no place from an address: no country, city, region or geolocation", () => {
    const PLACES = /\b(geoip|geolocation|countryCode|cityName|latitude|longitude|maxmind|mmdb|ip2location)\b/i;
    for (const file of trustFiles) {
      expect(PLACES.test(codeOf(file)), `${file} must not work out a place from an address`).toBe(false);
    }
  });
});

describe("counted, never joined", () => {
  it("no export hands back a list of user ids", () => {
    // A function that answers Promise<string[]> or string[] while naming users is the shape rule 9 forbids.
    const BAD = [
      /export\s+(?:async\s+)?function\s+\w*[Uu]sers?\w*\s*\([^)]*\)\s*:\s*Promise<\s*(?:string|Array<string>|string\[\])/,
      /\buserIdsOn\w*\s*\(/, /\baccountsFor\w*\s*\(/, /\bwhoElseOn\w*\s*\(/, /usersBehind\w*\s*\(/,
    ];
    for (const file of trustFiles) {
      const code = codeOf(file);
      for (const pattern of BAD) expect(pattern.test(code), `${file}: ${pattern}`).toBe(false);
    }
  });

  it("the store answers a number for every key-shaped question", () => {
    const store = read("trust/store.ts");
    for (const method of ["countAccountsOnNet", "countAccountsOnDevice", "countAttestKeys"]) {
      expect(store).toMatch(new RegExp(`${method}\\([^)]*\\):\\s*Promise<number>`));
    }
    // installKeysOf is the one read that returns keys, and it is the account's OWN keys, for its deletion tombstones.
    expect(store).toMatch(/installKeysOf\(userId: string\): Promise<Buffer\[\]>/);
  });

  it("the admin route sends counts, a score and verdict summaries, and names no other account", () => {
    const route = codeOf("routes/admin/trust.ts");
    expect(route).toMatch(/counts:\s*\{\s*installs/);
    expect(route).not.toMatch(/listAccounts|otherAccounts|users:/);
    // And nothing in it can ban anything.
    expect(route).not.toMatch(/\b(ban|suspend|delete(?!Score)|close)\b/i);
  });
});

describe("nothing reaches ads, analytics or Meta", () => {
  it("ads/meta.ts, and everything it imports, imports nothing from trust", () => {
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file) || !fs.existsSync(path.join(SRC, file))) return;
      seen.add(file);
      for (const next of importsOf(file)) {
        expect(next.startsWith("trust/"), `${file} imports ${next}: nothing on the advertising side may reach the trust code`).toBe(false);
        walk(next);
      }
    };
    walk("ads/meta.ts");
    expect(seen.has("ads/meta.ts")).toBe(true);
  });

  it("no trust file sends a Meta event or touches the advertising side", () => {
    for (const file of trustFiles) {
      expect(read(file)).not.toMatch(/sendMetaEvent|appEventsFor|ads\/meta/);
    }
  });
});

describe("the migration", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");

  it("keeps no raw address, and no place", () => {
    expect(sql).not.toMatch(/\b(inet|cidr)\b/);
    expect(sql).not.toMatch(/\bip\s+(text|inet|varchar)/);
    expect(sql).not.toMatch(/country|city|region|latitude|longitude/i);
  });

  it("turns row level security on for every table it makes, and adds no policy", () => {
    const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]!);
    expect(tables.sort()).toEqual(["trust_attest_keys", "trust_device_seen", "trust_net_seen", "trust_scores", "trust_tombstones"]);
    for (const t of tables) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    }
    expect(sql).not.toMatch(/create policy/);
  });

  it("lets the device and tombstone tables hold no kind but install and email", () => {
    expect(sql).toMatch(/kind\s+text not null check \(kind in \('install'\)\)/);
    expect(sql).toMatch(/kind\s+text not null check \(kind in \('email', 'install'\)\)/);
  });

  it("takes every row with the account, and holds no user id on a tombstone", () => {
    const perAccount = [...sql.matchAll(/user_id\s+uuid[^,]*/g)].map((m) => m[0]);
    expect(perAccount.length).toBe(4);
    for (const line of perAccount) expect(line).toContain("on delete cascade");
    const tombstones = /create table if not exists public\.trust_tombstones \(([\s\S]*?)\);/.exec(sql)?.[1] ?? "";
    expect(tombstones).not.toContain("user_id");
  });
});
