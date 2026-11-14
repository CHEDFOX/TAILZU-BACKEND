/**
 * THE ROWS, AND THE 30 DAYS (src/trust/store.ts, src/trust/sweeper.ts, migration 0093; docs/trust.md §storage).
 *
 *   - counts, never a list: nothing here can hand back the OTHER accounts behind a key (rule 9)
 *   - a tombstone carries no user id, and goes at 30 days
 *   - deleting an account writes its tombstones just before the delete, and a cancelled deletion leaves none
 *   - the sweeper drops everything older than 30 days and blanks the address on a used sign-in row
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
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

const { MemoryTrustStore, resetTrustStoreForTests, tombstoneAccount, trustStore } = await import("../src/trust/store.js");
const { sweepTrust, startTrustSweeper } = await import("../src/trust/sweeper.js");
const { emailKey, normaliseEmail } = await import("../src/trust/email.js");
const { keyOf, netKey } = await import("../src/trust/netKey.js");
const { dayKeyBefore, dayKeyOf } = await import("../src/trust/signals.js");
const { blankOldDeviceLinks, memoryLinkStore } = await import("../src/auth/deviceLink.js");
const { sweepDeletions, MemoryDeletionStore } = await import("../src/you/deletion.js");
const { resetConfigForTests } = await import("../src/config.js");
resetConfigForTests();

const NOW = Date.parse("2026-11-14T10:00:00Z");
const DAY = 86_400_000;

let store: MemoryTrustStore;
beforeEach(() => {
  store = new MemoryTrustStore();
  resetTrustStoreForTests(store);
});

describe("one row a network, account and day", () => {
  it("writes once and counts the accounts, never naming them", async () => {
    const key = netKey("1.2.3.4")!;
    const day = dayKeyOf(NOW);
    await store.seeNet({ netKey: key, userId: "a", day, asn: 64496, netClass: "home", newAcct: true, at: NOW });
    await store.seeNet({ netKey: key, userId: "a", day, asn: 64496, netClass: "home", newAcct: true, at: NOW + 1000 });
    await store.seeNet({ netKey: key, userId: "b", day, asn: 64496, netClass: "home", newAcct: true, at: NOW });
    expect(await store.countAccountsOnNet(key, day)).toBe(2);
    // The answer is a number. Nothing in the store's own interface returns the ids behind a key.
    expect(typeof (await store.countAccountsOnNet(key, day))).toBe("number");
    expect(await store.countAccountsOnNet(netKey("9.9.9.9")!, day)).toBe(0);
  });

  it("counts only the NEW accounts, so a shared home is not scored for being busy", async () => {
    const key = netKey("1.2.3.4")!;
    const day = dayKeyOf(NOW);
    // One house, one line: five accounts that have been there for a year, and one person signing up today.
    for (const id of ["a", "b", "c", "d", "e"]) {
      await store.seeNet({ netKey: key, userId: id, day, asn: 64496, netClass: "home", newAcct: false, at: NOW });
    }
    expect(await store.countAccountsOnNet(key, day)).toBe(0);
    await store.seeNet({ netKey: key, userId: "today", day, asn: 64496, netClass: "home", newAcct: true, at: NOW });
    expect(await store.countAccountsOnNet(key, day)).toBe(1);
  });

  it("counts only the days asked for", async () => {
    const key = netKey("1.2.3.4")!;
    await store.seeNet({ netKey: key, userId: "old", day: dayKeyBefore(NOW, 20), asn: null, netClass: "home", newAcct: true, at: NOW - 20 * DAY });
    await store.seeNet({ netKey: key, userId: "new", day: dayKeyOf(NOW), asn: null, netClass: "home", newAcct: true, at: NOW });
    expect(await store.countAccountsOnNet(key, dayKeyOf(NOW))).toBe(1);
    expect(await store.countAccountsOnNet(key, dayKeyBefore(NOW, 30))).toBe(2);
  });
});

describe("the install id", () => {
  it("counts the accounts on one install, and gives an account its OWN keys back and nobody else's", async () => {
    const mine = keyOf("install", "11111111-1111-4111-8111-111111111111")!;
    const theirs = keyOf("install", "22222222-2222-4222-8222-222222222222")!;
    await store.seeDevice({ deviceKey: mine, kind: "install", userId: "a", at: NOW });
    await store.seeDevice({ deviceKey: mine, kind: "install", userId: "b", at: NOW });
    await store.seeDevice({ deviceKey: theirs, kind: "install", userId: "c", at: NOW });
    expect(await store.countAccountsOnDevice(mine)).toBe(2);
    expect(await store.countAccountsOnDevice(theirs)).toBe(1);
    expect(await store.installKeysOf("a")).toEqual([mine]);
    expect(await store.installKeysOf("c")).toEqual([theirs]);
    expect(await store.installKeysOf("nobody")).toEqual([]);
  });
});

describe("the tombstones", () => {
  it("carry no user id at all", async () => {
    const key = emailKey("Someone+tag@Gmail.com")!;
    await store.tombstone(key, "email", NOW);
    expect(await store.tombstoned(key, "email")).toBe(true);
    // The same mailbox, written differently, is the same key; a different mailbox is not.
    expect(normaliseEmail("s.o.m.e.one+other@gmail.com")).toBe("someone@gmail.com");
    expect(await store.tombstoned(emailKey("s.o.m.e.one@googlemail.com")!, "email")).toBe(false);
    expect(await store.tombstoned(key, "install")).toBe(false);
  });

  /**
   * The tombstone is written by the ERASE, not by the sweep: the seven-day sweep and the immediate DELETE /v1/account
   * both go through eraseAccount (routes/account/account.ts), and writing it in the sweep left the immediate delete —
   * which is what the phone's own delete screen calls — resetting the free plan with nothing kept.
   */
  it("are written by the erase, which both ways out go through, and not by the sweep", async () => {
    const deletions = new MemoryDeletionStore();
    await deletions.schedule("u-going", NOW - 8 * DAY, NOW - DAY);
    await deletions.schedule("u-staying", NOW - DAY, NOW + 6 * DAY);
    const install = keyOf("install", "33333333-3333-4333-8333-333333333333")!;
    await store.seeDevice({ deviceKey: install, kind: "install", userId: "u-going", at: NOW });
    // The sweep on its own writes nothing: an erase that does not tombstone leaves no row.
    const noTombstone = await sweepDeletions({ store: deletions, erase: async () => true, now: NOW });
    expect(noTombstone.deleted).toBe(1);
    expect(await store.tombstoned(install, "install")).toBe(false);

    // The real erase does, which is what the sweep calls. The account that is staying left nothing either way.
    await deletions.schedule("u-next", NOW - 8 * DAY, NOW - DAY);
    await store.seeDevice({ deviceKey: install, kind: "install", userId: "u-next", at: NOW });
    const erased: string[] = [];
    const got = await sweepDeletions({
      store: deletions,
      erase: async (id) => { erased.push(id); await tombstoneAccount(id, { now: NOW, store, email: "going@example.com" }); return true; },
      now: NOW,
    });
    expect(got.deleted).toBe(1);
    expect(erased).toEqual(["u-next"]);
    expect(await store.tombstoned(install, "install")).toBe(true);
    expect(await store.tombstoned(emailKey("going@example.com")!, "email")).toBe(true);
    expect(await store.installKeysOf("u-staying")).toEqual([]);
  });

  it("are not written at all while TRUST is off: the kill switch has to mean it", async () => {
    process.env.TRUST = "off";
    resetConfigForTests();
    try {
      const install = keyOf("install", "55555555-5555-4555-8555-555555555555")!;
      await store.seeDevice({ deviceKey: install, kind: "install", userId: "u-off", at: NOW });
      expect(await tombstoneAccount("u-off", { now: NOW, store, email: "off@example.com" }))
        .toEqual({ email: false, installs: 0 });
      expect(await store.tombstoned(emailKey("off@example.com")!, "email")).toBe(false);
      expect(await store.tombstoned(install, "install")).toBe(false);
    } finally {
      process.env.TRUST = "shadow";
      resetConfigForTests();
    }
  });

  it("tombstoneAccount takes the address it is given rather than asking for one", async () => {
    const got = await tombstoneAccount("u-x", { now: NOW, store, email: "someone@example.com" });
    expect(got).toEqual({ email: true, installs: 0 });
    expect(await store.tombstoned(emailKey("someone@example.com")!, "email")).toBe(true);
    // No address: nothing to hash, and no row.
    expect(await tombstoneAccount("u-y", { now: NOW, store, email: "" })).toEqual({ email: false, installs: 0 });
  });
});

