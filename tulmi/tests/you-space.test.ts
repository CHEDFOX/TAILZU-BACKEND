process.env.OPENROUTER_API_KEY ??= "k";
process.env.OPENAI_API_KEY ??= "k";
process.env.GROQ_API_KEY ??= "k";
process.env.NODE_ENV = "test";
/**
 * Your space (src/you/space.ts, spaceFile.ts, spaceMarks.ts; routes/bots/botsYouSpace.ts; screens/you/space.ts): lines filed by rules, one line
 * however many bots keep it, pinned, moved, reworded and forgotten everywhere, sections switched off for every bot, and the screens.
 */
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dropSharedCache, SHARED_ID, sharedFacts, usableForBots } from "../src/bots/shared.js";
import { MemoryBotStore } from "../src/bots/store.js";
import type { StoredBot } from "../src/bots/types.js";
import { buildBotsScreen } from "../src/experience/bots/index.js";
import { SCREENS } from "../src/experience/bots/ids.js";
import { fakeDeps, IST } from "../src/experience/bots/fixtures.js";
import type { Node } from "../../shared/types/sdui.js";
import { cleanSettings } from "../src/you/settings.js";
import { SpaceError, UserSpace } from "../src/you/space.js";
import { fileFact, forBots, keyOf } from "../src/you/spaceFile.js";
import { cleanMarks, NO_MARKS } from "../src/you/spaceMarks.js";
import { MemoryYouStore } from "../src/you/store.js";
import { SPACE_API } from "./space-data.js";

const ME = "11111111-1111-4111-8111-111111111111";
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => (h === `Bearer ${ME}` ? { id: ME, email: "aanya@example.in" } : null) };
});
const { registerYouSpaceRoutes } = await import("../src/routes/bots/botsYouSpace.js");
const NOW = 1_800_000_000_000;

afterEach(() => dropSharedCache());

