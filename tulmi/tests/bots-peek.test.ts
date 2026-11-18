/**
 * HOME'S PEEKER (experience/bots/screens/shell/homeThought.ts homePeek, kit canPeek/botPeek):
 *
 *   - a small Blip rises from behind an edge of Home, holds, and ducks back — the window's own gesture (blip.js `rise`)
 *   - he hangs UPSIDE DOWN from the notch, which the phone has and the window does not
 *   - he never takes the BOTTOM edge: the bot with the thought walks there, and two bots in one place is a mess
 *   - he is PINNED, over the page and outside its scroll, because his pocket is at the edge of the screen
 *   - called by voice he comes to the notch and holds, listening (the motion core lights his antenna from the level)
 *   - a build that did not declare BotPeek is sent none, and Home is byte for byte what it was
 *   - he waits out Home's welcome, and the window never gets him at all
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { homePeek } = await import("../src/experience/bots/screens/shell/homeThought.js");
const { ctxFor, sampleLive, fakeDeps } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { SCREENS } = await import("../src/experience/bots/ids.js");
const { resetConfigForTests } = await import("../src/config.js");

type Ctx = ReturnType<typeof ctxFor>;
const ME = "00000000-0000-4000-8000-00000000aaaa";

/** A build that draws him: the living bots, their looks, and the peek itself. */
const CAN = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "BotCrowd", "Vanish", "MentionField", "LiveWords", "KitExtras", "VoiceLive", "DoubleTap", "BotPeek"];
/** The same build with the one thing taken away. */
const NO_PEEK = CAN.filter((c) => c !== "BotPeek");

const ctx = (client: "phone" | "desktop" = "phone", can: string[] = CAN, o: Partial<Ctx> = {}): Ctx =>
  ctxFor(SCREENS.home, client, sampleLive(), { can: new Set(can), ...o });
const req = (client: "phone" | "desktop" = "phone", can: string[] = CAN) => ({
  screenId: SCREENS.home, client, tzOffsetMinutes: 330, user: { id: ME, name: "Aanya" },
  can: new Set(can), desk: { pages: client === "desktop", notes: client === "desktop" },
});

const peekOf = (can: string[] = CAN, client: "phone" | "desktop" = "phone") => {
  const nodes = homePeek(ctx(client, can));
  return nodes[0]?.props as Record<string, any> | undefined;
};

describe("the gate", () => {
  it("a build that declared BotPeek gets exactly one peeker", () => {
    expect(homePeek(ctx()).length).toBe(1);
    expect(homePeek(ctx())[0]!.type).toBe("BotPeek");
  });
  it("a build without it gets nothing at all — not a lowered one, none", () => {
    expect(homePeek(ctx("phone", NO_PEEK))).toEqual([]);
  });
  it("and neither does one that cannot play the bots' looks: his antennae are the catalog's", () => {
    expect(homePeek(ctx("phone", CAN.filter((c) => c !== "BotMoments")))).toEqual([]);
    expect(homePeek(ctx("phone", CAN.filter((c) => c !== "BotsMotion")))).toEqual([]);
  });
  it("the window gets none: it has its own Blip, in its own frame, and no notch", () => {
    expect(homePeek(ctx("desktop"))).toEqual([]);
  });
});

