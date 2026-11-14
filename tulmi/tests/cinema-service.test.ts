/**
 * THE CINEMA BOT'S ENGINE ROOM, A WHOLE FILM (src/cinema/service.ts), with every model and provider faked:
 *
 *   - the idea becomes a script; nothing is made before the person says go to it, no video before they say go to the storyboard
 *   - the storyboard: the look frame, the sheets, two stills for a shot with people, the voice-over (which lengthens its shot to fit)
 *   - the takes: each from its still, a take the eye fails is retaken with the fix, the film is cut, the person is told
 *   - every rupee is on the person's meter and the film's spend, and the spend never passes the film's budget; no cost is ever sent to the app
 *   - a film whose retakes need more is extended by itself within the limits, and pauses for today past them
 *   - a film is its owner's alone; the day's cap and the film's cap refuse more; consent is asked first
 *   - a changed line makes one new take and a new cut, nothing else
 *   - a picture: read, made, looked at, kept
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
});

import { CinemaService, type CinemaDeps, type MediaPorts } from "../src/cinema/service.js";
import { MemoryCinemaStore } from "../src/cinema/store.js";
import type { Think } from "../src/cinema/plan.js";
import { imageModels, jobModels, videoModels } from "./cinema-rig.js";

const SCRIPT = {
  bible: {
    title: "Chai in the Rain", logline: "A stall becomes a shelter.", genre: "ad", tone: "warm", style: "live", language: "hi",
    look: { palette: "amber and teal", light: "monsoon light", lens: "anamorphic", stock: "35mm" },
    characters: [{ key: "ravi", name: "Ravi", look: "fifties", wardrobe: "blue kurta" }, { key: "meera", name: "Meera", look: "student", wardrobe: "yellow raincoat" }],
    places: [{ key: "stall", name: "the stall", look: "tin roof" }],
    music: "slow tabla",
  },
  shots: [
    { size: "wide", move: "drone", cast: [], place: "stall", action: "Rain sweeps over the stall", frame: "The stall in the rain", end: "rain on the roof", seconds: 4, vo: "Har baarish ki ek kahani hoti hai, aur yeh kahani ek chai ke cup se shuru hoti hai." },
    { size: "medium", cast: ["ravi"], place: "stall", action: "Ravi pours chai", frame: "Ravi at the counter", seconds: 4, sound: "rain on tin" },
    { size: "close", cast: ["meera", "ravi"], place: "stall", action: "Meera takes the glass", frame: "Hands meet over the counter", seconds: 4, lines: [{ who: "ravi", text: "Lo, garam chai." }] },
  ],
};

const good = { scores: { identity: 9, action: 9, camera: 8, quality: 9, continuity: 9 }, issues: [], fix: null };
const bad = { scores: { identity: 8, action: 4, camera: 8, quality: 8, continuity: 8 }, issues: [{ kind: "action", major: true, note: "no glass" }], fix: "Meera clearly takes the glass" };

function rig(o: {
  consent?: boolean; dailyPaise?: number; filmMaxPaise?: number; failFirstTakeOf?: number; allowance?: string | null;
  /** A script to direct instead of the default one. */
  script?: unknown;
  /** The eye's verdict for a shot, so a test can fail one thing about one take. */
  verdictFor?: (shot: number, take: number) => unknown;
  /** A model that will not take what we send it, so the fallback can be tested. */
  refuseJob?: (model: string) => boolean;
} = {}) {
  const store = new MemoryCinemaStore();
  const blobs = new Map<string, Buffer>();
  const charged: number[] = [];
  const pushes: string[] = [];
  const calls = { images: 0, videos: [] as { model: string; prompt: string; last: boolean; voice: boolean; source: string | null }[], tts: 0, cuts: 0, music: 0 };
  const clock = { t: 1_800_000_000_000 };
  let ids = 0;
  let takeChecks = 0;
  const logs: string[] = [];
  const shotChecks: Record<number, number> = {};
  const think = (): Think => async (q) => {
    if (q.purpose === "cinema.direct" || q.purpose === "cinema.revise") {
      if (q.purpose === "cinema.revise") {
        const s = structuredClone(SCRIPT);
        s.shots[2]!.lines = [{ who: "ravi", text: "Lo beta, garam chai." }];
        return { json: s, text: "", usd: 0.05 };
      }
      return { json: o.script ?? SCRIPT, text: "", usd: 0.05 };
    }
    if (q.purpose === "cinema.check.take") {
      takeChecks++;
      if (o.verdictFor) {
        const m = /Shot (\d+):/.exec(typeof q.system === "string" ? q.system : "");
        const shot = m ? Number(m[1]) : 0;
        shotChecks[shot] = (shotChecks[shot] ?? 0) + 1;
        return { json: o.verdictFor(shot, shotChecks[shot]!) ?? good, text: "", usd: 0.001 };
      }
      const txt = Array.isArray(q.user) ? "" : q.user;
      void txt;
      const forShot3 = typeof q.system === "string" && q.system.includes("Shot 3:");
      return { json: forShot3 && o.failFirstTakeOf === 3 && takeChecks <= 3 && !calls.videos.some((v) => v.prompt.includes("Important:")) ? bad : good, text: "", usd: 0.001 };
    }
    if (q.purpose === "cinema.picture.read") return { json: { kind: "poster", text: "CHAI", aspect: "2:3", prompt: "A poster of a chai glass in the rain", cast: [] }, text: "", usd: 0.001 };
    if (q.purpose === "cinema.picture.check") return { json: { scores: { match: 9, quality: 9, text: 9, identity: 10 } }, text: "", usd: 0.001 };
    return { json: good, text: "", usd: 0.001 };
  };
  const media: MediaPorts = {
    image: async () => { calls.images++; return { bytes: Buffer.from(`png${calls.images}`), type: "image/png", usd: 0.04 }; },
    startVideo: async (a) => {
      if (o.refuseJob?.(a.model)) throw Object.assign(new Error("that model does not take a clip"), { code: "bad_request" });
      const source = a.source ? ("job" in a.source ? `job:${a.source.job}` : "bytes") : null;
      calls.videos.push({ model: a.model, prompt: a.prompt, last: !!a.last, voice: !!a.voice, source });
      return `job${calls.videos.length}`;
    },
    videoStatus: async (job) => ({ status: "done", url: `https://openrouter.ai/api/v1/videos/${job}/content`, usd: 0.5 }),
    fetchVideo: async (url) => Buffer.from(`mp4:${url}`),
    music: async () => { calls.music++; return { bytes: Buffer.from("mp3"), usd: 0.04 }; },
    tts: async () => { calls.tts++; return { audio: Buffer.from("voice"), usd: 0.002 }; },
    frames: async () => ({ frames: [Buffer.from("f1"), Buffer.from("f2")], last: Buffer.from("last"), seconds: 4 }),
    slice: async (_b, starts) => starts.map((_s, i) => ({ video: Buffer.from(`piece${i}`), last: Buffer.from(`last${i}`), seconds: 4 })),
    seconds: async () => 9.4,
    cut: async (input) => {
      calls.cuts++;
      return { video: Buffer.from(`film of ${input.shots.length} at ${input.aspect}`), srt: "1\n00:00:00,000 --> 00:00:01,000\nHi\n", seconds: 14, ...(input.captions ? { captions: true } : {}) };
    },
  };
  const deps: CinemaDeps = {
    store,
    blobs: { put: async (k, d) => { blobs.set(k, d); }, get: async (k) => blobs.get(k) ?? null, delete: async (k) => { blobs.delete(k); } },
    think,
    models: async () => ({ video: videoModels(), image: imageModels(), jobs: jobModels() }),
    media,
    charge: (_u, usd) => charged.push(usd),
    aiAllowed: async () => o.consent ?? true,
    allowance: async () => o.allowance ?? null,
    notify: async (_u, msg) => { pushes.push(msg.kind); },
    live: () => undefined,
    fx: 88,
    filmMaxPaise: o.filmMaxPaise ?? 1_000_000,
    dailyPaise: o.dailyPaise ?? 1_000_000,
    now: () => clock.t,
    log: (line) => logs.push(line),
    id: () => `id${++ids}`,
  };
  const svc = new CinemaService(deps);
  /** Ticks until the film reaches `status` (or gives up). */
  const until = async (userId: string, id: string, status: string, max = 40) => {
    for (let i = 0; i < max; i++) {
      await svc.tick();
      await svc.idle();
      clock.t += 30_000;
      const f = (await svc.film(userId, id)).film;
      if (f.status === status) return f;
    }
    return (await svc.film(userId, id)).film;
  };
  return { svc, store, blobs, charged, pushes, calls, clock, until, logs };
}

