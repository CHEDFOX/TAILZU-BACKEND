/**
 * THE CINEMA BOT'S SCREENS (screens/bots/cinemaPage.ts, cinemaScreens.ts): its page (a new film, a picture, the films, the pictures, the
 * cast, today's spending) and a film's page at each step (the script and its storyboard price, the storyboard and the film's price, a shot
 * that needs the person, more money, the finished film). Every tree is drawn by the shipped app (the linter), on the phone and the window.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

type Node = import("../../shared/types/sdui.js").Node;
type ActionSpec = import("../../shared/types/sdui.js").ActionSpec;
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { walk, lintTree } = await import("../src/experience/bots/lint.js");
const { film: filmOf } = await import("./cinema-rig.js");

const DRAWS = ["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"];
const PURPOSE = "Makes films and videos shot by shot from your idea, and pictures.";
const BOT = {
  slug: "cinema", name: "Cinema", colour: "stone", builtin: true, publicCard: false, tone: "", principles: [], purpose: PURPOSE,
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
};
const ROW = { id: "f1", title: "Chai in the Rain", status: "board", hold: null, aspect: "9:16", shots: 4, done: 0, seconds: 20, spentPaise: 900, budgetPaise: 1200, poster: "/v1/cinema/media/u/u1/cinema/films/f1/still-1.png?exp=1&sig=x", updatedAt: 1 };
const OVERVIEW = (o: Record<string, unknown> = {}) => ({ films: [], pictures: [], cast: [], spentToday: 0, dailyCap: 300_000, ...o });

function view(over: Record<string, unknown> = {}, filmOver: Record<string, unknown> = {}) {
  const f = filmOf({ status: "board", budgetPaise: 1200, spentPaise: 900, ...filmOver });
  f.shots.forEach((s) => { s.still = `u/u1/cinema/films/f1/still-${s.n}.png`; s.status = "boarded"; });
  const links: Record<string, string> = {};
  f.shots.forEach((s) => { links[s.still!] = `/v1/cinema/media/${s.still}?exp=1&sig=x`; });
  return {
    film: f, title: "Chai in the Rain", links, models: { 1: "Kling v3.0 Std", 2: "Veo 3.1 Fast" }, dayLeft: 100_000,
    board: { sheets: 5, stills: 7, paise: 2600 }, price: { shots: [], missing: [], video: 8000, reserve: 3200, extras: 400, paise: 11600, seconds: 20 },
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
    texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content)),
    images: nodes.filter((n) => n.type === "Image").map((n) => String((n.props?.source as { url?: string })?.url)),
    paths: nodes.flatMap((n) => Object.values(n.on ?? {}) as ActionSpec[]).flatMap(flat).filter((a) => a.kind === "callEndpoint").map((a) => `${(a as { method: string }).method} ${(a as { path: string }).path}`),
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
    expect(p.texts.some((t) => t.includes("Storyboard ready: approve the price"))).toBe(true);
    expect(p.images.every((u) => u.startsWith("https://"))).toBe(true);
    expect(p.images).toHaveLength(2);
  });

  it("a film's script shows the shots and the storyboard's price", async () => {
    const p = await build({ client, ...FILM, film: view({}, { status: "script", spentPaise: 0, budgetPaise: 0 }) });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("The shots");
    expect(p.texts).toContain("The storyboard costs ₹26");
    expect(p.paths).toContain("POST /v1/cinema/films/f1/approve-script");
    expect(p.paths).toContain("POST /v1/cinema/films/f1/revise");
  });

  it("a film's storyboard shows each still, the model, and the film's price", async () => {
    const p = await build({ client, ...FILM, film: view() });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Filming costs up to ₹116");
    expect(p.texts).toContain("Kling v3.0 Std");
    expect(p.images.length).toBe(4);
    expect(p.paths).toContain("POST /v1/cinema/films/f1/approve-board");
  });

  it("a film that waits for money offers to add some; a shot that gave up offers to try again", async () => {
    const v = view({}, { status: "rendering", hold: "budget" });
    v.film.shots[2]!.status = "failed";
    v.film.shots[2]!.error = "Shot 3 did not come out right in 3 takes.";
    const p = await build({ client, ...FILM, film: v });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("It needs a little more money to carry on");
    expect(p.paths).toContain("POST /v1/cinema/films/f1/raise");
    expect(p.paths).toContain("POST /v1/cinema/films/f1/shots/3/retry");
  });

  it("a finished film can be watched, downloaded and shared", async () => {
    const v = view({}, { status: "done", cut: { video: "u/u1/cinema/films/f1/film-x.mp4", srt: null, seconds: 20, of: "x" } });
    v.links["u/u1/cinema/films/f1/film-x.mp4"] = "/v1/cinema/media/u/u1/cinema/films/f1/film-x.mp4?exp=1&sig=x";
    const p = await build({ client, ...FILM, film: v });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("Watch");
    expect(p.texts).toContain("Download");
    expect(p.texts).toContain("Share");
  });

  it("a film that cannot be read says so", async () => {
    const p = await build({ client, ...FILM });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("This film couldn't be read. It may have been deleted.");
  });
});
