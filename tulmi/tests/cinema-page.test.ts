/**
 * THE CINEMA BOT'S SCREENS (screens/bots/cinemaPage.ts, cinemaScreens.ts): its page (a new film, a picture, the films, the pictures, the
 * cast) and a film's page at each step (the script, the storyboard, a shot that needs the person, a film paused for today, the finished film),
 * and a shot's page. Never a model, a score or a cost. Every tree is drawn by the shipped app (the linter), on the phone and the window.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

type Node = import("../../shared/types/sdui.js").Node;
type ActionSpec = import("../../shared/types/sdui.js").ActionSpec;
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { walk, lintTree } = await import("../src/experience/bots/lint.js");
const { film: filmOf } = await import("./cinema-rig.js");
const { publicFilm } = await import("../src/cinema/public.js");

const DRAWS = ["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"];
const PURPOSE = "Makes films and videos shot by shot from your idea, and pictures.";
const BOT = {
  slug: "cinema", name: "Cinema", colour: "stone", builtin: true, publicCard: false, tone: "", principles: [], purpose: PURPOSE,
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
};
const ROW = { id: "f1", title: "Chai in the Rain", status: "board", hold: null, aspect: "9:16", shots: 4, done: 0, seconds: 20, poster: "/v1/cinema/media/u/u1/cinema/films/f1/still-1.png?exp=1&sig=x", updatedAt: 1 };
const OVERVIEW = (o: Record<string, unknown> = {}) => ({ films: [], pictures: [], cast: [], ...o });

function view(over: Record<string, unknown> = {}, filmOver: Record<string, unknown> = {}) {
  const f = filmOf({ status: "board", budgetPaise: 1200, spentPaise: 900, ...filmOver });
  f.shots.forEach((s) => { s.still = `u/u1/cinema/films/f1/still-${s.n}.png`; s.status = "boarded"; });
  const links: Record<string, string> = {};
  f.shots.forEach((s) => { links[s.still!] = `/v1/cinema/media/${s.still}?exp=1&sig=x`; });
  return {
    film: publicFilm(f), title: "Chai in the Rain", links,
    ...over,
  };
}

type Client = "phone" | "desktop";
async function build(o: { screen?: string; params?: Record<string, string>; client?: Client; overview?: unknown; film?: unknown } = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const deps = fakeDeps({
    bots: [...SAMPLE_BOTS, { slug: "cinema", name: "Cinema", colour: "stone", purpose: PURPOSE, builtin: true }], calls,
    api: {
      "GET /v1/bots/cinema": { bot: BOT }, "GET /v1/bots/cinema/memory": { facts: [], summary: "", turns: 0 }, "GET /v1/bots/cinema/connectors": { connectors: [] },
      "GET /v1/botsapp/bots/chat/cinema?limit=1": { turns: [] },
      "GET /v1/cinema/overview": o.overview ?? OVERVIEW(),
      ...(o.film ? { "GET /v1/cinema/films/f1": o.film } : {}),
    },
  });
  const s = await buildBotsScreen({
    screenId: o.screen ?? "bots.bot", client: o.client ?? "phone", params: o.screen ? (o.params ?? {}) : { slug: "cinema" }, tzOffsetMinutes: IST,
    user: { id: "u1", name: "Aanya" }, can: new Set(DRAWS), desk: { pages: false, notes: false },
  }, deps);
  const root = s.root as Node;
  const nodes = walk(root);
  const flat = (a: unknown): ActionSpec[] => {
    if (!a || typeof a !== "object") return [];
    const x = a as ActionSpec & { actions?: unknown[]; then?: unknown; else?: unknown; ok?: unknown };
    return [x, ...(x.actions ?? []).flatMap(flat), ...flat(x.then), ...flat(x.else)];
  };
  return {
    lint: lintTree(root),
    nodes,
    texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content)),
    images: nodes.filter((n) => n.type === "Image").map((n) => String((n.props?.source as { url?: string })?.url)),
    paths: nodes.flatMap((n) => Object.values(n.on ?? {}) as ActionSpec[]).flatMap(flat).filter((a) => a.kind === "callEndpoint").map((a) => `${(a as { method: string }).method} ${(a as { path: string }).path}`),
    bodies: nodes.flatMap((n) => Object.values(n.on ?? {}) as ActionSpec[]).flatMap(flat).filter((a) => a.kind === "callEndpoint").map((a) => (a as { body?: unknown }).body),
    navs: nodes.flatMap((n) => Object.values(n.on ?? {}) as ActionSpec[]).flatMap(flat).filter((a) => a.kind === "navigate") as Array<{ screenId: string; params?: Record<string, string> }>,
  };
}

const FILM = { screen: "bots.cinema.film", params: { f: "f1" } };

describe.each<Client>(["phone", "desktop"])("the cinema bot on the %s", (client) => {
  it("its page starts a film and makes a picture, and says what it does when there is nothing yet", async () => {
    const p = await build({ client });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("A new film");
    expect(p.texts).toContain("A picture");
    expect(p.paths).toContain("POST /v1/cinema/films");
    expect(p.paths).toContain("POST /v1/cinema/pictures");
    expect(p.texts.some((t) => t.startsWith("Say what you want to see."))).toBe(true);
  });

  it("its page lists the films with where each stands, and the pictures, as full addresses", async () => {
    const p = await build({ client, overview: OVERVIEW({ films: [ROW], pictures: [{ id: "p1", words: "a poster", url: "/v1/cinema/media/u/u1/cinema/pictures/p1.png?exp=1&sig=x" }] }) });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Chai in the Rain");
    expect(p.texts.some((t) => t.includes("Storyboard ready: look it over and say go"))).toBe(true);
    expect(p.images.every((u) => u.startsWith("https://"))).toBe(true);
    expect(p.images).toHaveLength(2);
  });

  it("a film's script asks to make the storyboard, and lists the shots", async () => {
    const p = await build({ client, ...FILM, film: view({}, { status: "script", spentPaise: 0, budgetPaise: 0 }) });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("The shots");
    expect(p.texts).toContain("Ready for the storyboard");
    expect(p.texts.some((x) => x.startsWith("1. Rain sweeps down the lane"))).toBe(true);
    expect(p.paths).toContain("POST /v1/cinema/films/f1/approve-script");
    expect(p.paths).toContain("POST /v1/cinema/films/f1/revise");
  });

  it("a film's storyboard puts Film it first, then the stills as a grid, each opening its shot", async () => {
    const p = await build({ client, ...FILM, film: view() });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Ready to film");
    expect(p.texts.indexOf("Ready to film")).toBeLessThan(p.texts.indexOf("Storyboard"));
    expect(p.images.length).toBe(4);
    expect(p.paths).toContain("POST /v1/cinema/films/f1/approve-board");
    expect(p.navs.filter((n) => n.screenId === "bots.cinema.shot").map((n) => n.params?.n)).toEqual(["1", "2", "3", "4"]);
  });

  it("a shot's page shows its card in full, the takes with what the checker said, and changes this shot only", async () => {
    const v = view({}, { status: "rendering" });
    v.film.shots[2]!.status = "failed";
    v.film.shots[2]!.error = "Shot 3 did not come out right in 3 takes.";
    v.film.takes = [
      { id: "t1", n: 3, status: "done", seconds: 5, check: { pass: false, notes: ["her hand passes through the glass"] }, startedAt: 0, endedAt: 1 },
      { id: "t2", n: 3, status: "failed", seconds: 5, check: null, startedAt: 0, endedAt: 1 },
      { id: "t3", n: 3, status: "running", seconds: 5, check: null, startedAt: 0, endedAt: null },
    ];
    const p = await build({ client, screen: "bots.cinema.shot", params: { f: "f1", n: "3" }, film: v });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Shot 3");
    expect(p.texts).toContain("he glances up at the roof, a small smile; his wrist lifts the kettle high so the chai froths");
    expect(p.texts.some((x) => x.includes("a slow push-in from medium to medium-close"))).toBe(true);
    expect(p.texts).toContain("Take 1");
    expect(p.texts).toContain("Sent back: her hand passes through the glass");
    expect(p.texts).toContain("It didn't come through, so it was made again");
    expect(p.texts).toContain("Filming…");
    expect(p.paths).toContain("POST /v1/cinema/films/f1/shots/3/retry");
    expect(p.paths).toContain("POST /v1/cinema/films/f1/revise");
    expect(p.bodies).toContainEqual({ note: "$state.cs_note", n: 3 });
  });

  it("never shows a model's name, a score, a prompt or a cost, on any page", async () => {
    const pages = [
      await build({ client, overview: OVERVIEW({ films: [ROW] }) }),
      await build({ client, ...FILM, film: view({}, { status: "script", spentPaise: 0, budgetPaise: 0 }) }),
      await build({ client, ...FILM, film: view() }),
      await build({ client, screen: "bots.cinema.shot", params: { f: "f1", n: "2" }, film: view() }),
      await build({ client, ...FILM, film: view({}, { status: "rendering", hold: "budget" }) }),
    ];
    const words = pages.flatMap((p) => p.texts).join(" ");
    expect(words).not.toMatch(/kling|seedance|veo|wan |hailuo|runway|gemini|nano banana|seedream|gpt|openrouter|\/10\b|prompt|₹|\bcosts?\b|\bprice\b|\bspent\b|\bpaise\b/i);
  });

  it("wears the director on its Home card and on its empty page, with a moment of his own", async () => {
    const { cinemaTileLook, DIRECTOR } = await import("../src/experience/bots/screens/bots/cinemaPage.js");
    const { ctxFor } = await import("../src/experience/bots/fixtures.js");
    const ctx = ctxFor("bots.home", client, undefined, { can: new Set(DRAWS) });
    expect(cinemaTileLook(ctx)).toMatchObject({ avatar: DIRECTOR, moment: "c.clap", momentMode: "loop" });
    const empty = await build({ client });
    const buddies = empty.nodes.filter((n) => n.type === "BotBuddy" && (n.props as { avatar?: string }).avatar === DIRECTOR);
    expect(buddies).toHaveLength(1);
    expect((buddies[0]!.props as { moment?: string }).moment).toBe("c.frame");
  });

  it("gives the director a card of his own, doing what matches the film", async () => {
    const { DIRECTOR } = await import("../src/experience/bots/screens/bots/cinemaPage.js");
    const buddyOf = (p: { nodes: { type: string; props: Record<string, unknown> }[] }) =>
      p.nodes.filter((n) => n.type === "BotBuddy" && n.props.avatar === DIRECTOR);

    // A film waiting for a decision: he claps his board, and the card opens it.
    const waits = await build({ client, overview: OVERVIEW({ films: [ROW] }) });
    expect(waits.lint).toEqual([]);
    expect(buddyOf(waits)).toHaveLength(1);
    expect(buddyOf(waits)[0]!.props.moment).toBe("c.clap");
    expect(waits.texts).toContain("Open it");
    // The film's own still is in the card, and the head and the lists do not say the same thing again.
    expect(waits.images.some((u) => u.includes("still-1.png"))).toBe(true);
    expect(waits.texts.filter((x) => x.includes("Storyboard ready"))).toHaveLength(1);
    expect(waits.texts).not.toContain("Waiting for you");

    // A finished film: he throws it in the air.
    const ready = await build({ client, overview: OVERVIEW({ films: [{ ...ROW, status: "done", hold: null, done: 4 }] }) });
    expect(ready.lint).toEqual([]);
    expect(buddyOf(ready)[0]!.props.moment).toBe("c.premiere");
    expect(ready.texts).toContain("Watch it");
    expect(ready.texts).toContain("Ready to watch");

    // One being filmed: he finds the frame with his hands, over and over.
    const filming = await build({ client, overview: OVERVIEW({ films: [{ ...ROW, status: "rendering", hold: null, done: 2 }] }) });
    expect(filming.lint).toEqual([]);
    expect(buddyOf(filming)[0]!.props.moment).toBe("c.frame");
    expect(buddyOf(filming)[0]!.props.momentMode).toBe("loop");
    expect(filming.texts).toContain("See how it's going");
    expect(filming.texts.some((x) => x.includes("Filming: 2 of 4 shots done"))).toBe(true);

    // Nothing to say about: no card, and the invitation keeps its own director.
    const empty = await build({ client });
    expect(buddyOf(empty)).toHaveLength(1);
    expect(buddyOf(empty)[0]!.props.moment).toBe("c.frame");
    expect(empty.texts).not.toContain("Open it");
  });

  it("a shot that cannot be read says so", async () => {
    const p = await build({ client, screen: "bots.cinema.shot", params: { f: "f1", n: "9" }, film: view() });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("This shot couldn't be read. The film may have changed.");
  });

  it("a film paused for today says so and offers the plans, never a price; a shot that gave up says it needs you", async () => {
    const v = view({}, { status: "rendering", hold: "budget" });
    v.film.shots[2]!.status = "failed";
    v.film.shots[2]!.error = "Shot 3 did not come out right in 3 takes.";
    const p = await build({ client, ...FILM, film: v });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Paused for today");
    expect(p.navs.some((n) => n.screenId === "bots.plans")).toBe(true);
    expect(p.paths.some((x) => x.includes("raise"))).toBe(false);
    expect(p.texts).toContain("Needs you");
    expect(p.navs.some((n) => n.screenId === "bots.cinema.shot" && n.params?.n === "3")).toBe(true);
  });

  it("a finished film can be watched, downloaded and shared", async () => {
    const v = view({}, { status: "done", cut: { video: "u/u1/cinema/films/f1/film-x.mp4", srt: null, seconds: 20, of: "x" } });
    v.links["u/u1/cinema/films/f1/film-x.mp4"] = "/v1/cinema/media/u/u1/cinema/films/f1/film-x.mp4?exp=1&sig=x";
    const p = await build({ client, ...FILM, film: v });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Watch");
    expect(p.texts).toContain("Download");
    expect(p.texts).toContain(client === "desktop" ? "Copy link" : "Share");
  });

  it("offers the same film cut another way, with no price to agree", async () => {
    const v = view({}, { status: "done", aspect: "16:9", cut: { video: "u/u1/cinema/films/f1/film-x.mp4", srt: null, seconds: 20, of: "x" } });
    v.links["u/u1/cinema/films/f1/film-x.mp4"] = "/v1/cinema/media/u/u1/cinema/films/f1/film-x.mp4?exp=1&sig=x";
    const p = await build({ client, ...FILM, film: v });
    expect(p.lint).toEqual([]);
    // The shapes it is not in; and, on their own, the ones with the words drawn in (its own shape first).
    expect(p.texts).toContain("Cut it another way");
    expect(p.texts).toContain("Vertical (9:16)");
    expect(p.texts).toContain("Square (1:1)");
    expect(p.texts).not.toContain("Wide (16:9)");
    expect(p.texts).toContain("With the words in the picture");
    expect(p.texts).toContain("For the feeds that play without sound.");
  });

  it("shows a cut that is already made, ready to watch", async () => {
    const v = view({}, {
      status: "done", aspect: "16:9",
      cut: { video: "u/u1/cinema/films/f1/film-x.mp4", srt: null, seconds: 20, of: "x" },
      editions: [
        { aspect: "9:16", captions: true, video: "u/u1/cinema/films/f1/cut-9x16-caps-x.mp4", seconds: 20, of: "x" },
        { aspect: "1:1", captions: false, video: null, seconds: 0, of: null },
      ],
    });
    v.links["u/u1/cinema/films/f1/film-x.mp4"] = "/v1/cinema/media/u/u1/cinema/films/f1/film-x.mp4?exp=1&sig=x";
    v.links["u/u1/cinema/films/f1/cut-9x16-caps-x.mp4"] = "/v1/cinema/media/u/u1/cinema/films/f1/cut-9x16-caps-x.mp4?exp=1&sig=x";
    const p = await build({ client, ...FILM, film: v });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Other cuts of this film");
    expect(p.texts).toContain("Words in the picture · Ready · 20s");
    expect(p.texts).toContain("Cutting it now…");
    // No shape, no words, no cost: nothing of the machinery.
    expect(p.texts.join(" ")).not.toMatch(/₹|cost|price/i);
  });

  it("a film that cannot be read says so", async () => {
    const p = await build({ client, ...FILM });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("This film couldn't be read. It may have been deleted.");
  });
});
