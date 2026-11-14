/**
 * THE BOT AT THE FOOT OF HOME, AS WHAT IS HAPPENING (experience/bots/screens/shell/homeUpdates.ts, docs/home-updates.md):
 *
 *   - off by default: Home is exactly what it is today, the ask in his thought, and nothing extra is read
 *   - on: no box to type in at first sight, his thought holds what needs them, what is working and what just finished, and each
 *     row opens where it belongs; at rest he wears the one line that matters most
 *   - typing is still there, behind a key, and sending it is the ask bar's own road
 *   - a spoken ask goes out as "voice", so the answer comes back short for the ear; he says a word while he thinks and speaks it
 *   - a tap on him while he listens stops him
 *   - it stays inside the kit (lintTree) on both clients, old builds included
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { homeUpdatesBot, homeUpdatesOn, homeListenOn, restLine, updatesOf, updatesSend, HOME_UPDATES_STATE } = await import("../src/experience/bots/screens/shell/homeUpdates.js");
const { ctxFor, sampleLive, fakeDeps } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { resetConfigForTests } = await import("../src/config.js");
const { SCREENS } = await import("../src/experience/bots/ids.js");

type Ctx = ReturnType<typeof ctxFor>;
const ME = "00000000-0000-4000-8000-00000000aaaa";

/** A build that draws his thought and hears him. */
const CAN = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "KitExtras", "VoiceLive", "DoubleTap", "PersonBot"];
const ctx = (client: "phone" | "desktop" = "phone", o: Partial<Ctx> = {}): Ctx =>
  ctxFor(SCREENS.home, client, sampleLive(), { can: new Set(CAN), ...o });
/** What the screen door takes (buildBotsScreen), as the other screen tests build it. */
const req = (client: "phone" | "desktop" = "phone") => ({
  screenId: SCREENS.home, client, tzOffsetMinutes: 330, user: { id: ME, name: "Aanya" },
  can: new Set(CAN), desk: { pages: client === "desktop", notes: client === "desktop" },
});

const FEED = [
  { id: "job:j1", type: "job" as const, bot: "code", title: "Fix the empty cart crash", sub: "Salon booking app", at: Date.UTC(2026, 9, 28, 13), mark: "done" as const },
  { id: "ask:a1", type: "ask" as const, bot: "plan", title: "What's on tomorrow?", at: Date.UTC(2026, 9, 28, 12), mark: "done" as const },
  { id: "job:old", type: "job" as const, bot: "code", title: "Ancient history", at: Date.UTC(2026, 8, 1), mark: "done" as const },
];

const on = () => { process.env.HOME_UPDATES = "true"; resetConfigForTests(); };
const off = () => { delete process.env.HOME_UPDATES; delete process.env.HOME_UPDATES_USERS; delete process.env.HOME_LISTEN; resetConfigForTests(); };

describe("the switch", () => {
  it("is off by default, and stages by account", () => {
    off();
    expect(homeUpdatesOn(ME)).toBe(false);
    expect(homeListenOn()).toBe(false);
    on();
    expect(homeUpdatesOn(ME)).toBe(true);
    process.env.HOME_UPDATES_USERS = "someone-else";
    resetConfigForTests();
    expect(homeUpdatesOn(ME)).toBe(false);
    process.env.HOME_UPDATES_USERS = `someone-else, ${ME}`;
    resetConfigForTests();
    expect(homeUpdatesOn(ME)).toBe(true);
    process.env.HOME_LISTEN = "true";
    resetConfigForTests();
    expect(homeListenOn()).toBe(true);
    off();
  });

  it("leaves Home exactly as it is while it is off, and reads nothing extra", async () => {
    off();
    const calls: Array<{ path: string }> = [];
    const before = await buildBotsScreen(req(), fakeDeps({ calls }));
    expect(calls.some((c) => c.path.includes("/v1/shell/activity"))).toBe(false);
    // the ask is still in his thought: a field to type in
    expect(walk(before!.root!).some((n) => n.type === "TextField")).toBe(true);
  });
});