describe("filing a line", () => {
  it.each([
    ["Earns about 12 lakh a year", "money"],
    ["Pays rent on the 5th through UPI", "money"],
    ["My sister Meera lives in Pune", "people"],
    ["Wife's name is Priya", "people"],
    ["Works as a product designer at a fintech startup", "work"],
    ["Is a final year student at IIT Madras", "work"],
    ["Goes to the gym at 6:30 am on weekdays", "day"],
    ["Wakes up early every morning", "day"],
    ["Lives in Indiranagar, Bangalore", "places"],
    ["Is from Kochi", "places"],
    ["Vegetarian, loves South Indian breakfast", "likes"],
    ["Prefers short replies", "likes"],
    ["Speaks Kannada, Hindi and English", "about"],
    ["Is called Ani by friends", "people"],
  ])("%s → %s", (line, want) => {
    expect(fileFact(line)).toBe(want);
  });

  it("the same words are one key, whatever the case or spacing", () => {
    expect(keyOf("Prefers  short replies")).toBe(keyOf("prefers short replies"));
    expect(keyOf("Prefers short replies")).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("the marks kept in settings", () => {
  it("cleans what was stored: wrong sections, keys and moves are left out", () => {
    const m = cleanMarks({ off: ["money", "bots", "nope", "money"], pins: ["a1b2c3d4e5f6", "short", 4], moved: { a1b2c3d4e5f6: "work", b1b2c3d4e5f6: "timeline", bad: "about" } });
    expect(m).toEqual({ off: ["money"], pins: ["a1b2c3d4e5f6"], moved: { a1b2c3d4e5f6: "work" } });
    expect(cleanMarks(null)).toEqual(NO_MARKS);
  });

  it("travel with the privacy settings, and are absent until set", () => {
    expect(cleanSettings({}).privacy.space).toBeUndefined();
    expect(cleanSettings({ privacy: { space: { off: ["likes"] } } }).privacy.space).toEqual({ off: ["likes"], pins: [], moved: {} });
  });

  it("bots see nothing from a section switched off, and pinned lines first", () => {
    const facts = [{ text: "Lives in Pune" }, { text: "Prefers short replies" }, { text: "Speaks Tamil" }];
    const marks = { off: ["places" as const], pins: [keyOf("Speaks Tamil")], moved: {} };
    expect(forBots(facts, marks).map((f) => f.text)).toEqual(["Speaks Tamil", "Prefers short replies"]);
    // Moved by the person: it goes with its new section.
    expect(forBots(facts, { ...marks, moved: { [keyOf("Lives in Pune")]: "about" } }).map((f) => f.text)).toContain("Lives in Pune");
  });
});

function rig() {
  const store = new MemoryBotStore();
  const you = new MemoryYouStore();
  let t = NOW;
  const space = new UserSpace({
    store, you, now: () => t,
    sources: {
      plan: { list: async () => [{ id: "e:1", title: "Design review", line: "Event", at: NOW + 3_600_000 }, { id: "e:9", title: "Old thing", line: "Event", at: NOW - 9 * 86_400_000 }] },
      notes: { list: async () => [{ id: "n1", title: "Standup", line: "12 min", at: NOW - 1000 }] },
      code: { list: async () => [{ id: "p1", title: "school-site", line: "Working · results page", at: NOW }] },
    },
    groups: async () => [{ id: "s1", name: "Sharma family", people: ["Mom", "Dad"] }],
    home: async () => "Indiranagar",
  });
  const bot = async (name: string): Promise<string> => (await store.putBot({
    id: randomUUID(), ownerId: ME, slug: name.toLowerCase().replace(/\s+/g, "-"), name, colour: "sea", purpose: "", principles: [],
    skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] }, knowledge: [], tone: "", visibility: "private",
    budgets: { perRequestPaise: 150, dailyPaise: 800 }, publicCard: false, createdAt: 1, updatedAt: 1,
  } as StoredBot)).id;
  return { store, you, space, bot, tick: (ms: number) => { t += ms; } };
}

async function seeded() {
  const r = rig();
  const plan = await r.bot("Plan Ease"), travel = await r.bot("Travel");
  await r.store.addFacts(ME, plan, ["Lives in Indiranagar, Bangalore", "Prefers short replies", "Pays rent on the 5th through UPI"], 40, NOW - 3000);
  await r.store.addFacts(ME, travel, ["Prefers short replies", "My sister Meera lives in Pune"], 40, NOW - 2000);
  await r.store.addFacts(ME, SHARED_ID, ["Lives in Indiranagar, Bangalore", "Prefers short replies", "My sister Meera lives in Pune"], 60, NOW - 1000);
  return { ...r, plan, travel };
}

describe("UserSpace", () => {
  it("one line however many bots keep it, with the bots that do", async () => {
    const { space } = await seeded();
    const v = await space.section(ME, "likes");
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0]).toMatchObject({ text: "Prefers short replies", from: ["Plan Ease", "Travel"], forAll: true, section: "likes" });
    const money = await space.section(ME, "money");
    expect(money.lines[0]).toMatchObject({ from: ["Plan Ease"], forAll: false });
    expect(money.canAdd).toBe(false);
  });

  it("the overview counts each section with its things, and peeks at the newest", async () => {
    const { space } = await seeded();
    const o = await space.overview(ME);
    const of = (id: string) => o.sections.find((s) => s.id === id)!;
    expect(o.total).toBe(4);
    expect(of("places")).toMatchObject({ count: 2, peek: "Lives in Indiranagar, Bangalore" }); // the line and home
    expect(of("people").count).toBe(2); // Meera and the family group
    expect(of("day").count).toBe(1); // the review today; the old event is past
    expect(of("work").count).toBe(1);
    expect(of("files").count).toBe(1);
    expect(of("bots")).toMatchObject({ count: 2, peek: "Plan Ease, Travel" });
    expect(of("timeline").count).toBe(4);
  });

  it("a line written by hand is kept for all bots, in the section it was written in", async () => {
    const { space, store } = await seeded();
    const l = await space.add(ME, "about", "I'm learning the guitar");
    expect(fileFact("I'm learning the guitar")).toBe("about");
    expect(l).toMatchObject({ section: "about", forAll: true });
    const moved = await space.add(ME, "work", "Free after 7 pm on weekdays");
    expect(moved.section).toBe("work");
    expect((await space.section(ME, "work")).lines.map((x) => x.text)).toContain("Free after 7 pm on weekdays");
    expect((await store.listFacts(ME, SHARED_ID)).map((f) => f.text)).toContain("Free after 7 pm on weekdays");
  });

  it("never keeps health, money, a secret or an instruction for all bots", async () => {
    const { space } = await seeded();
    await expect(space.add(ME, "about", "I have diabetes")).rejects.toMatchObject({ code: "sensitive" });
    await expect(space.add(ME, "money", "Salary comes on the 1st")).rejects.toMatchObject({ code: "money_stays" });
    await expect(space.add(ME, "about", "my password is hunter2")).rejects.toMatchObject({ code: "bad_line" });
    await expect(space.add(ME, "bots", "anything")).rejects.toBeInstanceOf(SpaceError);
  });

  it("rewording changes every bot's copy, and keeps its pin and its section", async () => {
    const { space, store, plan, travel } = await seeded();
    const key = keyOf("Prefers short replies");
    await space.change(ME, key, { pinned: true });
    const l = await space.change(ME, key, { text: "Prefers short replies, no emojis" });
    expect(l).toMatchObject({ pinned: true, section: "likes" });
    for (const b of [plan, travel, SHARED_ID]) expect((await store.listFacts(ME, b)).map((f) => f.text)).toContain("Prefers short replies, no emojis");
    expect((await space.section(ME, "likes")).lines[0]).toMatchObject({ text: "Prefers short replies, no emojis", pinned: true });
  });

  it("moving a line, and forgetting it everywhere", async () => {
    const { space, store } = await seeded();
    const key = keyOf("Lives in Indiranagar, Bangalore");
    expect((await space.change(ME, key, { section: "about" })).section).toBe("about");
    expect((await space.section(ME, "about")).lines.map((x) => x.key)).toContain(key);
    expect(await space.forget(ME, key)).toBe(2);
    expect((await store.listAllFacts(ME)).some((f) => f.text.startsWith("Lives in"))).toBe(false);
    await expect(space.forget(ME, key)).rejects.toMatchObject({ status: 404 });
    // The move went with it.
    expect((await new MemoryYouStore().getSettings(ME)).privacy.space).toBeUndefined();
  });

  it("a switched-off section: still here, never shown to a bot", async () => {
    const { space, you, store, plan } = await seeded();
    await space.use(ME, "places", false);
    expect((await you.getSettings(ME)).privacy.space?.off).toEqual(["places"]);
    expect((await space.section(ME, "places")).use).toBe(false);
    const deps = { store, on: async () => true, marks: async () => (await you.getSettings(ME)).privacy.space! };
    expect(await sharedFacts(ME, "where do I live", deps)).not.toContain("Lives in Indiranagar, Bangalore");
    const own = await usableForBots(ME, await store.listFacts(ME, plan), deps);
    expect(own.map((f) => f.text)).toEqual(["Prefers short replies", "Pays rent on the 5th through UPI"]);
    await space.use(ME, "places", true);
    expect(await sharedFacts(ME, "where do I live", deps)).toContain("Lives in Indiranagar, Bangalore");
  });

  it("a pinned line reaches every bot first, and one moved to Money reaches none", async () => {
    const { space, you, store } = await seeded();
    const deps = { store, on: async () => true, marks: async () => (await you.getSettings(ME)).privacy.space ?? NO_MARKS };
    await space.change(ME, keyOf("My sister Meera lives in Pune"), { pinned: true });
    expect((await sharedFacts(ME, "short answers please", deps, 2))[0]).toBe("My sister Meera lives in Pune");
    await space.change(ME, keyOf("Prefers short replies"), { section: "money" });
    expect(await sharedFacts(ME, "short answers please", deps)).not.toContain("Prefers short replies");
  });
});

