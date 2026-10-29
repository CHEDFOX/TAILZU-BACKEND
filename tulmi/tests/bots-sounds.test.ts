/**
 * The bots' sounds (experience/bots/sounds.ts, routes/botSounds.ts, shared/bots/sounds.json + sounds/; docs/bots-app.md
 * "Sounds"): the repo's pack is whole (every file there, its hash its own, short, a sound for every moment the looks
 * catalog names), the check finds what would not do, the bootstrap names the catalog, the route serves it with its file
 * addresses, the files are served immutable (and never the masters), a pack can be pushed and taken back, and the phone's
 * Sounds switch is there only for a build that plays them.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const CONTROL = mkdtempSync(join(tmpdir(), "tz-sounds-"));
const ENV = {
  CONTROL_DIR: CONTROL, ADMIN_SECRET: "sounds-admin-secret-long-enough-0123456789",
  OPENROUTER_API_KEY: "test-openrouter-key", OPENAI_API_KEY: "test-openai-key", STT_PROVIDER: "openai", DEV_SKIP_AUTH: "true",
};
Object.assign(process.env, ENV);

// eslint-disable-next-line import/first
import { resetConfigForTests } from "../src/config.js";
// eslint-disable-next-line import/first
import {
  activeSounds, checkSounds, fileSoundsCatalog, pushedSoundsFile, pushSounds, resetSoundsForTests, servedSounds, soundsDir, soundsFlags,
  SOUND_MAX_MS, type SoundsSpec,
} from "../src/experience/bots/sounds.js";
// eslint-disable-next-line import/first
import { registerBotSoundFiles, registerBotSoundsRoutes } from "../src/routes/botSounds.js";
// eslint-disable-next-line import/first
import { buildBootstrap } from "../src/experience/catalog.js";
// eslint-disable-next-line import/first
import { buildBotsScreen } from "../src/experience/bots/index.js";
// eslint-disable-next-line import/first
import { fakeDeps, IST } from "../src/experience/bots/fixtures.js";
// eslint-disable-next-line import/first
import { walk } from "../src/experience/bots/lint.js";
// eslint-disable-next-line import/first
import { BOT_SOUNDS_CAPABILITY, type Node } from "../../shared/types/sdui.js";

const FILE = new URL("../../shared/bots/sounds.json", import.meta.url);
const LOOKS = new URL("../../shared/bots/looks.json", import.meta.url);
const catalog = (): SoundsSpec => JSON.parse(readFileSync(FILE, "utf8"));

beforeEach(() => {
  Object.assign(process.env, ENV);
  resetConfigForTests();
  rmSync(pushedSoundsFile(), { force: true });
  resetSoundsForTests();
});
afterAll(() => rmSync(CONTROL, { recursive: true, force: true }));

describe("the pack in the repo", () => {
  it("passes the phone's rules, with every file there and its hash its own", () => {
    const c = catalog();
    const dir = soundsDir();
    expect(dir).toBeTruthy();
    expect(checkSounds(c, { dir: dir! })).toEqual([]);
    expect(fileSoundsCatalog()?.v).toBe(c.v);
  });

  it("about a dozen throws (one rare), the line, something new, up to date; every one short and small", () => {
    const c = catalog();
    const throws = c.sounds.filter((s) => s.kind === "throw");
    expect(throws.length).toBeGreaterThanOrEqual(12);
    expect(throws.filter((s) => s.rare).length).toBe(1);
    for (const kind of ["tick", "new", "uptodate"]) expect(c.sounds.filter((s) => s.kind === kind).length, kind).toBe(1);
    for (const s of c.sounds) {
      expect(s.ms, s.id).toBeLessThanOrEqual(SOUND_MAX_MS);
      const f = join(soundsDir()!, s.file!);
      const bytes = readFileSync(f);
      expect(bytes.subarray(4, 8).toString("latin1"), `${s.id} is an MP4`).toBe("ftyp");
      expect(statSync(f).size, s.id).toBeLessThan(16_000);
      // Its master is kept beside it.
      expect(statSync(join(soundsDir()!, "masters", `${s.id}.wav`)).size, s.id).toBeGreaterThan(1000);
    }
  });

  it("a sound for each of the moments' sounds the most-played moments name", () => {
    const looks = JSON.parse(readFileSync(LOOKS, "utf8")) as { moments: Record<string, { tracks: Array<{ do: string; name?: string }> }> };
    const named = new Set(Object.values(looks.moments).flatMap((m) => m.tracks.filter((t) => t.do === "sound").map((t) => String(t.name))));
    const moments = new Set(catalog().sounds.filter((s) => s.kind === "moment").map((s) => s.id));
    for (const id of ["sneeze", "fart.small", "party", "hic", "clap"]) {
      expect(named.has(id), `${id} is a sound a moment names`).toBe(true);
      expect(moments.has(id), `${id} is made`).toBe(true);
    }
  });

  it("the check finds what would not do", () => {
    const c = catalog();
    const one = (over: Record<string, unknown>) => ({ ...c, sounds: [{ ...c.sounds[0]!, ...over }, ...c.sounds.slice(1)] });
    const dir = soundsDir()!;
    expect(checkSounds(one({ hash: "0000000000ff" }), { dir }).join()).toMatch(/hash: not boing\.m4a's/);
    expect(checkSounds(one({ ms: 900 })).join()).toMatch(/ms: up to 450/);
    expect(checkSounds(one({ kind: "boom" })).join()).toMatch(/kind: one of/);
    expect(checkSounds(one({ file: undefined, url: "http://x.example/a.m4a" })).join()).toMatch(/url: an https address/);
    expect(checkSounds(one({ loud: true })).join()).toMatch(/unknown field loud/);
    expect(checkSounds({ ...c, sounds: c.sounds.filter((s) => s.kind !== "tick") }).join()).toMatch(/no tick sound/);
    expect(checkSounds({ ...c, sounds: [...c.sounds, c.sounds[0]] }).join()).toMatch(/"boing" twice/);
    expect(checkSounds({ ...c, v: 0 }).join()).toMatch(/v: a whole number/);
  });
});

describe("served", () => {
  it("the Bots app's bootstrap names the catalog; today's app's does not", () => {
    const c = catalog();
    const flags = (botsApp: boolean) => (buildBootstrap({ botsApp, onboarded: true }).flags ?? {}) as Record<string, unknown>;
    expect(flags(true)["bots.sounds"]).toEqual({ v: c.v, url: `/v1/bots/sounds?v=${c.v}` });
    expect(flags(false)["bots.sounds"]).toBeUndefined();
    expect(soundsFlags()).toEqual({ "bots.sounds": { v: c.v, url: `/v1/bots/sounds?v=${c.v}` } });
  });

  it("GET /v1/bots/sounds: each sound with its file's address (its hash in it), an ETag, a 304", async () => {
    const app = Fastify();
    registerBotSoundsRoutes(app, { rateLimit: undefined });
    await app.ready();
    const c = catalog();
    const got = await app.inject({ method: "GET", url: "/v1/bots/sounds" });
    expect(got.statusCode).toBe(200);
    const body = got.json() as ReturnType<typeof servedSounds>;
    expect(body.v).toBe(c.v);
    const boing = body.sounds.find((s) => s.id === "boing")!;
    expect(boing).toMatchObject({ kind: "throw", url: `/bots/sounds/boing.m4a?h=${c.sounds[0]!.hash}`, hash: c.sounds[0]!.hash });
    expect(body.sounds.find((s) => s.rare)).toBeTruthy();
    expect(got.headers["cache-control"]).toMatch(/public/);
    const again = await app.inject({ method: "GET", url: "/v1/bots/sounds", headers: { "if-none-match": String(got.headers.etag) } });
    expect(again.statusCode).toBe(304);
    await app.close();
  });

  it("the files: immutable for a year, as audio; never the masters, nothing outside", async () => {
    const app = Fastify();
    expect(await registerBotSoundFiles(app)).toBe(true);
    await app.ready();
    const c = catalog();
    const f = await app.inject({ method: "GET", url: `/bots/sounds/boing.m4a?h=${c.sounds[0]!.hash}` });
    expect(f.statusCode).toBe(200);
    expect(f.headers["cache-control"]).toMatch(/max-age=31536000/);
    expect(f.headers["cache-control"]).toMatch(/immutable/);
    expect(String(f.headers["content-type"])).toMatch(/audio\/(mp4|x-m4a)/);
    expect(f.rawPayload.length).toBe(statSync(join(soundsDir()!, "boing.m4a")).size);
    expect((await app.inject({ method: "GET", url: "/bots/sounds/masters/boing.wav" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/bots/sounds/../sounds.json" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/bots/sounds/" })).statusCode).toBe(404);
    await app.close();
  });

  it("a pack pushed without a deploy (its new sounds anywhere https), then taken back", async () => {
    const app = Fastify();
    registerBotSoundsRoutes(app, { rateLimit: undefined });
    await app.ready();
    const c = catalog();
    const winter = { ...c, v: c.v + 1, sounds: [...c.sounds, { id: "jingle", url: "https://api.x0bot.com/media/jingle.m4a", hash: "a1b2c3d4e5f6", kind: "throw", weight: 2, ms: 400 }] };
    expect((await app.inject({ method: "PUT", url: "/v1/admin/bots/sounds", payload: winter })).statusCode).toBe(401);
    const admin = { "x-admin-secret": ENV.ADMIN_SECRET };
    expect((await app.inject({ method: "PUT", url: "/v1/admin/bots/sounds", headers: admin, payload: { ...winter, v: c.v } })).statusCode).toBe(409);
    const bad = await app.inject({ method: "PUT", url: "/v1/admin/bots/sounds", headers: admin, payload: { ...winter, extra: 1 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toContain("unknown field extra");
    expect((await app.inject({ method: "PUT", url: "/v1/admin/bots/sounds?dry=1", headers: admin, payload: winter })).json()).toMatchObject({ ok: true, dry: true });
    expect(activeSounds()?.v).toBe(c.v);
    expect((await app.inject({ method: "PUT", url: "/v1/admin/bots/sounds", headers: admin, payload: winter })).json()).toMatchObject({ ok: true, v: c.v + 1 });
    const now = (await app.inject({ method: "GET", url: "/v1/bots/sounds" })).json() as ReturnType<typeof servedSounds>;
    expect(now.v).toBe(c.v + 1);
    expect(now.sounds.find((s) => s.id === "jingle")?.url).toBe("https://api.x0bot.com/media/jingle.m4a");
    resetSoundsForTests();
    expect(activeSounds()?.v, "kept on the control volume").toBe(c.v + 1);
    expect(soundsFlags()).toEqual({ "bots.sounds": { v: c.v + 1, url: `/v1/bots/sounds?v=${c.v + 1}` } });
    expect((await app.inject({ method: "DELETE", url: "/v1/admin/bots/sounds", headers: admin })).json()).toMatchObject({ ok: true, v: c.v });
    expect(pushSounds({ v: 1 })).toMatchObject({ ok: false, status: 400 });
    await app.close();
  });
});

describe("the phone's Sounds switch", () => {
  const you = (client: "phone" | "desktop", can: string[]) => buildBotsScreen(
    { screenId: "bots.you", client, params: {}, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(can), desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ api: {} }),
  );
  const soundRow = (root: Node) => walk(root).find((n) => (n.on?.onPress as { kind?: string; actions?: Array<{ kind?: string }> } | undefined)?.actions?.some((a) => a.kind === "devicePref"));

  it("on the You tab, kept on the device, on by default, for a build that plays the sounds", async () => {
    const s = await you("phone", ["BotsKit", BOT_SOUNDS_CAPABILITY]);
    const texts = walk(s.root!).filter((n) => n.type === "Text").map((n) => String(n.props?.content));
    expect(texts).toContain("Sounds");
    expect(s.state).toMatchObject({ soundsOn: true });
    const row = soundRow(s.root!);
    expect(row?.on?.onPress).toEqual({ kind: "sequence", actions: [{ kind: "toggleState", path: "soundsOn" }, { kind: "devicePref", key: "sounds", value: "$state.soundsOn" }] });
  });

  it("not for a build that does not, nor in the window", async () => {
    for (const s of [await you("phone", ["BotsKit"]), await you("desktop", ["BotsKit", BOT_SOUNDS_CAPABILITY])]) {
      expect(soundRow(s.root!)).toBeUndefined();
      expect(s.state?.soundsOn).toBeUndefined();
    }
  });
});
