/**
 * THE CINEMA BOT WHILE FILMS ARE OFF: AN IDEA, SEEN AS A PICTURE, THEN BUILT IN 3D (docs/cinema-3d.md §2a, cinema/films.ts).
 *
 * What these hold: films cannot be started or moved forward while CINEMA_FILMS is off, and nothing offers one; a picture of the
 * idea is read into a brief the builder builds from, and the eye judges every render against that picture; the thing is rendered
 * from more sides at the end; each round's preview is on the row as it is made; the route builds from one of the person's own
 * pictures and nobody else's, and a next version keeps building from it; the page offers the idea and Make it 3D; a creation's page
 * shows the idea beside the 3D and the thing from every side.
 *
 * No model and no Blender: both are functions here.
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; delete process.env.CINEMA_FILMS; });

type Node = import("../../shared/types/sdui.js").Node;
type ActionSpec = import("../../shared/types/sdui.js").ActionSpec;
const { make, sceneUser, turned, sideOf, VIEWS } = await import("../src/cinema/scene/make.js");
const { briefText } = await import("../src/cinema/scene/brief.js");
const { SceneService } = await import("../src/cinema/scene/service.js");
const { MemorySceneStore } = await import("../src/cinema/scene/store.js");
const { MemoryBlobStore } = await import("../src/media/blob.js");
const { filmsOn } = await import("../src/cinema/films.js");
const { registerCinemaRoutes, pictureIdOf } = await import("../src/routes/bots/cinema.js");
const { cinemaDigest } = await import("../src/cinema/digest.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { walk, lintTree } = await import("../src/experience/bots/lint.js");
import type { Render, RenderJob } from "../src/cinema/scene/ports.js";
import type { SceneRecord } from "../src/cinema/scene/store.js";
import type { CinemaService } from "../src/cinema/service.js";
import type { SceneService as SceneServiceT } from "../src/cinema/scene/service.js";

const ME = "dev-user";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const IDEA = Buffer.from("the idea picture");
const SCENE = {
  look: { engine: "cycles", samples: 64, width: 1280, height: 960, sky: "studio" },
  camera: { at: [3, -3, 1.6], to: [0, 0, 0.4], lens: 85 },
  lights: [{ kind: "key", power: 300 }],
  materials: { brass: { colour: "#b08d57", metallic: 1, roughness: 0.3 } },
  objects: [{ id: "floor", shape: "plane", at: [0, 0, 0], size: 10, shadowOnly: true }, { id: "base", shape: "cylinder", at: [0, 0, 0.05], size: [0.3, 0.3, 0.05], material: "brass" }],
};
const BRIEF = {
  subject: "a brass desk lamp with a green glass shade",
  objects: [
    { name: "base", shape: "a flat disc", size: "a hand wide", colour: "#b08d57", material: "metal", where: "on the desk" },
    { name: "shade", shape: "a cone, open at the bottom", colour: "#2e6b3a", material: "glass", where: "on top of the stem" },
  ],
  camera: "three quarters, slightly above", light: "warm, from the left", ground: "a dark oak desk",
};

/** A model that answers briefs, scenes and verdicts, and remembers what it was shown. */
function brain(verdicts: Array<{ ok: boolean; issues?: string[]; fix?: string }> = [{ ok: true }]) {
  const seen: Array<{ purpose: string; user: string; pictures: string[] }> = [];
  let look = 0;
  const call = async (input: unknown): Promise<unknown> => {
    const i = input as { purpose: string; messages: Array<{ content: unknown }> };
    const last = i.messages[i.messages.length - 1]!;
    const parts = Array.isArray(last.content) ? last.content as Array<{ type: string; text?: string; image_url?: { url: string } }> : [{ type: "text", text: String(last.content) }];
    seen.push({ purpose: i.purpose, user: parts.filter((p) => p.type === "text").map((p) => p.text).join("\n"), pictures: parts.filter((p) => p.type === "image_url").map((p) => p.image_url!.url) });
    if (i.purpose === "cinema.brief") return { json: BRIEF, paise: 4, model: "eye" };
    if (i.purpose === "cinema.eye") return { json: verdicts[Math.min(look++, verdicts.length - 1)], paise: 5, model: "eye" };
    return { json: SCENE, paise: 20, model: "scene" };
  };
  return { call: call as never, seen };
}

function render(): { render: Render; jobs: RenderJob[] } {
  const jobs: RenderJob[] = [];
  return { jobs, render: async (job) => { jobs.push(job); return { ok: true, shots: [{ bytes: PNG, mime: "image/png" }] }; } };
}

