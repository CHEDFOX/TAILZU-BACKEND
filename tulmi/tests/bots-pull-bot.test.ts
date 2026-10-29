/**
 * PULL-A-BOT (shared/types/sdui.ts 3g; kit page `pullBot`): the Bots app's main scrolling screens (Home, Activity, a bot's
 * chat, Spaces) turn it on at both ends and name their list's items (the ids the phone compares after a refresh to say how
 * many are new), only for a phone whose build declares PullBot. The window and every other build get the screen as before.
 */
import { describe, expect, it, vi } from "vitest";
import type { ScreenResponse } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST, SAMPLE_JOBS } = await import("../src/experience/bots/fixtures.js");
const { FACE, page, canPullBot, PULL_BOT_MAX_ITEMS } = await import("../src/experience/bots/kit.js");
const { ctxFor } = await import("../src/experience/bots/fixtures.js");
const { PULL_BOT_CAPABILITY } = await import("../../shared/types/sdui.js");
const { sampleApi, GYM_TURNS } = await import("./bots-bots-data.js");
const { spacesApi } = await import("./spaces-data.js");

type Client = "phone" | "desktop";
const NEW = ["BotsKit", "BotsMotion", "BotBuddy", PULL_BOT_CAPABILITY];
const OLD = ["BotsKit", "BotsMotion", "BotBuddy"];

const ACTIVITY = {
  now: FIXED_NOW, week: { done: 2, paise: 0, minutesSaved: 30 },
  rows: [
    { id: "job:r1", type: "job", bot: "code", title: "Fixed the cart total", at: FIXED_NOW - 60_000, mark: "done" },
    { id: "words:2026-10-28", type: "words", bot: "keybot", title: "Wrote 412 words by voice", at: FIXED_NOW - 3_600_000, mark: "done" },
  ],
};

async function build(screenId: string, client: Client, can: string[], params: Record<string, string> = {}, api: Record<string, unknown> = {}): Promise<ScreenResponse> {
  return buildBotsScreen(
    { screenId, client, params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(can), desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ api }),
  );
}

/** The four screens, each with what it reads. */
async function screens(): Promise<Array<[string, Record<string, string>, Record<string, unknown>]>> {
  return [
    ["bots.home", {}, { "GET /v1/shell/started": { started: true } }],
    ["bots.activity", {}, { [`GET /v1/shell/activity?tz=${IST}`]: ACTIVITY }],
    ["bots.chat", { slug: "gym-bot" }, await sampleApi()],
    ["bots.spaces", {}, spacesApi()],
  ];
}