describe("the attestation keys", () => {
  it("are kept per account, counted, and never handed to another account", async () => {
    const row = {
      keyId: "k1", userId: "a", publicKey: Buffer.from("spki"), signCount: 0,
      env: "production" as const, receipt: null, createdAt: NOW, lastUsedAt: NOW,
    };
    await store.putAttestKey(row);
    await store.putAttestKey({ ...row, keyId: "k2" });
    await store.putAttestKey({ ...row, keyId: "k3", userId: "b" });
    expect(await store.countAttestKeys("a")).toBe(2);
    expect(await store.countAttestKeys("b")).toBe(1);
    expect((await store.attestKey("k1"))?.userId).toBe("a");
    await store.usedAttestKey("k1", 7, NOW + 1000);
    expect((await store.attestKey("k1"))?.signCount).toBe(7);
    expect(await store.attestKey("nope")).toBeNull();
  });
});

describe("the score row", () => {
  it("holds the reasons and the verdicts, and an admin can take it away", async () => {
    await store.putScore({ userId: "a", score: 55, reasons: ["tor", "script"], action: "slow", verdicts: { appAttest: "ok" }, updatedAt: NOW });
    const row = await store.score("a");
    expect(row?.reasons).toEqual(["tor", "script"]);
    expect(row?.verdicts).toEqual({ appAttest: "ok" });
    await store.clearScore("a");
    expect(await store.score("a")).toBeNull();
  });
});