const ctx = (call: never) => ({ userId: ME, budget: { maxPaise: 1000 }, call });

describe("films are off for now", () => {
  it("by default", () => expect(filmsOn()).toBe(false));

  it("a film cannot be started or moved forward; reading the rest of the bot is untouched", async () => {
    const a = Fastify();
    const service = { overview: async () => ({ films: [], pictures: [], cast: [] }) } as unknown as CinemaService;
    registerCinemaRoutes(a, { rateLimit: {}, bots: {}, service, quota: async () => null });
    await a.ready();
    for (const url of ["/v1/cinema/films", "/v1/cinema/films/f1/approve-script", "/v1/cinema/films/f1/approve-board", "/v1/cinema/films/f1/revise", "/v1/cinema/films/f1/enlarge"]) {
      const r = await a.inject({ method: "POST", url, payload: { idea: "a chai ad" } });
      expect(r.statusCode, url).toBe(404);
      expect(r.json().code, url).toBe("films_off");
    }
    expect((await a.inject({ method: "GET", url: "/v1/cinema/overview" })).statusCode).toBe(200);
  });

  it("the bot says it makes pictures and builds them in 3D, and offers no film", async () => {
    process.env.CINEMA = "true";
    const { resetConfigForTests } = await import("../src/config.js");
    resetConfigForTests();
    const { builtinBot } = await import("../src/bots/builtin.js");
    const bot = builtinBot("cinema")!;
    expect(bot.purpose).toContain("3D");
    expect(bot.purpose).not.toMatch(/film|video/i);
    expect(bot.principles.join(" ")).toContain("Films are not made here for now");
    delete process.env.CINEMA;
    resetConfigForTests();
  });

  it("its chat knows their 3D creations, and with nothing made, points at an idea and its picture", async () => {
    const store = { listFilms: async () => { throw new Error("films are not read while off"); }, listPictures: async () => [] } as never;
    const scenes = new MemorySceneStore();
    expect(await cinemaDigest(ME, { store, scenes })).toContain("built in 3D");
    await scenes.create({ id: "s1", ownerId: ME, creation: "c1", version: 1, ask: "a brass lamp", status: "working", why: null, rounds: 2, objects: 4, kept: {}, mime: null, paise: 0, error: null, createdAt: 1, updatedAt: 1, refKey: "u/dev-user/cinema/pictures/p1.png" });
    const d = await cinemaDigest(ME, { store, scenes });
    expect(d).toContain('3D: "a brass lamp" (from one of their pictures): still being built in 3D, round 2.');
  });
});