describe("the routes", () => {
  const shared: Array<{ space: string; text: string; section: unknown; fromKey?: string }> = [];
  const groups = { add: async (_u: string, space: string, text: string, o: { section?: unknown; fromKey?: string }) => { shared.push({ space, text, ...o }); return { id: "g1", text }; } };
  async function app() {
    const r = await seeded();
    const a = Fastify();
    registerYouSpaceRoutes(a, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } } } as never, { space: r.space, groups: groups as never });
    await a.ready();
    const as = { authorization: `Bearer ${ME}` };
    const go = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
      a.inject({ method, url, headers: as, ...(payload ? { payload } : {}) }).then((x) => ({ status: x.statusCode, body: x.json() }));
    return { a, go };
  }

  it("needs the person, and answers only their own", async () => {
    const { a, go } = await app();
    expect((await a.inject({ method: "GET", url: "/v1/bots/you/space" })).statusCode).toBe(401);
    const o = await go("GET", "/v1/bots/you/space");
    expect(o.status).toBe(200);
    expect(o.body.sections).toHaveLength(10);
    expect((await go("GET", "/v1/bots/you/space/nope")).status).toBe(404);
  });

  it("add, pin, switch off and forget, each answering a sentence when it can't", async () => {
    const { go } = await app();
    const added = await go("POST", "/v1/bots/you/space/likes", { text: "Loves filter coffee" });
    expect(added.body.line).toMatchObject({ text: "Loves filter coffee", section: "likes" });
    expect((await go("POST", "/v1/bots/you/space/about", { text: "I have asthma" })).body).toMatchObject({ code: "sensitive" });
    expect((await go("PUT", `/v1/bots/you/space/lines/${added.body.line.key}`, { pinned: true })).body.line.pinned).toBe(true);
    expect((await go("PUT", "/v1/bots/you/space/likes/use", { on: false })).body.on).toBe(false);
    expect((await go("GET", "/v1/bots/you/space/likes")).body.use).toBe(false);
    expect((await go("DELETE", `/v1/bots/you/space/lines/${added.body.line.key}`)).body.forgot).toBe(1);
    expect((await go("DELETE", "/v1/bots/you/space/lines/zzz")).status).toBe(404);
  });

  it("shares one line with one group, by its key, never a money line", async () => {
    const { go } = await app();
    shared.length = 0;
    const key = keyOf("My sister Meera lives in Pune");
    expect((await go("POST", `/v1/bots/you/space/lines/${key}/share`, { space: "s1" })).status).toBe(200);
    expect(shared).toEqual([{ space: "s1", text: "My sister Meera lives in Pune", section: "people", fromKey: key }]);
    expect((await go("POST", `/v1/bots/you/space/lines/${keyOf("Pays rent on the 5th through UPI")}/share`, { space: "s1" })).body.code).toBe("money_stays");
    expect(shared).toHaveLength(1);
  });
});