describe("the sweeper", () => {
  it("drops everything older than 30 days and keeps what is newer", async () => {
    const key = netKey("1.2.3.4")!;
    await store.seeNet({ netKey: key, userId: "old", day: dayKeyBefore(NOW, 40), asn: null, netClass: "home", newAcct: true, at: NOW - 40 * DAY });
    await store.seeNet({ netKey: key, userId: "new", day: dayKeyOf(NOW), asn: null, netClass: "home", newAcct: true, at: NOW });
    await store.seeDevice({ deviceKey: keyOf("install", "44444444-4444-4444-8444-444444444444")!, kind: "install", userId: "old", at: NOW - 40 * DAY });
    await store.tombstone(Buffer.from("aa", "hex"), "email", NOW - 40 * DAY);
    await store.tombstone(Buffer.from("bb", "hex"), "email", NOW);
    await store.putAttestKey({
      keyId: "k-old", userId: "a", publicKey: Buffer.from("x"), signCount: 0, env: "production",
      receipt: null, createdAt: NOW - 90 * DAY, lastUsedAt: NOW - 40 * DAY,
    });
    const swept = await sweepTrust(NOW, store);
    expect(swept).toMatchObject({ net: 1, device: 1, tombstones: 1, attest: 1 });
    expect(swept.verdicts).toBe(0);
    expect(await store.countAccountsOnNet(key, dayKeyBefore(NOW, 30))).toBe(1);
    expect(await store.tombstoned(Buffer.from("bb", "hex"), "email")).toBe(true);
    expect(await store.tombstoned(Buffer.from("aa", "hex"), "email")).toBe(false);
    expect(await store.attestKey("k-old")).toBeNull();
  });

  /**
   * The policy says Apple's and Google's answers are kept 30 days. The score ROW lives as long as the account — it is
   * worked out again on every launch — so without this the answers on it would outlive the promise for ever: every
   * bootstrap rewrites `updated_at`, which is why each answer carries its own time.
   */
  it("drops an answer from Apple or Google 30 days after it was given, and keeps a fresh one", async () => {
    await store.putScore({
      userId: "a", score: 10, reasons: [], action: "none", updatedAt: NOW,
      verdicts: {
        appAttest: "ok",
        deviceCheck: { bit0: true, bit1: false },
        integrity: { app: "PLAY_RECOGNIZED" },
        at: { appAttest: NOW - 40 * DAY, deviceCheck: NOW - 2 * DAY, integrity: NOW - 200 * DAY },
      },
    });
    const swept = await sweepTrust(NOW, store);
    expect(swept.verdicts).toBe(1);
    const row = await store.score("a");
    expect(row?.verdicts).toEqual({ deviceCheck: { bit0: true, bit1: false }, at: { deviceCheck: NOW - 2 * DAY } });
    // The row itself stays: the score is the account's, and is recomputed anyway.
    expect(row?.score).toBe(10);
    // A second pass finds nothing left to drop.
    expect((await sweepTrust(NOW, store)).verdicts).toBe(0);
  });

  it("drops an answer that carries no time at all, rather than keeping it for ever", async () => {
    await store.putScore({
      userId: "b", score: 0, reasons: [], action: "none", updatedAt: NOW,
      verdicts: { appAttest: "ok" },
    });
    expect((await sweepTrust(NOW, store)).verdicts).toBe(1);
    expect((await store.score("b"))?.verdicts).toEqual({});
  });

  it("leaves the second-hand phone mark alone: it is an instruction, not an answer", async () => {
    await store.putScore({ userId: "c", score: 0, reasons: [], action: "none", verdicts: { deviceReset: true }, updatedAt: NOW });
    expect((await sweepTrust(NOW, store)).verdicts).toBe(0);
    expect((await store.score("c"))?.verdicts).toEqual({ deviceReset: true });
  });

  it("blanks the address and the browser string on a used sign-in row, and keeps the row", async () => {
    const links = memoryLinkStore();
    const row = {
      id: "r1", kind: "app" as const, tokenHash: "t", secretHash: "s", codeHash: "c", deviceName: "A Mac",
      platform: "mac" as const, ip: "1.2.3.4", userAgent: "Mozilla/5.0", status: "used" as const, userId: "a",
      createdAt: NOW - 40 * DAY, expiresAt: NOW - 40 * DAY, decidedAt: NOW - 40 * DAY, usedAt: NOW - 40 * DAY,
    };
    await links.insert(row);
    await links.insert({ ...row, id: "r2", usedAt: NOW, createdAt: NOW, status: "used" });
    await links.insert({ ...row, id: "r3", status: "pending", usedAt: null });
    expect(await blankOldDeviceLinks(NOW - 30 * DAY, links)).toBe(1);
    expect(links.rows.get("r1")).toMatchObject({ ip: null, userAgent: null, deviceName: "A Mac", status: "used" });
    expect(links.rows.get("r2")?.ip).toBe("1.2.3.4");
    // Asking twice blanks nothing the second time.
    expect(await blankOldDeviceLinks(NOW - 30 * DAY, links)).toBe(0);
    // With no database at all there is nothing to blank.
    expect(await blankOldDeviceLinks(NOW - 30 * DAY)).toBe(0);
  });

  it("runs a pass at once and stops when it is told to", async () => {
    const key = netKey("1.2.3.4")!;
    await store.seeNet({ netKey: key, userId: "old", day: dayKeyBefore(NOW, 40), asn: null, netClass: "home", newAcct: true, at: NOW - 40 * DAY });
    const lines: object[] = [];
    const stop = startTrustSweeper({ store, now: () => NOW, log: { info: (o) => lines.push(o), warn: () => undefined } });
    await new Promise((r) => setTimeout(r, 5));
    stop();
    expect(lines.length).toBe(1);
    expect(await store.countAccountsOnNet(key, dayKeyBefore(NOW, 60))).toBe(0);
  });
});