describe("a picture of the idea, built in 3D", () => {
  it("is read once into a brief the builder builds from", async () => {
    const b = brain();
    await make(ctx(b.call), { ask: "a brass desk lamp", creation: "lamp", render: render().render, store: new MemoryBlobStore(), reference: { bytes: IDEA, mime: "image/png" } });
    const brief = b.seen.filter((s) => s.purpose === "cinema.brief");
    expect(brief).toHaveLength(1);
    expect(brief[0]!.pictures[0]).toBe(`data:image/png;base64,${IDEA.toString("base64")}`);
    const scene = b.seen.find((s) => s.purpose === "cinema.scene")!;
    expect(scene.user).toContain("They showed a picture of the idea");
    expect(scene.user).toContain("- shade: a cone, open at the bottom; #2e6b3a; glass; on top of the stem");
    // The builder is never handed the picture itself: it builds from the words of it.
    expect(scene.pictures).toEqual([]);
  });

  it("and the eye judges every render against that picture: the idea first, the render second", async () => {
    const b = brain([{ ok: false, issues: ["the shade is missing"], fix: "add the green glass shade" }, { ok: true }]);
    await make(ctx(b.call), { ask: "a brass desk lamp", creation: "lamp", render: render().render, store: new MemoryBlobStore(), reference: { bytes: IDEA, mime: "image/jpeg" } });
    const looks = b.seen.filter((s) => s.purpose === "cinema.eye");
    expect(looks).toHaveLength(2);
    for (const l of looks) {
      expect(l.pictures).toHaveLength(2);
      expect(l.pictures[0]).toBe(`data:image/jpeg;base64,${IDEA.toString("base64")}`);
      expect(l.user).toContain("The first picture is the idea they want built");
    }
    // What the eye saw against the picture is what the next round puts right, the brief still in front of it.
    const second = b.seen.filter((s) => s.purpose === "cinema.scene")[1]!;
    expect(second.user).toContain("the shade is missing");
    expect(second.user).toContain("They showed a picture of the idea");
  });

  it("built from words alone, as before: no brief, the eye sees the render only", async () => {
    const b = brain();
    await make(ctx(b.call), { ask: "a speaker", creation: "s", render: render().render, store: new MemoryBlobStore() });
    expect(b.seen.some((s) => s.purpose === "cinema.brief")).toBe(false);
    expect(b.seen.find((s) => s.purpose === "cinema.eye")!.pictures).toHaveLength(1);
    expect(sceneUser({ ask: "x", assets: [], round: 1 })).not.toContain("picture");
  });

  it("is rendered from more sides at the end: the camera walked round the thing, the same height and distance", async () => {
    const r = render();
    const made = await make(ctx(brain().call), { ask: "a lamp", creation: "lamp", render: r.render, store: new MemoryBlobStore() });
    expect(made.kept.views).toHaveLength(2);
    const t = turned({ ...SCENE, camera: { at: [3, 0, 1.6], to: [0, 0, 0.4], lens: 85 } } as never, 90);
    expect(t.camera.at.map((x: number) => Math.round(x * 1000) / 1000)).toEqual([0, 3, 1.6]);
    expect(VIEWS.length).toBeGreaterThanOrEqual(2);
    // From above: raised by a share of its distance, still looking at the same point.
    const up = turned({ ...SCENE, camera: { at: [3, 0, 0.4], to: [0, 0, 0.4], lens: 85 } } as never, 0, 0.5);
    expect(up.camera.at).toEqual([3, 0, 1.9]);
    // A side view keeps the frame's shape, smaller and with fewer samples than the real one.
    const side = sideOf({ ...SCENE, look: { ...SCENE.look, width: 960, height: 1200, samples: 128 } } as never, VIEWS[0]);
    expect([side.look.width, side.look.height, side.look.samples]).toEqual([576, 720, 48]);
    // No views for a moving scene: the clip already goes round it.
    const moving = brain();
    const r2 = render();
    const call2 = (async (i: { purpose: string }) => (i.purpose === "cinema.scene" ? { json: { ...SCENE, move: { kind: "turntable", seconds: 2 } }, paise: 1, model: "m" } : (moving.call as unknown as (x: unknown) => unknown)(i))) as never;
    const m2 = await make(ctx(call2), { ask: "spin it", creation: "spin", render: r2.render, store: new MemoryBlobStore() });
    expect(m2.kept.views).toBeUndefined();
  });

  it("tells each round as it is made, with its preview", async () => {
    const told: Array<{ n: number; preview?: string }> = [];
    await make(ctx(brain([{ ok: false, fix: "x" }, { ok: true }]).call), {
      ask: "a lamp", creation: "lamp", render: render().render, store: new MemoryBlobStore(),
      onRound: (r) => { told.push({ n: r.n, ...(r.preview ? { preview: r.preview.key } : {}) }); },
    });
    expect(told.map((t) => t.n)).toEqual([1, 2]);
    expect(told[1]!.preview).toContain("preview-2.png");
  });
});