describe("what his thought holds", () => {
  it("puts what needs them first, then what is working, then what just finished, and forgets the old", () => {
    const u = updatesOf(ctx(), FEED);
    expect(u.needs.length).toBeGreaterThan(0);
    expect(u.working.length).toBeGreaterThan(0);
    expect(u.done.map((d) => d.title)).toEqual(["Fix the empty cart crash", "What's on tomorrow?"]);
    expect(u.done.some((d) => d.title === "Ancient history")).toBe(false);
  });

  it("wears the one line that matters most at rest", () => {
    const live = sampleLive();
    const withNeeds = ctx("phone", { live });
    expect(restLine(withNeeds, updatesOf(withNeeds, FEED))).toMatch(/needs? you/i);
    const quiet = ctx("phone", { live: { ...live, needs: [], working: [] } });
    expect(restLine(quiet, updatesOf(quiet, FEED))).toBe("2 things done");
    expect(restLine(quiet, updatesOf(quiet, [FEED[0]!]))).toBe("Fix the empty cart crash");
    const nothing = ctx("phone", { live: { ...live, needs: [], working: [] } });
    expect(restLine(nothing, updatesOf(nothing, []))).toBe("Nothing new");
  });

  it("has no box to type in at first sight, but a key that opens one", () => {
    on();
    const node = homeUpdatesBot(ctx(), FEED);
    const all = walk(node);
    const field = all.find((n) => n.type === "TextField")!;
    // the field is there, but only shown once they ask to type
    expect(field.visibleIf).toBeUndefined();
    const typing = all.find((n) => JSON.stringify(n.visibleIf) === JSON.stringify({ truthy: "typing" }));
    expect(typing).toBeDefined();
    expect(JSON.stringify(all.map((n) => n.on?.onPress))).toContain('"path":"typing","value":true');
    off();
  });

  it("opens each row where it belongs, and offers everything else", () => {
    on();
    const j = JSON.stringify(homeUpdatesBot(ctx(), FEED));
    expect(j).toContain(SCREENS.codeJob);
    expect(j).toContain(SCREENS.activity);
    off();
  });
});

describe("his ear", () => {
  it("sends a spoken ask as voice, says a word while he thinks, and speaks the answer", () => {
    const j = JSON.stringify(updatesSend(ctx(), { voice: true }));
    expect(j).toContain('"mode":"voice"');
    expect(j).toContain('"kind":"speak","text":"Mm, let me see."');
    expect(j).toContain('"kind":"speak","text":"$state.asked.shell.text"');
  });

  it("sends a typed ask as text, and says nothing out loud", () => {
    const j = JSON.stringify(updatesSend(ctx()));
    expect(j).toContain('"mode":"text"');
    expect(j).not.toContain('"kind":"speak"');
  });

  it("listens turn after turn, and a tap on him stops it", () => {
    on();
    const node = homeUpdatesBot(ctx(), FEED);
    const j = JSON.stringify(node);
    expect(j).toContain('"kind":"voiceLive"');
    expect(j).toContain('"mode":"chat"');
    // his own tap: stop while listening, else open
    expect(JSON.stringify(node.on?.onPress)).toContain('"kind":"voiceStop"');
    off();
  });

  it("says nothing of a microphone to a build that cannot hear", () => {
    on();
    const deaf = ctx("phone", { can: new Set(["BotsKit", "BotsMotion", "BotMoments", "BotStage", "KitExtras"]) });
    const j = JSON.stringify(homeUpdatesBot(deaf, FEED));
    expect(j).not.toContain("voiceLive");
    expect(j).not.toContain("Talk to me");
    off();
  });
});

describe("on the screen", () => {
  it("stays inside the kit on both clients", () => {
    on();
    for (const client of ["phone", "desktop"] as const) {
      expect(lintTree(homeUpdatesBot(ctx(client), FEED)), client).toEqual([]);
      // and with nothing happening at all
      const quiet = ctx(client, { live: { ...sampleLive(), needs: [], working: [] } });
      expect(lintTree(homeUpdatesBot(quiet, [])), client).toEqual([]);
    }
    off();
  });

  it("is what Home draws at its foot when it is on, with the state it needs", async () => {
    on();
    const screen = await buildBotsScreen(req(), fakeDeps({ api: { "GET /v1/shell/activity?tz=330": { now: Date.UTC(2026, 9, 28, 14), week: { done: 2, paise: 0, minutesSaved: 10 }, rows: FEED } } }));
    const j = JSON.stringify(screen);
    expect(j).toContain("What's happening");
    expect(Object.keys(screen!.state ?? {})).toEqual(expect.arrayContaining(Object.keys(HOME_UPDATES_STATE)));
    expect(lintTree(screen!.root!)).toEqual([]);
    off();
  });
});

describe("listening as soon as Home is in front", () => {
  it("is off by default, and when it is on his ear opens with the page", () => {
    on();
    expect(JSON.stringify(homeUpdatesBot(ctx(), FEED).on?.onAppear ?? null)).toBe("null");
    process.env.HOME_LISTEN = "true";
    resetConfigForTests();
    const j = JSON.stringify(homeUpdatesBot(ctx(), FEED).on?.onAppear);
    expect(j).toContain('"kind":"voiceLive"');
    // never on a build that cannot hear
    const deaf = ctx("phone", { can: new Set(["BotsKit", "BotsMotion", "BotMoments", "BotStage", "KitExtras"]) });
    expect(homeUpdatesBot(deaf, FEED).on?.onAppear).toBeUndefined();
    off();
  });
});