/**
 * The three places this half of abuse prevention lives outside the TypeScript: who writes the tombstone, whether the
 * sweeper runs at all, and whether the lists can be written to disk in the image that really ships. Each one was wrong
 * once, and each one is invisible from inside the code it breaks.
 */
describe("the wiring the server is deployed with", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, p), "utf8");

  it("writes the tombstone in the erase, which both ways out go through, and nowhere else", () => {
    // The seven-day sweep and the immediate DELETE /v1/account both run eraseAccount; writing it in the sweep alone left
    // the phone's own delete screen resetting the free plan while telling the person a hash is kept.
    const erase = read("../src/routes/account/account.ts");
    expect(erase).toMatch(/tombstoneAccount\(user\.id\)/);
    expect(erase.indexOf("tombstoneAccount(user.id)")).toBeLessThan(erase.indexOf("admin.auth.admin.deleteUser"));
    expect(read("../src/you/deletion.ts")).not.toMatch(/tombstoneAccount/);
    // And it is the sweep's own `erase` that runs it: the sweep does not write one itself.
    expect(read("../src/you/deletion.ts")).toMatch(/erase\(id\)/);
  });

  it("starts the sweeper whatever the mode is, and keeps only the downloads behind it", () => {
    // The sweeper only deletes, so the shadow period's rows and everything a kill switch leaves behind still go at 30
    // days. With it inside the mode check, TRUST=off meant nothing was ever swept.
    const server = read("../src/server.ts");
    const sweeper = server.indexOf("startTrustSweeper(");
    const gate = server.indexOf('if (trustMode() !== "off")');
    expect(sweeper).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(sweeper);
    expect(server.slice(gate)).toMatch(/startListRefresher\(/);
  });

  it("makes /data/trust in the image, so the daily download can write to it", () => {
    // docker-compose mounts a named volume there, and a named volume not pre-created in the image is root-owned: the
    // node user could not write, every list would stay empty and every network would read "unknown".
    const dockerfile = read("../Dockerfile");
    expect(dockerfile).toMatch(/mkdir -p [^\n]*\/data\/trust/);
    expect(dockerfile).toMatch(/chown -R node:node \/app \/data/);
  });
});

describe("the store the server really uses", () => {
  it("is the memory one while there is no service key, so a test never writes to the database", () => {
    expect(trustStore()).toBeInstanceOf(MemoryTrustStore);
  });
});
