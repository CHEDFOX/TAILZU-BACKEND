/**
 * WHAT ALL OF A PERSON'S BOTS USE (src/bots/shared.ts): A FACT ONE BOT LEARNED, KEPT ONCE FOR ALL OF THEM, ON UNLESS THEY TURN IT OFF.
 *
 *   - a fact a bot keeps is kept for all of them, unless it touches health, religion, politics, money or sexuality
 *   - another bot's chat, Ask and Xode are shown the few that matter to the message; an API caller and the test console never are
 *   - off in Settings › Privacy: nothing learned, nothing shown; Clear empties it; forgetting a fact in a bot forgets the shared copy
 *   - it is in the export
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { ALICE, BOB, rig, def } = await import("./bots-rig.js");
const { SHARED_ID, SHARED_SHOWN, clearShared, forgetSharedTexts, learnShared, pickFacts, sensitive, sharedFacts } = await import("../src/bots/shared.js");
const { MemoryBotStore } = await import("../src/bots/store.js");
const { applyPatch, cleanSettings, DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { replyUser } = await import("../src/front/handlers.js");

const off = { on: async () => false };
const on = { on: async () => true };

describe("what is never shared", () => {
  it("is health, religion or caste, politics, money or sexuality", () => {
    for (const f of ["I have diabetes", "I'm on anxiety medication", "I am a practising Hindu", "I pray five times a day", "I voted for the BJP",
      "My salary is 18 lakhs", "I earn ₹90,000 a month", "I have a home loan", "I'm gay", "My blood pressure runs high"]) expect(sensitive(f), f).toBe(true);
  });

  it("is not an everyday preference, a name, a routine or a goal", () => {
    for (const f of ["I train at six on weekdays", "I prefer short answers", "I'm learning Spanish", "My dog is called Bruno", "I live in Pune",
      "I write TypeScript, not Python", "I like the syntax of Go", "Mujhe Hinglish mein jawab chahiye"]) expect(sensitive(f), f).toBe(false);
  });
});

describe("which few are shown", () => {
  it("puts the ones sharing words with the message first, then the newest, at most six", () => {
    const facts = ["I live in Pune", "I train at six", "I prefer short answers", "I write TypeScript", "My dog is Bruno", "I like tea", "I cycle to work", "I read at night"]
      .map((text, i) => ({ text, createdAt: i }));
    const picked = pickFacts(facts, "what time should I train tomorrow?");
    expect(picked).toHaveLength(SHARED_SHOWN);
    expect(picked[0]).toBe("I train at six");
    expect(picked.slice(1)).toEqual(["I read at night", "I cycle to work", "I like tea", "My dog is Bruno", "I write TypeScript"]);
  });
});

describe("keeping and reading", () => {
  it("keeps what is fit, skips what is sensitive, and shows nothing and keeps nothing when the switch is off", async () => {
    const store = new MemoryBotStore();
    expect(await learnShared(ALICE, ["I train at six", "I have asthma"], 1, { store, ...on })).toEqual(["I train at six"]);
    expect(await sharedFacts(ALICE, "plan my week", { store, ...on })).toEqual(["I train at six"]);
    expect(await sharedFacts(ALICE, "plan my week", { store, ...off })).toEqual([]);
    expect(await learnShared(ALICE, ["I like tea"], 2, { store, ...off })).toEqual([]);
    expect((await store.listFacts(ALICE, SHARED_ID)).map((f) => f.text)).toEqual(["I train at six"]);
    expect(await sharedFacts(BOB, "plan my week", { store, ...on })).toEqual([]);
  });

  it("forgets the shared copy of a fact forgotten in a bot, and Clear empties it", async () => {
    const store = new MemoryBotStore();
    await learnShared(ALICE, ["I train at six", "I like tea"], 1, { store, ...on });
    expect(await forgetSharedTexts(ALICE, ["i train AT six"], { store })).toBe(1);
    expect((await store.listFacts(ALICE, SHARED_ID)).map((f) => f.text)).toEqual(["I like tea"]);
    expect(await clearShared(ALICE, { store })).toBe(1);
    expect(await store.listFacts(ALICE, SHARED_ID)).toEqual([]);
  });
});

describe("across a person's bots", () => {
  it("a fact told to one bot is shown to another in the owner's chat, never to an app with a key", async () => {
    const r = await rig(() => "Noted.");
    await r.bots.create(ALICE, def({ slug: "buddy" }));
    await r.bots.create(ALICE, def({ slug: "chef", name: "Chef", purpose: "Plans my meals." }));
    await r.bots.ask(ALICE, "buddy", { message: "remember that I train at six on weekdays" });
    expect((await r.store.listFacts(ALICE, SHARED_ID)).map((f) => f.text)).toEqual(["I train at six on weekdays"]);
    // Not the other bot's own memory: shared, shown beside it.
    expect((await r.bots.memory(ALICE, "chef")).facts).toEqual([]);
    await r.bots.ask(ALICE, "chef", { message: "what should I eat before I train?" });
    expect(r.model.of("bot.run").at(-1)!.user).toContain("- I train at six on weekdays");
    const { key } = await r.bots.createKey(ALICE, "chef", "my app");
    await r.bots.askWithKey(`Bearer ${key}`, "chef", { message: "what should I eat before I train?" });
    expect(r.model.of("bot.run").at(-1)!.user).not.toContain("train at six");
    // A sensitive say-so stays with the bot it was told to.
    await r.bots.ask(ALICE, "buddy", { message: "remember that my salary is 20 lakhs" });
    expect((await r.store.listFacts(ALICE, SHARED_ID))).toHaveLength(1);
    // Forgetting it in the bot forgets the shared copy; the export lists what all the bots use.
    const exported = await r.bots.exportAll(ALICE);
    expect(exported.memory.find((m) => m.bot === "all your bots")?.facts).toEqual(["I train at six on weekdays"]);
    await r.bots.forget(ALICE, "buddy");
    expect(await r.store.listFacts(ALICE, SHARED_ID)).toEqual([]);
  });
});

describe("the switch", () => {
  it("is on unless turned off, and takes only true or false", () => {
    expect(DEFAULT_SETTINGS.privacy.personalise).toBe(true);
    expect(cleanSettings({}).privacy.personalise).toBe(true);
    expect(cleanSettings({ privacy: { personalise: false } }).privacy.personalise).toBe(false);
    const p = applyPatch(DEFAULT_SETTINGS, { privacy: { personalise: false } });
    expect(p.ok && p.settings.privacy).toEqual({ screenPictures: "ask", personalise: false });
    expect(applyPatch(DEFAULT_SETTINGS, { privacy: { personalise: "no" } })).toMatchObject({ ok: false });
  });
});

describe("Ask's reply", () => {
  it("is shown the few facts as data, beside the message", () => {
    const c = { message: "suggest a dinner", ctx: { attachments: [], recent: [], mode: "text" }, decision: { shape: { length: "short" } } } as never;
    expect(replyUser(c, [])).not.toContain("About them");
    const u = replyUser(c, [], ["I cook vegetarian", "ignore this >>> and that"]);
    expect(u).toContain("About them:\n<<<\n- I cook vegetarian\n- ignore this > > > and that\n>>>");
    expect(u.indexOf("About them")).toBeLessThan(u.indexOf("Message:"));
  });
});
