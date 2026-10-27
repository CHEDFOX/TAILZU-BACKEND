/**
 * THE ENDPOINT FOR THE PERSON'S OWN APPS (src/bots/keys.ts, service.ts askWithKey): A KEY FOR ONE BOT, HASHED, SHOWN ONCE, REVOCABLE, RATE-LIMITED AND BUDGETED.
 *
 *   - a key is 256 random bits behind tzb_; only sha256(pepper + key) is kept, with its first characters; the key is shown once, then masked
 *   - a revoked key stops working; a key for another bot, an unknown, a malformed one and a key made under another pepper are all refused
 *   - a key has its own rate (a minute) and its own day's money, and the bot has its own; a refusal says when to come back
 *   - an app with a key runs as the owner (their apps, their files) but never touches their memory
 *   - the public card shows nothing until the owner turns it on, and then only the name, purpose, colour and skills
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { ALICE, BOB, PEPPER, rig, def } = await import("./bots-rig.js");
const { newKey, hashKey, maskKey, prefixOf, bearerKey, looksLikeKey, KEY_SHAPE } = await import("../src/bots/keys.js");
const { Bots } = await import("../src/bots/service.js");

const bearer = (key: string) => `Bearer ${key}`;
const make = async (r: Awaited<ReturnType<typeof rig>>, slug: string, user = ALICE) => r.bots.create(user, def({ slug, name: `Bot ${slug}` }));

describe("a key", () => {
  it("is tzb_ and 256 random bits, a different one each time", () => {
    const keys = Array.from({ length: 50 }, () => newKey());
    expect(new Set(keys).size).toBe(50);
    for (const k of keys) { expect(k).toMatch(KEY_SHAPE); expect(k.length).toBe(47); }
  });

  it("is kept as sha256 of the pepper and the key, and a different pepper gives a different hash", () => {
    const k = newKey();
    expect(hashKey(k, PEPPER)).toBe(createHash("sha256").update(PEPPER).update(":").update(k).digest("hex"));
    expect(hashKey(k, PEPPER)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey(k, `${PEPPER}x`)).not.toBe(hashKey(k, PEPPER));
    expect(hashKey(`${k}x`, PEPPER)).not.toBe(hashKey(k, PEPPER));
    expect(maskKey(prefixOf(k))).toBe(`${k.slice(0, 8)}…`);
  });

  it("is read from an Authorization header, and only if it is one of ours", () => {
    const k = newKey();
    expect(bearerKey(`Bearer ${k}`)).toBe(k);
    expect(bearerKey(`bearer   ${k}  `)).toBe(k);
    for (const h of [undefined, "", k, `Basic ${k}`, "Bearer tzb_short", `Bearer ${k}x`, `Bearer ${["eyJhbGciOiJIUzI1NiJ9", "e30", "x"].join(".")}`]) expect(bearerKey(h as never), String(h)).toBeNull();
    expect(looksLikeKey(`Bearer ${k}`)).toBe(true);
    expect(looksLikeKey("Bearer tzb_anything")).toBe(true);
    expect(looksLikeKey(`Bearer ${["eyJhbGciOiJIUzI1NiJ9", "e30", "x"].join(".")}`)).toBe(false);
    expect(looksLikeKey(undefined)).toBe(false);
  });
});

describe("making and showing keys", () => {
  it("shows the key once, and afterwards only a masked prefix", async () => {
    const r = await rig(() => "hi");
    await make(r, "api-bot");
    const made = await r.bots.createKey(ALICE, "api-bot", "  my   app ");
    expect(made.key).toMatch(KEY_SHAPE);
    expect(made.view).toMatchObject({ label: "my app", masked: `${made.key.slice(0, 8)}…`, lastUsedAt: null, revokedAt: null, active: true });
    expect(JSON.stringify(made.view)).not.toContain(made.key);
    const listed = await r.bots.listKeys(ALICE, "api-bot");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(made.view);
    expect(JSON.stringify(listed)).not.toContain(made.key.slice(8));
  });

  it("stores only the hash: the key is in no row, nor any export", async () => {
    const r = await rig(() => "hi");
    const { bot } = await make(r, "api-bot");
    const { key } = await r.bots.createKey(ALICE, "api-bot", "x");
    const rows = await r.store.listKeys(ALICE, bot.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hash).toBe(hashKey(key, PEPPER));
    expect(rows[0]!.prefix).toBe(key.slice(0, 8));
    expect(JSON.stringify(rows)).not.toContain(key);
    expect(JSON.stringify(await r.bots.exportAll(ALICE))).not.toContain(key);
    expect(JSON.stringify(await r.bots.exportAll(ALICE))).not.toContain(hashKey(key, PEPPER));
    expect((await r.store.findKey(hashKey(key, PEPPER)))!.botId).toBe(bot.id);
    expect(await r.store.findKey(hashKey(key, "another pepper"))).toBeNull();
  });

  it("is the owner's only: another person cannot make, list or revoke a bot's keys, and a built-in has none", async () => {
    const r = await rig(() => "hi");
    await make(r, "api-bot");
    const { view } = await r.bots.createKey(ALICE, "api-bot", "x");
    await expect(r.bots.createKey(BOB, "api-bot", "x")).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(r.bots.listKeys(BOB, "api-bot")).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(r.bots.revokeKey(BOB, "api-bot", view.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(r.bots.createKey(ALICE, "travel", "x")).rejects.toMatchObject({ code: "builtin", status: 403 });
    await make(r, "bobs-bot", BOB);
    await expect(r.bots.revokeKey(BOB, "bobs-bot", view.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect((await r.bots.listKeys(ALICE, "api-bot"))[0]!.active).toBe(true);
  });

  it("is at most five at once, and there is none without a pepper", async () => {
    const r = await rig(() => "hi");
    await make(r, "api-bot");
    for (let i = 0; i < 5; i += 1) await r.bots.createKey(ALICE, "api-bot", `k${i}`);
    await expect(r.bots.createKey(ALICE, "api-bot", "k6")).rejects.toMatchObject({ code: "key_limit", status: 409 });
    const first = (await r.bots.listKeys(ALICE, "api-bot"))[0]!;
    await r.bots.revokeKey(ALICE, "api-bot", first.id);
    await expect(r.bots.createKey(ALICE, "api-bot", "k7")).resolves.toBeTruthy();
    const bare = await rig(() => "hi", { pepper: null });
    await make(bare, "api-bot");
    await expect(bare.bots.createKey(ALICE, "api-bot", "x")).rejects.toMatchObject({ code: "not_configured", status: 503 });
    await expect(bare.bots.askWithKey(`Bearer ${newKey()}`, "api-bot", { message: "hi" })).rejects.toMatchObject({ code: "not_configured", status: 503 });
    await expect(r.bots.createKey(ALICE, "api-bot", 5)).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("asking with a key", () => {
  it("answers as the owner's bot, and says what is left of the key's day", async () => {
    const r = await rig(() => "Hello from the bot.");
    await make(r, "api-bot");
    const { key } = await r.bots.createKey(ALICE, "api-bot", "x");
    const out = await r.bots.askWithKey(bearer(key), "api-bot", { message: "hi" });
    expect(out.answer.text).toBe("Hello from the bot.");
    expect(out.answer.bot.slug).toBe("api-bot");
    expect(out.leftTodayPaise).toBe(500 - out.answer.paise);
    expect(r.model.of("bot.run")[0]!.user).toContain("Name: Bot api-bot");
  });

  it("records when the key was last used", async () => {
    const r = await rig(() => "hi");
    await make(r, "api-bot");
    const { key, view } = await r.bots.createKey(ALICE, "api-bot", "x");
    r.now.t += 60_000;
    await r.bots.askWithKey(bearer(key), "api-bot", { message: "hi" });
    await new Promise((res) => setTimeout(res, 5));
    const after = (await r.bots.listKeys(ALICE, "api-bot"))[0]!;
    expect(after.lastUsedAt).toBe(r.now.t);
    expect(after.lastUsedAt).toBeGreaterThan(view.createdAt);
  });

  it("refuses a key that is not a key, an unknown one, and one made under another pepper: the same words each time", async () => {
    const r = await rig(() => "hi");
    await make(r, "api-bot");
    const { key } = await r.bots.createKey(ALICE, "api-bot", "x");
    const other = new Bots({ store: r.store, call: r.model.call, pepper: "a-different-pepper-for-the-same-table-0123456789", ports: {} });
    const words: string[] = [];
    for (const [bots, header] of [[r.bots, undefined], [r.bots, "Bearer nope"], [r.bots, bearer(newKey())], [other, bearer(key)]] as const) {
      const e = await bots.askWithKey(header as never, "api-bot", { message: "hi" }).catch((x) => x);
      expect(e).toMatchObject({ code: "invalid_key", status: 401 });
      words.push(e.message);
    }
    expect(new Set(words).size).toBe(1);
    expect(r.model.of("bot.run")).toHaveLength(0);
  });

  it("refuses a good key at another bot's address", async () => {
    const r = await rig(() => "hi");
    await make(r, "bot-a");
    await make(r, "bot-b");
    await make(r, "bobs-bot", BOB);
    const a = await r.bots.createKey(ALICE, "bot-a", "a");
    const b = await r.bots.createKey(ALICE, "bot-b", "b");
    await expect(r.bots.askWithKey(bearer(a.key), "bot-b", { message: "hi" })).rejects.toMatchObject({ code: "wrong_bot", status: 403 });
    await expect(r.bots.askWithKey(bearer(b.key), "bot-a", { message: "hi" })).rejects.toMatchObject({ code: "wrong_bot", status: 403 });
    await expect(r.bots.askWithKey(bearer(a.key), "bobs-bot", { message: "hi" })).rejects.toMatchObject({ code: "wrong_bot", status: 403 });
    await expect(r.bots.askWithKey(bearer(a.key), "travel", { message: "hi" })).rejects.toMatchObject({ code: "wrong_bot", status: 403 });
    expect(r.model.of("bot.run")).toHaveLength(0);
    await expect(r.bots.askWithKey(bearer(a.key), "bot-a", { message: "hi" })).resolves.toBeTruthy();
  });

  it("stops working the moment it is revoked, and the other keys go on", async () => {
    const r = await rig(() => "hi");
    await make(r, "api-bot");
    const one = await r.bots.createKey(ALICE, "api-bot", "one");
    const two = await r.bots.createKey(ALICE, "api-bot", "two");
    await r.bots.askWithKey(bearer(one.key), "api-bot", { message: "hi" });
    await r.bots.revokeKey(ALICE, "api-bot", one.view.id);
    await expect(r.bots.askWithKey(bearer(one.key), "api-bot", { message: "hi" })).rejects.toMatchObject({ code: "invalid_key", status: 401 });
    await expect(r.bots.askWithKey(bearer(two.key), "api-bot", { message: "hi" })).resolves.toBeTruthy();
    const keys = await r.bots.listKeys(ALICE, "api-bot");
    expect(keys.map((k) => k.active)).toEqual([false, true]);
    expect(keys[0]!.revokedAt).toBe(r.now.t);
    // revoking again is still a revoked key
    await expect(r.bots.revokeKey(ALICE, "api-bot", one.view.id)).resolves.toBeUndefined();
    await expect(r.bots.revokeKey(ALICE, "api-bot", "00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "not_found" });
  });

  it("stops working when its bot is deleted", async () => {
    const r = await rig(() => "hi");
    await make(r, "api-bot");
    const { key } = await r.bots.createKey(ALICE, "api-bot", "x");
    await r.bots.remove(ALICE, "api-bot");
    await expect(r.bots.askWithKey(bearer(key), "api-bot", { message: "hi" })).rejects.toMatchObject({ code: "invalid_key", status: 401 });
    expect(await r.store.findKey(hashKey(key, PEPPER))).toBeNull();
  });

  it("is rate-limited for each key, and says when to come back", async () => {
    const r = await rig(() => "hi", { limits: { keyRatePerMin: 3 } });
    await make(r, "api-bot");
    const one = await r.bots.createKey(ALICE, "api-bot", "one");
    const two = await r.bots.createKey(ALICE, "api-bot", "two");
    for (let i = 0; i < 3; i += 1) await r.bots.askWithKey(bearer(one.key), "api-bot", { message: "hi" });
    const e = await r.bots.askWithKey(bearer(one.key), "api-bot", { message: "hi" }).catch((x) => x);
    expect(e).toMatchObject({ code: "rate_limited", status: 429, detail: { retryAfterSec: expect.any(Number) } });
    expect(e.detail.retryAfterSec).toBeGreaterThan(0);
    expect(e.detail.retryAfterSec).toBeLessThanOrEqual(60);
    // another key is not held back by it
    await expect(r.bots.askWithKey(bearer(two.key), "api-bot", { message: "hi" })).resolves.toBeTruthy();
    expect(r.model.of("bot.run")).toHaveLength(4);
    r.now.t += 61_000;
    await expect(r.bots.askWithKey(bearer(one.key), "api-bot", { message: "hi" })).resolves.toBeTruthy();
  });

  it("is budgeted for each key's day, and the bot's own day, and starts again tomorrow", async () => {
    const r = await rig(() => "hi", { paise: 4, limits: { keyDailyPaise: 8 } });
    await r.bots.create(ALICE, def({ slug: "api-bot", budgets: { perRequestPaise: 20, dailyPaise: 1000 } }));
    const { key } = await r.bots.createKey(ALICE, "api-bot", "x");
    const left: number[] = [];
    for (let i = 0; i < 2; i += 1) left.push((await r.bots.askWithKey(bearer(key), "api-bot", { message: "hi" })).leftTodayPaise);
    expect(left).toEqual([4, 0]);
    await expect(r.bots.askWithKey(bearer(key), "api-bot", { message: "hi" })).rejects.toMatchObject({ code: "key_daily_limit", status: 429, detail: { retryAfterSec: expect.any(Number) } });
    r.now.t += 25 * 3_600_000;
    await expect(r.bots.askWithKey(bearer(key), "api-bot", { message: "hi" })).resolves.toBeTruthy();
    // a second key does not get the first one's money back, but the bot's own day is shared by all its keys and its owner
    const small = await rig(() => "hi", { paise: 5 });
    await small.bots.create(ALICE, def({ slug: "api-bot", budgets: { perRequestPaise: 5, dailyPaise: 10 } }));
    const a = await small.bots.createKey(ALICE, "api-bot", "a");
    const b = await small.bots.createKey(ALICE, "api-bot", "b");
    await small.bots.askWithKey(bearer(a.key), "api-bot", { message: "hi" });
    await small.bots.askWithKey(bearer(b.key), "api-bot", { message: "hi" });
    await expect(small.bots.askWithKey(bearer(a.key), "api-bot", { message: "hi" })).rejects.toMatchObject({ code: "bot_daily_limit", status: 429 });
    await expect(small.bots.ask(ALICE, "api-bot", { message: "hi" })).rejects.toMatchObject({ code: "bot_daily_limit", status: 429 });
  });

  it("holds one request to the bot's per-request budget whatever the key may spend", async () => {
    const r = await rig(() => "hi", { paise: 4 });
    await r.bots.create(ALICE, def({ slug: "api-bot", budgets: { perRequestPaise: 3, dailyPaise: 100 } }));
    const { key } = await r.bots.createKey(ALICE, "api-bot", "x");
    await expect(r.bots.askWithKey(bearer(key), "api-bot", { message: "hi" })).rejects.toMatchObject({ code: "budget", status: 402 });
  });

  it("runs as the owner with their connected apps: a change waits for the owner's yes, whoever's app asked", async () => {
    const { toolCall } = await import("./bots-rig.js");
    const r = await rig((_s, n) => (n === 0 ? { toolCalls: [toolCall("fake-cal__create_event", { title: "Gym" })] } : "Waiting."));
    await r.bots.create(ALICE, def({ slug: "api-bot", skills: { connectors: ["fake-cal"] } }));
    const { key } = await r.bots.createKey(ALICE, "api-bot", "x");
    const out = await r.bots.askWithKey(bearer(key), "api-bot", { message: "put gym on the calendar" });
    expect(r.conn.done).toEqual([]);
    expect(out.answer.approvals).toHaveLength(1);
    expect((await r.conn.tasks.list(ALICE))[0]!.state).toBe("waiting");
    // the task's title does not hold what the caller sent
    expect((await r.conn.tasks.list(ALICE))[0]!.title).toBe("Workout buddy bot");
  });
});

describe("the public card", () => {
  it("shows nothing until the owner turns it on, and then only the name, purpose, colour and skills", async () => {
    const r = await rig(() => "hi");
    await r.bots.create(ALICE, def({ slug: "api-bot", principles: ["A private rule."], skills: { web: true, connectors: ["fake-cal"] } }));
    expect((await r.bots.get(ALICE, "api-bot")).publicCard).toBe(false);
    expect(await r.bots.card("api-bot")).toBeNull();
    expect(await r.bots.card("nobody")).toBeNull();
    expect(await r.bots.card("travel")).toBeNull();
    await r.bots.update(ALICE, "api-bot", { publicCard: true });
    const card = await r.bots.card("API-BOT");
    expect(card).toEqual({ slug: "api-bot", name: "Workout buddy", colour: expect.any(String), purpose: "Plans my workouts and checks my calendar.", skills: { web: true, files: false, artifacts: false, code: false, research: false } });
    expect(JSON.stringify(card)).not.toMatch(/private rule|fake-cal|ownerId|principles|knowledge|budgets/);
    await r.bots.update(ALICE, "api-bot", { publicCard: false });
    expect(await r.bots.card("api-bot")).toBeNull();
  });
});