describe("pull-a-bot on the Bots app's main screens", () => {
  it("a phone that pulls a bot gets it at both ends, with the list's item ids and the page's face", async () => {
    for (const [id, params, api] of await screens()) {
      const s = await build(id, "phone", NEW, params, api);
      expect(s.pullBot, id).toBeDefined();
      expect(s.pullBot, id).toMatchObject({ top: true, bottom: true, font: FACE.semibold });
      expect(Array.isArray(s.pullBot!.items), id).toBe(true);
      expect(s.pullBot!.items!.length, id).toBeGreaterThan(0);
      expect(new Set(s.pullBot!.items).size, `${id}: each id once`).toBe(s.pullBot!.items!.length);
    }
  });

  it("only for a build that declares it, and never in the window", async () => {
    for (const [id, params, api] of await screens()) {
      expect((await build(id, "phone", OLD, params, api)).pullBot, `${id}: an older phone`).toBeUndefined();
      expect((await build(id, "desktop", NEW, params, api)).pullBot, `${id}: the window`).toBeUndefined();
    }
  });

  it("what each screen names as its items: decisions and work on Home, the feed on Activity, turns in a chat, spaces and tasks", async () => {
    const [home, activity, chat, spaces] = await screens();
    const h = (await build(home![0], "phone", NEW, home![1], home![2])).pullBot!;
    expect(h.items).toEqual(expect.arrayContaining([`job:${SAMPLE_JOBS[0]!.id}`, `job:${SAMPLE_JOBS[1]!.id}`, "bot:code", "bot:gym-bot"]));
    const a = (await build(activity![0], "phone", NEW, activity![1], activity![2])).pullBot!;
    expect(a.items).toEqual(expect.arrayContaining(["job:r1", "words:2026-10-28", `job:${SAMPLE_JOBS[0]!.id}`]));
    expect(a.newAt ?? "top").toBe("top");
    const c = (await build(chat![0], "phone", NEW, chat![1], chat![2])).pullBot!;
    expect(c.items).toEqual(GYM_TURNS.map((t) => t.id));
    expect(c.newAt).toBe("bottom");
    const sp = (await build(spaces![0], "phone", NEW, spaces![1], spaces![2])).pullBot!;
    expect(sp.items).toEqual(expect.arrayContaining(["space:s1", "space:s2"]));
    expect(sp.items!.some((x) => x.startsWith("task:"))).toBe(true);
    // One space: what is shared, asked for, given out and done in it.
    const one = (await build("bots.spaces", "phone", NEW, { id: "s1" }, spacesApi())).pullBot!;
    expect(one).toMatchObject({ top: true, bottom: true });
    expect(one.items!.some((x) => x.startsWith("item:"))).toBe(true);
  });

  it("a list that could not be read names no items, so the one read after it is not all new", async () => {
    const s = await build("bots.activity", "phone", NEW);
    expect(s.pullBot).toMatchObject({ top: true, bottom: true });
    expect(s.pullBot!.items).toBeUndefined();
    const sp = await build("bots.spaces", "phone", NEW, {}, {});
    expect(sp.pullBot!.items).toBeUndefined();
  });

  it("the kit: nothing turned on sends nothing; ids once each, at most a few hundred; the screen's bot and where new ones land", () => {
    const ctx = ctxFor("bots.x", "phone", undefined, { can: new Set(NEW) });
    expect(canPullBot(ctx)).toBe(true);
    expect(canPullBot(ctxFor("bots.x", "desktop", undefined, { can: new Set(NEW) }))).toBe(false);
    expect(canPullBot(ctxFor("bots.x", "phone", undefined, { can: new Set(OLD) }))).toBe(false);
    expect(page(ctx, { body: [], pullBot: {} }).pullBot).toBeUndefined();
    expect(page(ctx, { body: [], pullBot: { top: false } }).pullBot).toBeUndefined();
    const many = Array.from({ length: PULL_BOT_MAX_ITEMS + 50 }, (_, i) => `r${i % (PULL_BOT_MAX_ITEMS + 10)}`);
    const s = page(ctx, { body: [], pullBot: { top: true, items: many, newAt: "bottom", avatar: { accent: "#2F5D50" } } });
    expect(s.pullBot).toMatchObject({ top: true, newAt: "bottom", avatar: { accent: "#2F5D50" }, font: FACE.semibold });
    expect(s.pullBot!.bottom).toBeUndefined();
    expect(s.pullBot!.items!.length).toBe(PULL_BOT_MAX_ITEMS);
    expect(new Set(s.pullBot!.items).size).toBe(PULL_BOT_MAX_ITEMS);
  });
});

describe("the app's knobs for it go out in the bootstrap", () => {
  it("every pull-a-bot knob and label, with the prototype's values", async () => {
    const { APP_KNOB_FLAGS, APP_KNOB_LABELS } = await import("../src/experience/appKnobsData.js");
    expect(APP_KNOB_FLAGS).toMatchObject({
      "pullBot.threshold": 60, "pullBot.rubber": 300, "pullBot.springRate": 17, "pullBot.springDamping": 0.58,
      "pullBot.throwSpeed": 1750, "pullBot.throwBoost": 2.6, "pullBot.gravity": 2600, "pullBot.scale": 0.5,
      "pullBot.avatar": "x0", "app.haptics.pullBot": "light",
    });
    expect(APP_KNOB_LABELS).toMatchObject({
      "pullBot.checking": "Checking", "pullBot.fresh": "{n} new", "pullBot.freshTop": "{n} new at the top", "pullBot.upToDate": "You're up to date",
    });
  });
});