describe("a whole film", () => {
  it("goes from an idea to a finished cut, asking twice before spending", async () => {
    const r = rig({ failFirstTakeOf: 3 });
    const made = await r.svc.create("u1", { idea: "a 12 second ad for my chai stall in the rain", length: 12, aspect: "9:16" });
    expect(made.film.status).toBe("writing");
    await r.svc.idle();
    let v = await r.svc.film("u1", made.film.id);
    expect(v.film.status).toBe("script");

    await r.svc.tick();
    await r.svc.idle();
    expect(r.calls.images).toBe(0);

    v = await r.svc.approveScript("u1", made.film.id);
    expect(v.film.status).toBe("boarding");
    const boarded = await r.until("u1", made.film.id, "board");
    expect(boarded.status).toBe("board");
    expect(boarded.script!.bible.lookRef).toBeTruthy();
    expect(boarded.script!.bible.characters.map((c) => !!c.ref)).toEqual([true, false]);
    // the look frame, Ravi's sheet (in two shots; Meera is in one), the stall's, then 1 + 2 + 2 stills (two where someone is in frame)
    expect(r.calls.images).toBe(1 + 1 + 1 + 1 + 2 + 2);
    expect(boarded.shots[0]!.voice).toBeTruthy();
    expect(boarded.script!.shots[0]!.seconds).toBe(10);
    expect(boarded.notes.some((n) => n.includes("voice-over fits"))).toBe(true);
    expect(r.calls.videos).toHaveLength(0);
    expect(r.pushes).toContain("cinema_board");

    v = await r.svc.approveBoard("u1", made.film.id);
    expect(v.film.status).toBe("rendering");
    const done = await r.until("u1", made.film.id, "done");
    expect(done.status).toBe("done");
    expect(done.cut.video).toBeTruthy();
    expect(r.calls.cuts).toBe(1);
    expect(r.pushes).toContain("cinema_ready");
    const shot3 = r.calls.videos.filter((x) => x.prompt.includes("Lo, garam chai"));
    expect(shot3.length).toBe(2);
    expect(shot3[1]!.prompt).toContain("Important: Meera clearly takes the glass.");
    const kept = (await r.store.getFilm("u1", made.film.id))!;
    expect(kept.spentPaise).toBeGreaterThan(0);
    expect(kept.spentPaise).toBeLessThanOrEqual(kept.budgetPaise);
    expect(r.charged.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(done.shots.every((s) => s.status === "ok")).toBe(true);

    const changed = await r.svc.revise("u1", made.film.id, { note: "make Ravi say beta", n: 3 });
    expect(changed.film.status).toBe("rendering");
    expect(changed.film.shots.find((s) => s.n === 3)!.status).toBe("queued");
    expect(changed.film.shots.find((s) => s.n === 1)!.status).toBe("ok");
    const before = r.calls.videos.length;
    const again = await r.until("u1", made.film.id, "done");
    expect(r.pushes).not.toContain("cinema_hold");
    expect(r.calls.videos.length - before).toBe(1);
    expect(r.calls.cuts).toBe(2);
    expect(again.cut.of).not.toBe(done.cut.of);
  });

  it("has a mouth say our own recording where a video model would guess at the words", async () => {
    // One person, close, speaking Hindi: the line is recorded in Ravi's own voice and the mouth is driven by it.
    const script = structuredClone(SCRIPT) as typeof SCRIPT & { shots: Record<string, unknown>[] };
    script.shots[2] = { size: "close", cast: ["ravi"], place: "stall", action: "Ravi holds out the glass", frame: "Ravi at the counter", seconds: 4, move: "static", lines: [{ who: "ravi", text: "Lo, garam chai." }] };
    const r = rig({ script });
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12, aspect: "9:16" });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    const boarded = await r.until("u1", made.film.id, "board");
    const spoken = boarded.shots.find((s) => s.n === 3)!;
    expect(spoken.said).toBeTruthy();
    expect(spoken.saidSeconds).toBe(9.4);
    expect(boarded.script!.shots[2]!.seconds).toBe(10);

    await r.svc.approveBoard("u1", made.film.id);
    await r.until("u1", made.film.id, "done");
    const lip = r.calls.videos.find((v) => v.model === "heygen/avatar-iv")!;
    expect(lip).toBeTruthy();
    expect(lip.voice).toBe(true);
    // The lip-sync model is told what the face does, never the words: it has the recording for those.
    expect(lip.prompt).not.toContain("Lo, garam chai");
    expect(lip.prompt).toMatch(/Keep the face, hair, clothes, light and background exactly as in the picture/);
    // The wide shot and the shot with no lines are filmed the ordinary way.
    expect(r.calls.videos.filter((v) => v.model === "heygen/avatar-iv")).toHaveLength(1);
  });

  it("films a spoken shot the ordinary way when the lip-sync model will not take it", async () => {
    const script = structuredClone(SCRIPT) as typeof SCRIPT & { shots: Record<string, unknown>[] };
    script.shots[2] = { size: "close", cast: ["ravi"], place: "stall", action: "Ravi holds out the glass", frame: "Ravi at the counter", seconds: 4, move: "static", lines: [{ who: "ravi", text: "Lo, garam chai." }] };
    const r = rig({ script, refuseJob: (m) => m === "heygen/avatar-iv" });
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12, aspect: "9:16" });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    await r.svc.approveBoard("u1", made.film.id);
    const done = await r.until("u1", made.film.id, "done");
    expect(done.status).toBe("done");
    expect(r.calls.videos.some((v) => v.model === "heygen/avatar-iv")).toBe(false);
    expect(r.calls.videos.some((v) => v.prompt.includes("Lo, garam chai"))).toBe(true);
  });

  it("mends a take with one local fault instead of filming it again", async () => {
    const r = rig({
      // Shot 2's first take has a warped sign and nothing else wrong: a mend, then it passes.
      verdictFor: (shot, take) => (shot === 2 && take === 1
        ? { scores: { identity: 8, action: 8, camera: 8, quality: 8, continuity: 8 }, issues: [{ kind: "text", major: true, note: "the sign reads CHIA" }], fix: "the sign reads CHAI" }
        : good),
    });
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12, aspect: "9:16" });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    await r.svc.approveBoard("u1", made.film.id);
    const done = await r.until("u1", made.film.id, "done");
    expect(done.status).toBe("done");
    const mend = r.calls.videos.find((v) => v.model === "black-forest-labs/flux-video-edit")!;
    expect(mend).toBeTruthy();
    // The clip is named by the job that made it: nothing of the person's is uploaded.
    expect(mend.source).toMatch(/^job:/);
    expect(mend.prompt).toBe("the sign reads CHAI. Change nothing else: the same people, clothes, place, light, framing and camera move.");
    const kept = (await r.store.getFilm("u1", made.film.id))!;
    const mended = kept.takes.find((t) => t.model === "black-forest-labs/flux-video-edit")!;
    expect(mended.from).toBeTruthy();
    expect(kept.shots.find((s) => s.n === 2)!.take).toBe(mended.id);
  });

  it("films a take again when the edit model will not take our clip", async () => {
    const r = rig({
      refuseJob: (m) => m === "black-forest-labs/flux-video-edit",
      verdictFor: (shot, take) => (shot === 2 && take === 1
        ? { scores: { identity: 8, action: 8, camera: 8, quality: 8, continuity: 8 }, issues: [{ kind: "text", major: true, note: "the sign reads CHIA" }], fix: "the sign reads CHAI" }
        : good),
    });
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12, aspect: "9:16" });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    await r.svc.approveBoard("u1", made.film.id);
    const done = await r.until("u1", made.film.id, "done");
    expect(done.status).toBe("done");
    expect(r.calls.videos.some((v) => v.model === "black-forest-labs/flux-video-edit")).toBe(false);
    const shot2 = r.calls.videos.filter((v) => v.prompt.includes("Ravi pours chai"));
    expect(shot2.length).toBeGreaterThan(1);
    expect(shot2[1]!.prompt).toContain("Important: The sign reads CHAI.");
  });

  it("cuts the same film to another shape, and to captions, without spending again", async () => {
    const r = rig();
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12, aspect: "16:9" });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    await r.svc.approveBoard("u1", made.film.id);
    const done = await r.until("u1", made.film.id, "done");
    const cuts = r.calls.cuts;
    const spent = (await r.store.getFilm("u1", made.film.id))!.spentPaise;

    // Asked for, then made on the next tick, from the takes already filmed.
    let v = await r.svc.edition("u1", made.film.id, { aspect: "9:16", captions: true });
    expect(v.film.editions).toEqual([{ aspect: "9:16", captions: true, video: null, seconds: 0, of: null }]);
    const after = await r.until("u1", made.film.id, "done");
    const e = after.editions![0]!;
    expect(e.video).toBeTruthy();
    expect(r.calls.cuts).toBe(cuts + 1);
    expect(v.links[e.video!] ?? Object.keys((await r.svc.film("u1", made.film.id)).links)).toBeTruthy();
    // Nothing more was filmed, and nothing was charged: the music is the one already made.
    expect(r.calls.videos.length).toBe(done.shots.length);
    expect((await r.store.getFilm("u1", made.film.id))!.spentPaise).toBe(spent);

    // Asking again takes it away.
    v = await r.svc.edition("u1", made.film.id, { aspect: "9:16", captions: true });
    expect(v.film.editions).toEqual([]);
    await expect(r.svc.edition("u1", made.film.id, { aspect: "16:9", captions: false })).rejects.toThrow(/film you already have/);
  });

  it("makes the film bigger, and refuses one too long to be worth it", async () => {
    const r = rig();
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12, aspect: "16:9" });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    await r.svc.approveBoard("u1", made.film.id);
    await r.until("u1", made.film.id, "done");

    let v = await r.svc.enlarge("u1", made.film.id);
    expect(v.film.wantBig).toBe(true);
    const after = await r.until("u1", made.film.id, "done");
    expect(after.cut.big).toBeTruthy();
    expect(after.cut.bigOf).toBe(after.cut.of);
    expect(after.cut.bigJob).toBeNull();
    const big = r.calls.videos.at(-1)!;
    expect(big.model).toBe("black-forest-labs/flux-video-upscale");
    expect(big.source).toBe("bytes");
    // Asking again takes it away.
    v = await r.svc.enlarge("u1", made.film.id);
    expect(v.film.wantBig).toBe(false);
    expect(v.film.cut.big).toBeNull();

    // A film whose pixels would cost more than the film may ever spend is told so, not left to pause.
    const small = rig({ filmMaxPaise: 30_000 });
    const tiny = await small.svc.create("u1", { idea: "a chai ad", length: 12 });
    await small.svc.idle();
    await small.svc.approveScript("u1", tiny.film.id);
    await small.until("u1", tiny.film.id, "board");
    await small.svc.approveBoard("u1", tiny.film.id);
    await small.until("u1", tiny.film.id, "done");
    await expect(small.svc.enlarge("u1", tiny.film.id)).rejects.toThrow(/too long to make bigger/);
  }, 20_000);

  it("films shots that carry one moment on as one take, and cuts it apart", async () => {
    const script = structuredClone(SCRIPT) as typeof SCRIPT & { shots: Record<string, unknown>[] };
    script.shots = [
      { size: "wide", cast: ["ravi"], place: "stall", action: "Ravi lifts the kettle", frame: "the stall", seconds: 4, link: "cut", move: "static" },
      { size: "medium", cast: ["ravi"], place: "stall", action: "He pours, the steam rising", frame: "the counter", seconds: 4, link: "continue", move: "static" },
      { size: "close", cast: ["ravi"], place: "stall", action: "He sets the glass down", frame: "the glass", seconds: 4, link: "continue", move: "static" },
    ];
    const r = rig({ script });
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12, aspect: "16:9" });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    await r.svc.approveBoard("u1", made.film.id);
    const done = await r.until("u1", made.film.id, "done");
    expect(done.status).toBe("done");
    // One generation for all three shots, not three.
    expect(r.calls.videos).toHaveLength(1);
    expect(r.calls.videos[0]!.prompt).toContain("ONE CONTINUOUS SHOT, 12 seconds");
    expect(r.calls.videos[0]!.last).toBe(true);
    // Three takes all the same, each its own piece, each checked on its own.
    const kept = (await r.store.getFilm("u1", made.film.id))!;
    expect(kept.takes).toHaveLength(3);
    expect(kept.takes.map((t) => t.n)).toEqual([1, 2, 3]);
    expect(kept.takes[0]!.run).toEqual([1, 2, 3]);
    expect(kept.takes[0]!.cuts).toEqual([0, 4, 8]);
    expect(kept.takes.slice(1).every((t) => t.paise === 0)).toBe(true);
    expect(done.shots.every((s) => s.status === "ok")).toBe(true);
    expect(new Set(kept.takes.map((t) => t.video)).size).toBe(3);
  }, 20_000);

  it("does not pay for the music twice when a film is cut again", async () => {
    const r = rig();
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12 });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    await r.svc.approveBoard("u1", made.film.id);
    await r.until("u1", made.film.id, "done");
    expect(r.calls.music).toBe(1);
    await r.svc.revise("u1", made.film.id, { note: "make Ravi say beta", n: 3 });
    await r.until("u1", made.film.id, "done");
    expect(r.calls.cuts).toBe(2);
    expect(r.calls.music).toBe(1);
  });

  it("pauses a film for today when it would need more than the plan allows, and says nothing of money", async () => {
    const r = rig({ failFirstTakeOf: 3, allowance: "You've reached this stretch's limit." });
    const made = await r.svc.create("u1", { idea: "a 12 second ad for my chai stall", length: 12 });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    await r.svc.approveBoard("u1", made.film.id);
    await r.until("u1", made.film.id, "done");
    await r.svc.revise("u1", made.film.id, { note: "make Ravi say beta", n: 3 });
    const before = r.calls.videos.length;
    for (let i = 0; i < 5; i++) { await r.svc.tick(); await r.svc.idle(); r.clock.t += 30_000; }
    const v = await r.svc.film("u1", made.film.id);
    expect(v.film.hold).toBe("budget");
    expect(r.calls.videos.length).toBe(before);
    expect(r.pushes).toContain("cinema_hold");
  });

  it("says a script left unwritten by a restart has failed, so it can be started again", async () => {
    const r = rig();
    const now = r.clock.t;
    await r.store.createFilm({ ...(await import("./cinema-rig.js")).film({ id: "old", status: "writing", script: null, shots: [] }), updatedAt: now - 11 * 60_000 });
    const v = await r.svc.film("u1", "old");
    expect(v.film.status).toBe("failed");
    expect(v.film.error).toMatch(/Start the film again/);
  });

  it("redraws a storyboard after a change to it, and shows it again", async () => {
    const r = rig();
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12 });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    const images = r.calls.images;
    const changed = await r.svc.revise("u1", made.film.id, { note: "make Ravi say beta", n: 3 });
    expect(changed.film.status).toBe("boarding");
    const again = await r.until("u1", made.film.id, "board");
    expect(again.status).toBe("board");
    expect(r.calls.images).toBe(images);
  });

  it("never sends a model, a prompt, a provider's job or a blamed model to the app", async () => {
    const r = rig({ failFirstTakeOf: 3 });
    const made = await r.svc.create("u1", { idea: "a 12 second ad for my chai stall", length: 12 });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    await r.svc.approveBoard("u1", made.film.id);
    await r.until("u1", made.film.id, "done");
    const sent = JSON.stringify(await r.svc.film("u1", made.film.id)) + JSON.stringify(await r.svc.overview("u1"));
    expect(sent).not.toMatch(/kwaivgi|bytedance|google\/|alibaba|minimax|runway\/|"prompt"|"job"|"blamed"|"model"|"pin"|"fix"|"scores"|[Pp]aise|"board"|"price"|spentToday|dailyCap|dayLeft|₹/);
    const p = await r.svc.picture("u1", { words: "a poster that says CHAI" });
    expect(JSON.stringify(p)).not.toMatch(/"model"|"key"|"ownerId"|"paise"/);
  });

  it("is its owner's alone", async () => {
    const r = rig();
    const made = await r.svc.create("u1", { idea: "a chai ad" });
    await expect(r.svc.film("u2", made.film.id)).rejects.toMatchObject({ status: 404 });
    await expect(r.svc.approveScript("u2", made.film.id)).rejects.toMatchObject({ status: 404 });
  });

  it("asks for consent first", async () => {
    const r = rig({ consent: false });
    await expect(r.svc.create("u1", { idea: "a chai ad" })).rejects.toMatchObject({ status: 403, code: "ai_consent_needed" });
  });

  it("refuses a film past the film's cap or the day's, in words without a price", async () => {
    const r = rig({ filmMaxPaise: 100 });
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12 });
    await r.svc.idle();
    await expect(r.svc.approveScript("u1", made.film.id)).rejects.toMatchObject({ code: "cinema_film_cap" });
    await expect(r.svc.approveScript("u1", made.film.id)).rejects.toThrow(/^[^₹]*$/);
    const day = rig({ dailyPaise: 100 });
    const m2 = await day.svc.create("u1", { idea: "a chai ad", length: 12 });
    await day.svc.idle();
    await expect(day.svc.approveScript("u1", m2.film.id)).rejects.toMatchObject({ code: "cinema_day" });
  });

  it("deletes a film's files with it", async () => {
    const r = rig();
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12 });
    await r.svc.idle();
    await r.svc.approveScript("u1", made.film.id);
    await r.until("u1", made.film.id, "board");
    expect(r.blobs.size).toBeGreaterThan(0);
    await r.svc.remove("u1", made.film.id);
    expect(r.blobs.size).toBe(0);
  });
});

describe("a picture", () => {
  it("is read, made, looked at and kept", async () => {
    const r = rig();
    const p = await r.svc.picture("u1", { words: "a poster that says CHAI" });
    expect(p.kind).toBe("poster");
    expect(p.url).toMatch(/^\/v1\/cinema\/media\/u\/u1\/cinema\/pictures\//);
    expect(r.calls.images).toBe(2);
    expect((await r.svc.overview("u1")).pictures).toHaveLength(1);
    await r.svc.deletePicture("u1", p.id);
    expect(r.blobs.size).toBe(0);
  });
});