describe("the screens", () => {
  const walk = (n: Node | undefined, out: Node[] = []): Node[] => { if (!n) return out; out.push(n); for (const c of n.children ?? []) walk(c, out); return out; };
  async function build(screenId: string, params: Record<string, string> = {}) {
    const calls: Array<{ method: string; path: string }> = [];
    const s = await buildBotsScreen({ screenId, client: "phone", params, tzOffsetMinutes: IST, user: { id: ME }, can: new Set(["BotsKit"]), desk: { pages: false, notes: false } },
      fakeDeps({ jobs: [], tasks: [], api: SPACE_API, calls }));
    return { s, words: walk(s.root!).map((n) => String(n.props?.content ?? "")).filter(Boolean) };
  }

  it("Your space: every section as a tile, Off where bots may not use it", async () => {
    const { words } = await build(SCREENS.youSpace);
    for (const w of ["Your space", "About you", "Your day", "People", "Places", "Likes", "Money", "Work", "Bots", "Files & notes", "Timeline", "Off"]) expect(words).toContain(w);
  });

  it("a section: its switch, its things and its lines; About you has the account's name", async () => {
    const day = await build(SCREENS.youSpaceSection, { id: "day" });
    expect(day.words).toEqual(expect.arrayContaining(["Bots can use this", "Design review with Kabir", "Goes to the gym at 6:30 am on weekdays", "Add something"]));
    const about = await build(SCREENS.youSpaceSection, { id: "about" });
    expect(about.words).toEqual(expect.arrayContaining(["Aanya Sharma", "Female"]));
    const money = await build(SCREENS.youSpaceSection, { id: "money" });
    expect(money.words).not.toContain("Add something");
    const timeline = await build(SCREENS.youSpaceSection, { id: "timeline" });
    expect(timeline.words).not.toContain("Bots can use this");
    expect(timeline.words.some((w) => w.startsWith("Pinned · Likes"))).toBe(true);
  });
});