describe("where he may rise", () => {
  it("every edge the phone has, the bottom included now that nothing walks there", () => {
    const edges = peekOf()!.spots.map((s: any) => s.edge);
    for (const e of ["left", "right", "bottom", "notch"]) expect(edges).toContain(e);
  });
  it("every spot is a real edge, somewhere between the ends of it", () => {
    for (const s of peekOf()!.spots) {
      expect(["left", "right", "bottom", "notch"]).toContain(s.edge);
      expect(s.along).toBeGreaterThanOrEqual(0);
      expect(s.along).toBeLessThanOrEqual(1);
    }
  });
  it("two spots are never the same place, so his round is a round and not a twitch", () => {
    const seen = peekOf()!.spots.map((s: any) => `${s.edge}:${s.along}`);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("the beat", () => {
  it("a few seconds out, a long while gone: a surprise, not a pet", () => {
    const p = peekOf()!;
    expect(p.up[0]).toBeGreaterThan(1);
    expect(p.up[1]).toBeLessThanOrEqual(6);
    expect(p.every[0]).toBeGreaterThanOrEqual(p.up[1]);
    expect(p.every[0]).toBeLessThan(p.every[1]);
  });
  it("both ranges are the right way round", () => {
    const p = peekOf()!;
    expect(p.up[0]).toBeLessThan(p.up[1]);
    expect(p.every[0]).toBeLessThan(p.every[1]);
  });
});

describe("he is the ear", () => {
  it("while the voice turn runs he stays up: the same state homeVoice writes", () => {
    expect(peekOf()!.liveWhen).toEqual({ truthy: "voice" });
  });
  it("called, he comes to THE NOTCH and hangs there", () => {
    const p = peekOf()!;
    expect(p.spots[p.home].edge).toBe("notch");
  });
  it("the answer landing is what sends him away, and it is the answer Home already waits on", () => {
    expect(peekOf()!.doneWhen).toEqual({ truthy: "asked.shell.text" });
  });
  it("no liveMoment: the antenna's light comes from the voice's own level in the listen act, not a recipe", () => {
    expect(peekOf()!.liveMoment).toBeUndefined();
  });
  it("called, Home goes soft behind him", () => {
    expect(peekOf()!.veil).toBe(true);
  });
  it("a build that cannot hear gets the gesture and nothing else: no veil, no panel, no open microphone", () => {
    const quiet = CAN.filter((c) => c !== "VoiceLive");
    const p = peekOf(quiet)!;
    expect(p.veil).toBeUndefined();
    expect(p.liveWhen).toBeUndefined();
    expect(homePeek(ctx("phone", quiet))[0]!.children).toBeUndefined();
  });
});

describe("who peeks", () => {
  it("Blip himself, in ink, from the catalog — which is where his antennae come from", () => {
    const bot = peekOf()!.bot;
    expect(bot.avatar).toBe("blip");
    expect(bot.state).toBe("idle");
    expect(bot.life).toBe("home.peek");
  });
  it("small: smaller than a tile's bot, big enough to read", () => {
    expect(peekOf()!.size).toBeGreaterThan(40);
    expect(peekOf()!.size).toBeLessThan(80);
  });
});

describe("on the real screen", () => {
  it("he is PINNED — over the page, outside what scrolls", async () => {
    const s = await buildBotsScreen(req(), fakeDeps({}));
    const root = s.root!;
    const top = root.children ?? [];
    const peek = top.find((n) => walk(n).some((x) => x.type === "BotPeek"));
    expect(peek).toBeTruthy();
    // and not inside the scrolling Screen, nor in the footer
    const screen = top.find((n) => n.type === "Screen");
    expect(walk(screen!).some((n) => n.type === "BotPeek")).toBe(false);
  });
  it("one peeker on Home, not one per anything", async () => {
    const s = await buildBotsScreen(req(), fakeDeps({}));
    expect(walk(s.root!).filter((n) => n.type === "BotPeek").length).toBe(1);
  });
  it("Home stays inside the kit with him on it, and the lint knows the type", async () => {
    const s = await buildBotsScreen(req(), fakeDeps({}));
    expect(lintTree(s.root!, { client: "phone" })).toEqual([]);
  });
  it("a build without him draws no BotPeek anywhere, and still lints clean", async () => {
    const s = await buildBotsScreen(req("phone", NO_PEEK), fakeDeps({}));
    expect(walk(s.root!).some((n) => n.type === "BotPeek")).toBe(false);
    expect(lintTree(s.root!, { client: "phone" })).toEqual([]);
  });
  it("the window's Home has none of him", async () => {
    const s = await buildBotsScreen(req("desktop"), fakeDeps({}));
    expect(walk(s.root!).some((n) => n.type === "BotPeek")).toBe(false);
  });
  it("THE BOTTOM BOT IS GONE: he is the ask, not a second one beside it", async () => {
    const s = await buildBotsScreen(req(), fakeDeps({}));
    const all = walk(s.root!);
    expect(all.some((n) => n.type === "BotPeek")).toBe(true);
    expect(all.filter((n) => n.type === "BotStage").length).toBe(0);
    // and typing still has a door: the ask bar Home had before that bot
    expect(all.filter((n) => n.type === "TextField").length).toBe(1);
  });
  it("a build that cannot draw him KEEPS the walking bot, because that one can answer", async () => {
    const s = await buildBotsScreen(req("phone", NO_PEEK), fakeDeps({}));
    expect(walk(s.root!).filter((n) => n.type === "BotStage").length).toBe(1);
  });
  it("the window keeps it too: its own Blip, its own frame, no notch", async () => {
    const s = await buildBotsScreen(req("desktop"), fakeDeps({}));
    expect(walk(s.root!).filter((n) => n.type === "BotStage").length).toBe(1);
  });
  it("HIS EAR OPENS WITH THE PAGE, on his own node, with nothing to press", async () => {
    const s = await buildBotsScreen(req(), fakeDeps({}));
    const peek = walk(s.root!).find((n) => n.type === "BotPeek")!;
    const ear = peek.on?.onAppear as any;
    expect(ear?.kind).toBe("condition");
    // not while they are at the keyboard, and not twice over
    expect(JSON.stringify(ear.if)).toContain("typing");
    expect(JSON.stringify(ear.if)).toContain("voice");
    expect(JSON.stringify(ear.then)).toContain("voiceLive");
  });
  it("a tap on the veil ends the turn: the microphone stops and the exchange is cleared", async () => {
    const s = await buildBotsScreen(req(), fakeDeps({}));
    const peek = walk(s.root!).find((n) => n.type === "BotPeek")!;
    const bye = JSON.stringify(peek.on?.onDismiss);
    expect(bye).toContain("voiceStop");
    for (const path of ["sent", "reply", "asked"]) expect(bye).toContain(path);
  });
  it("the exchange Home already writes is what his panel draws — the same nodes the thought drew", async () => {
    const s = await buildBotsScreen(req(), fakeDeps({}));
    const peek = walk(s.root!).find((n) => n.type === "BotPeek")!;
    const panel = JSON.stringify(peek.children);
    expect(peek.children!.length).toBe(1);
    expect(panel).toContain("LiveWords");       // the words as he hears them
    expect(panel).toContain("asked.shell.text"); // the answer
    expect(panel).toContain("reply.text");       // and it streaming in
    expect(panel).toContain("Open");             // the whole of it
    // not the ask field: typing is the ask bar now, not something inside his panel
    expect(panel).not.toContain("TextField");
  });
  it("the state his panel reads survives the thought going away", async () => {
    const s = await buildBotsScreen(req(), fakeDeps({}));
    expect(s.state).toMatchObject({ askBot: "any", voice: "" });
  });
});

describe("the one thing that stays at the foot", () => {
  const on = () => { process.env.HOME_UPDATES = "true"; resetConfigForTests(); };
  const off = () => { delete process.env.HOME_UPDATES; delete process.env.HOME_LISTEN; resetConfigForTests(); };

  it("HOME_UPDATES: that bot is what is HAPPENING, not an ask, so it keeps the foot", async () => {
    on();
    try {
      const s = await buildBotsScreen(req(), fakeDeps({}));
      const all = walk(s.root!);
      expect(all.filter((n) => n.type === "BotStage").length).toBe(1);
      expect(all.some((n) => n.type === "BotPeek")).toBe(true);
    } finally { off(); }
  });
  it("and then the peeker keeps the gesture and the listening, but NOT a second open ear", async () => {
    on();
    try {
      const peek = walk((await buildBotsScreen(req(), fakeDeps({}))).root!).find((n) => n.type === "BotPeek")!;
      expect(peek.props!.liveWhen).toEqual({ truthy: "voice" });   // he still leans in when it hears something
      expect(peek.props!.veil).toBeUndefined();                     // that bot blurs and answers
      expect(peek.children).toBeUndefined();
      expect(peek.on?.onAppear).toBeUndefined();                    // two things listening is a bug
      expect(peek.on?.onDismiss).toBeUndefined();
    } finally { off(); }
  });
  it("HOME_LISTEN=false shuts the microphone and leaves him peeking, with typing still there", async () => {
    process.env.HOME_LISTEN = "false"; resetConfigForTests();
    try {
      const s = await buildBotsScreen(req(), fakeDeps({}));
      const peek = walk(s.root!).find((n) => n.type === "BotPeek")!;
      expect(peek.on?.onAppear).toBeUndefined();
      expect(peek.props!.veil).toBeUndefined();
      expect(walk(s.root!).filter((n) => n.type === "TextField").length).toBe(1);
    } finally { off(); }
  });
});