describe("the service and the door", () => {
  function svc() {
    const store = new MemorySceneStore();
    const done: SceneRecord[] = [];
    const saves: SceneRecord[] = [];
    const lives: string[] = [];
    const waiters: Array<() => void> = [];
    const real = store.save.bind(store);
    store.save = async (r: SceneRecord) => { saves.push(r); return real(r); };
    const s = new SceneService({
      store, blobs: new MemoryBlobStore(), render: render().render, ready: async () => ({ ok: true, version: "4.0.2" }), capPaise: 400,
      call: brain([{ ok: false, fix: "x" }, { ok: true }]).call,
      onDone: (r) => { done.push(r); for (const w of waiters.splice(0)) w(); },
      live: (u) => lives.push(u),
    });
    const settled = async () => { while (!done.length) await new Promise<void>((go) => waiters.push(go)); return done.shift()!; };
    return { s, store, saves, lives, settled };
  }

  it("keeps which picture it came from, shows each round's preview while it builds, and keeps the other sides", async () => {
    const { s, saves, lives, settled } = svc();
    await s.start(ME, "a lamp", { picture: { key: "u/dev-user/cinema/pictures/p1.png", bytes: IDEA, mime: "image/png" } });
    const r = await settled();
    expect(r.refKey).toBe("u/dev-user/cinema/pictures/p1.png");
    expect(saves.filter((x) => x.status === "working").map((x) => x.rounds)).toEqual([1, 2]);
    expect(saves.find((x) => x.status === "working" && x.rounds === 2)?.kept.preview).toContain("preview-2.png");
    expect(r.kept.views).toHaveLength(2);
    expect(lives.length).toBeGreaterThanOrEqual(3);
  });

  it("a next version keeps building from the same picture", async () => {
    const { s, settled } = svc();
    const first = await s.start(ME, "a lamp", { picture: { key: "u/dev-user/cinema/pictures/p1.png", bytes: IDEA, mime: "image/png" } });
    await settled();
    await s.start(ME, "a lamp, greener", { creation: first.creation });
    const v2 = await settled();
    expect(v2.version).toBe(2);
    expect(v2.refKey).toBe("u/dev-user/cinema/pictures/p1.png");
  });

  it("the door builds from one of their own pictures, its words the ask when none was typed; another's is not there", async () => {
    const started: Array<{ ask: string; picture?: { key: string } }> = [];
    const scenes = {
      ready: async () => ({ ok: true, version: "4.0.2" }),
      start: async (_u: string, ask: string, o: { picture?: { key: string } }) => { started.push({ ask, ...(o.picture ? { picture: o.picture } : {}) }); return { id: "s1", creation: "c1", version: 1 }; },
      latest: async () => null,
    } as unknown as SceneServiceT;
    const service = {
      pictureFile: async (u: string, id: string) => (u === ME && id === "p1" ? { key: "u/dev-user/cinema/pictures/p1.png", bytes: IDEA, mime: "image/png", words: "a brass desk lamp with a green shade" } : null),
    } as unknown as CinemaService;
    const a = Fastify();
    registerCinemaRoutes(a, { rateLimit: {}, bots: {}, service, scenes, quota: async () => null });
    await a.ready();
    const ok = await a.inject({ method: "POST", url: "/v1/cinema/scenes", payload: { picture: "p1" } });
    expect(ok.statusCode).toBe(202);
    expect(started[0]).toEqual({ ask: "a brass desk lamp with a green shade", picture: expect.objectContaining({ key: "u/dev-user/cinema/pictures/p1.png" }) });
    const nope = await a.inject({ method: "POST", url: "/v1/cinema/scenes", payload: { picture: "someone-elses" } });
    expect(nope.statusCode).toBe(404);
    expect(pictureIdOf("u/abc/cinema/pictures/p_9.png")).toBe("p_9");
    expect(pictureIdOf("u/abc/cinema/films/f1/still-1.png")).toBeNull();
  });

  it("the brief reads as lines a builder can act on, colours as hex", () => {
    const t = briefText(BRIEF);
    expect(t.split("\n")[0]).toBe("What it is: a brass desk lamp with a green glass shade");
    expect(t).toContain("- base: a flat disc; a hand wide; #b08d57; metal; on the desk");
    expect(t).toContain("Camera: three quarters, slightly above");
  });
});

// ------------------------------------------------------------------ the screens

const BOT = {
  slug: "cinema", name: "Kutt", colour: "plum", builtin: true, publicCard: false, tone: "", principles: [], purpose: "Shows your idea as a picture, then builds it in 3D.",
  skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] },
};
const PIC = { id: "p1", words: "a brass desk lamp with a green glass shade", kind: "product", type: "image/png", note: null, createdAt: 1, url: "/v1/cinema/media/u/u1/cinema/pictures/p1.png?exp=1&sig=x" };
const SCENE_VIEW = (o: Record<string, unknown> = {}) => ({
  id: "11111111-2222-4333-8444-555555555555", creation: "lamp", version: 1, ask: PIC.words, status: "done", rounds: 2, error: null, at: Date.now(),
  preview: "/v1/cinema/media/c/u1/lamp/1/preview-2.png?exp=1&sig=x", picture: "/v1/cinema/media/c/u1/lamp/1/final.png?exp=1&sig=x",
  views: ["/v1/cinema/media/c/u1/lamp/1/view-1.png?exp=1&sig=x", "/v1/cinema/media/c/u1/lamp/1/view-2.png?exp=1&sig=x"],
  reference: PIC.url, from: "p1", script: "/v1/cinema/media/c/u1/lamp/1/scene.py?exp=1&sig=x", ...o,
});

