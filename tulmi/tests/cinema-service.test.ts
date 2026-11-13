/**
 * THE CINEMA BOT'S ENGINE ROOM, A WHOLE FILM (src/cinema/service.ts), with every model and provider faked:
 *
 *   - the idea becomes a script; nothing is spent on stills before the person approves it, nor on video before they approve the price
 *   - the storyboard: the look frame, the sheets, two stills for a shot with people, the voice-over (which lengthens its shot to fit)
 *   - the takes: each from its still, a take the eye fails is retaken with the fix, the film is cut, the person is told
 *   - every rupee is on the person's meter and the film's spend, and the spend never passes what was agreed
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
import { imageModels, videoModels } from "./cinema-rig.js";

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

function rig(o: { consent?: boolean; dailyPaise?: number; filmMaxPaise?: number; failFirstTakeOf?: number } = {}) {
  const store = new MemoryCinemaStore();
  const blobs = new Map<string, Buffer>();
  const charged: number[] = [];
  const pushes: string[] = [];
  const calls = { images: 0, videos: [] as { model: string; prompt: string; last: boolean }[], tts: 0, cuts: 0 };
  const clock = { t: 1_800_000_000_000 };
  let ids = 0;
  let takeChecks = 0;
  const think = (): Think => async (q) => {
    if (q.purpose === "cinema.direct" || q.purpose === "cinema.revise") {
      if (q.purpose === "cinema.revise") {
        const s = structuredClone(SCRIPT);
        s.shots[2]!.lines = [{ who: "ravi", text: "Lo beta, garam chai." }];
        return { json: s, text: "", usd: 0.05 };
      }
      return { json: SCRIPT, text: "", usd: 0.05 };
    }
    if (q.purpose === "cinema.check.take") {
      takeChecks++;
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
    startVideo: async (a) => { calls.videos.push({ model: a.model, prompt: a.prompt, last: !!a.last }); return `job${calls.videos.length}`; },
    videoStatus: async (job) => ({ status: "done", url: `https://openrouter.ai/api/v1/videos/${job}/content`, usd: 0.5 }),
    fetchVideo: async (url) => Buffer.from(`mp4:${url}`),
    music: async () => ({ bytes: Buffer.from("mp3"), usd: 0.04 }),
    tts: async () => { calls.tts++; return { audio: Buffer.from("voice"), usd: 0.002 }; },
    frames: async () => ({ frames: [Buffer.from("f1"), Buffer.from("f2")], last: Buffer.from("last"), seconds: 4 }),
    seconds: async () => 9.4,
    cut: async (input) => { calls.cuts++; return { video: Buffer.from(`film of ${input.shots.length}`), srt: "1\n00:00:00,000 --> 00:00:01,000\nHi\n", seconds: 14 }; },
  };
  const deps: CinemaDeps = {
    store,
    blobs: { put: async (k, d) => { blobs.set(k, d); }, get: async (k) => blobs.get(k) ?? null, delete: async (k) => { blobs.delete(k); } },
    think,
    models: async () => ({ video: videoModels(), image: imageModels() }),
    media,
    charge: (_u, usd) => charged.push(usd),
    aiAllowed: async () => o.consent ?? true,
    notify: async (_u, msg) => { pushes.push(msg.kind); },
    live: () => undefined,
    fx: 88,
    filmMaxPaise: o.filmMaxPaise ?? 1_000_000,
    dailyPaise: o.dailyPaise ?? 1_000_000,
    now: () => clock.t,
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
  return { svc, store, blobs, charged, pushes, calls, clock, until };
}

describe("a whole film", () => {
  it("goes from an idea to a finished cut, asking twice before spending", async () => {
    const r = rig({ failFirstTakeOf: 3 });
    const made = await r.svc.create("u1", { idea: "a 12 second ad for my chai stall in the rain", length: 12, aspect: "9:16" });
    expect(made.film.status).toBe("writing");
    await r.svc.idle();
    let v = await r.svc.film("u1", made.film.id);
    expect(v.film.status).toBe("script");
    expect(v.board!.paise).toBeGreaterThan(0);
    expect(v.price!.paise).toBeGreaterThan(0);

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
    expect(done.spentPaise).toBeLessThanOrEqual(done.budgetPaise);
    expect(r.charged.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(done.shots.every((s) => s.status === "ok")).toBe(true);

    const changed = await r.svc.revise("u1", made.film.id, { note: "make Ravi say beta", n: 3 });
    expect(changed.film.status).toBe("rendering");
    expect(changed.film.shots.find((s) => s.n === 3)!.status).toBe("queued");
    expect(changed.film.shots.find((s) => s.n === 1)!.status).toBe("ok");
    const before = r.calls.videos.length;
    await r.svc.tick();
    await r.svc.idle();
    const short = (await r.svc.film("u1", made.film.id)).film;
    if (short.hold === "budget") {
      expect(r.calls.videos.length).toBe(before);
      expect(r.pushes).toContain("cinema_hold");
      await r.svc.raise("u1", made.film.id, 20_000);
    }
    const again = await r.until("u1", made.film.id, "done");
    expect(r.calls.videos.length - before).toBe(1);
    expect(r.calls.cuts).toBe(2);
    expect(again.cut.of).not.toBe(done.cut.of);
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

  it("refuses a price over the film's cap or the day's", async () => {
    const r = rig({ filmMaxPaise: 100 });
    const made = await r.svc.create("u1", { idea: "a chai ad", length: 12 });
    await r.svc.idle();
    await expect(r.svc.approveScript("u1", made.film.id)).rejects.toMatchObject({ code: "cinema_film_cap" });
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