async function screenOf(o: { screen?: string; params?: Record<string, string>; scenes?: unknown; pictures?: unknown[]; render?: boolean; client?: "phone" | "desktop" } = {}) {
  const deps = fakeDeps({
    bots: [...SAMPLE_BOTS, { slug: "cinema", name: "Kutt", colour: "plum", purpose: BOT.purpose, builtin: true }],
    api: {
      "GET /v1/bots/cinema": { bot: BOT }, "GET /v1/bots/cinema/memory": { facts: [], summary: "", turns: 0 }, "GET /v1/bots/cinema/connectors": { connectors: [] },
      "GET /v1/botsapp/bots/chat/cinema?limit=1": { turns: [] },
      "GET /v1/cinema/overview": { films: [], pictures: o.pictures ?? [PIC], cast: [] },
      "GET /v1/cinema/scenes": { render: { ok: o.render !== false, version: "4.0.2" }, scenes: o.scenes ?? [] },
      [`GET /v1/cinema/scenes/${SCENE_VIEW().id}`]: SCENE_VIEW(),
    },
  });
  const s = await buildBotsScreen({
    screenId: o.screen ?? "bots.bot", client: o.client ?? "phone", params: o.params ?? { slug: "cinema" }, tzOffsetMinutes: IST,
    user: { id: "u1", name: "Aanya" }, can: new Set(["BotsKit", "BotsMotion", "BotBuddy", "BotMoments"]), desk: { pages: false, notes: false },
  }, deps);
  const nodes = walk(s.root as Node);
  const flat = (a: unknown): ActionSpec[] => {
    if (!a || typeof a !== "object") return [];
    const x = a as ActionSpec & { actions?: unknown[]; then?: unknown; else?: unknown; ok?: unknown };
    return [x, ...(x.actions ?? []).flatMap(flat), ...flat(x.then), ...flat(x.else)];
  };
  const acts = nodes.flatMap((n) => Object.values(n.on ?? {}) as ActionSpec[]).flatMap(flat);
  return {
    lint: lintTree(s.root as Node),
    texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content)),
    images: nodes.filter((n) => n.type === "Image").map((n) => String((n.props?.source as { url?: string })?.url)),
    calls: acts.filter((a) => a.kind === "callEndpoint").map((a) => ({ to: `${(a as { method: string }).method} ${(a as { path: string }).path}`, body: (a as { body?: unknown }).body })),
    navs: acts.filter((a) => a.kind === "navigate") as Array<{ screenId: string; params?: Record<string, string> }>,
  };
}

describe.each<"phone" | "desktop">(["phone", "desktop"])("the cinema bot's page while films are off, on the %s", (client) => {
  it("offers an idea, shows it as a picture, and builds the picture in 3D; no film anywhere", async () => {
    const p = await screenOf({ client });
    expect(p.lint).toEqual([]);
    expect(p.texts).toContain("An idea");
    expect(p.texts).toContain("Show me");
    expect(p.texts).toContain("Make it 3D");
    expect(p.calls.map((c) => c.to)).toContain("POST /v1/cinema/pictures");
    expect(p.calls.find((c) => c.to === "POST /v1/cinema/scenes")?.body).toEqual({ picture: "p1" });
    expect(p.texts.join(" ")).not.toMatch(/\bfilm|script|storyboard/i);
    expect(p.calls.map((c) => c.to)).not.toContain("POST /v1/cinema/films");
    expect(p.images.some((u) => u.includes("/cinema/pictures/p1.png"))).toBe(true);
  });

  it("a picture already built opens its 3D, and what is building is over the page", async () => {
    const p = await screenOf({ client, scenes: [SCENE_VIEW({ status: "working", picture: undefined, views: undefined })] });
    expect(p.texts).toContain("Building in 3D…");
    expect(p.texts).toContain("Watch it build");
    expect(p.calls.map((c) => c.to)).not.toContain("POST /v1/cinema/scenes");
    expect(p.navs.some((n) => n.screenId === "bots.cinema.scene")).toBe(true);
  });

  it("says plainly when this server cannot build in 3D, and offers no button that would fail", async () => {
    const p = await screenOf({ client, render: false });
    expect(p.texts).not.toContain("Make it 3D");
    expect(p.texts.join(" ")).toContain("Building in 3D isn't available on this server yet.");
  });

  it("a creation's page: the idea, the 3D of it, the thing from every side, another version, the Blender file", async () => {
    const p = await screenOf({ client, screen: "bots.cinema.scene", params: { s: SCENE_VIEW().id } });
    expect(p.lint).toEqual([]);
    for (const t of ["Your idea", "In 3D", "From every side", "Another version", "The Blender script"]) expect(p.texts).toContain(t);
    expect(p.images.filter((u) => u.includes("/v1/cinema/media/")).length).toBeGreaterThanOrEqual(5);
    expect(p.calls.find((c) => c.to === "POST /v1/cinema/scenes")?.body).toMatchObject({ creation: "lamp" });
  });
});
