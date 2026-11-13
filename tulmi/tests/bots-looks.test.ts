/**
 * The bots' looks and moments (experience/bots/looks.ts, shared/bots/looks.json; docs/bots-app.md "Looks and moments"):
 * the catalog passes the apps' rules (and the check finds what would not), the expressions are the mic program's
 * language, the catalog served is the file's or a pushed one with a higher v, the bootstrap names it, the routes serve
 * and push it, and screens give a moment only to a build that plays it (else its plain act) and Home its surprises.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const CONTROL = mkdtempSync(join(tmpdir(), "tz-looks-"));
const ENV = {
  CONTROL_DIR: CONTROL, ADMIN_SECRET: "looks-admin-secret-long-enough-0123456789",
  OPENROUTER_API_KEY: "test-openrouter-key", OPENAI_API_KEY: "test-openai-key", STT_PROVIDER: "openai", DEV_SKIP_AUTH: "true",
};
Object.assign(process.env, ENV);

// eslint-disable-next-line import/first
import { resetConfigForTests } from "../src/config.js";
// eslint-disable-next-line import/first
import {
  activeLooks, activeFormat, canScenes, checkLooks, checkMomentExpression, dropPushed, fileCatalog, idleSurprises, looksCan, looksFlags, momentProps,
  offMoments, playsFormat, pushLooks, pushedFile, resetLooksForTests, servedLooks, setOffMoments, type LooksCatalog,
} from "../src/experience/bots/looks.js";
// eslint-disable-next-line import/first
import { registerBotLooksRoutes } from "../src/routes/bots/botLooks.js";
// eslint-disable-next-line import/first
import { buildBotsScreen } from "../src/experience/bots/index.js";
// eslint-disable-next-line import/first
import { botMoment, homeSurprises } from "../src/experience/bots/kit.js";
// eslint-disable-next-line import/first
import { fakeDeps, IST, ctxFor } from "../src/experience/bots/fixtures.js";
// eslint-disable-next-line import/first
import { walk } from "../src/experience/bots/lint.js";
// eslint-disable-next-line import/first
import { buildBootstrap } from "../src/experience/bootstrap/bootstrap.js";

const FILE = new URL("../../shared/bots/looks.json", import.meta.url);
const catalog = (): LooksCatalog => JSON.parse(readFileSync(FILE, "utf8"));

beforeEach(() => {
  Object.assign(process.env, ENV);
  resetConfigForTests();
  rmSync(pushedFile(), { force: true });
  resetLooksForTests();
});
afterAll(() => rmSync(CONTROL, { recursive: true, force: true }));

describe("the catalog", () => {
  it("passes every rule the apps compile by, with a whole-number version", () => {
    const c = catalog();
    expect(checkLooks(c)).toEqual([]);
    expect(Number.isInteger(c.v) && c.v >= 1).toBe(true);
    expect(fileCatalog()?.v).toBe(c.v);
  });

  it("every kind wears an avatar of its own (each Blip's look today), and the first library is there", () => {
    const c = catalog();
    for (const k of ["code", "keybot", "plan", "travel", "notes", "make", "custom"]) {
      expect(c.kinds?.[k]).toBe(k);
      expect(c.avatars?.[k]).toMatchObject({ extends: "blip" });
    }
    for (const id of ["dance", "fart", "sneeze", "sleep", "juggle", "celebrate", "dizzy", "shrug", "facepalm", "highfive", "sweat", "hiccup"]) {
      expect(c.moments?.[id], id).toBeTruthy();
      expect(["play", "wave", "survey", "read", "settle", "think", "carry"]).toContain(c.moments![id]!.fallback ?? "play");
    }
    expect(c.idle?.moments?.length).toBeGreaterThan(0);
    // Every reaction a moment asks of the others is in the catalog, and marked a reaction.
    for (const m of Object.values(c.moments ?? {})) {
      for (const t of (m.tracks as Array<Record<string, unknown>>) ?? []) if (t.do === "others") expect(c.moments![String(t.play)]?.react).toBe(true);
    }
  });

  it("finds what the apps would not play: unknown fields and tracks, bad paths, paints, ranges, names, loops of extends", () => {
    const c = catalog();
    const bad = (mutate: (c: LooksCatalog & Record<string, any>) => void): string[] => {
      const x = JSON.parse(JSON.stringify(c));
      mutate(x);
      return checkLooks(x);
    };
    expect(bad((x) => { x.v = 1.5; })).toContain("v: a whole number from 1");
    expect(bad((x) => { x.colour = "red"; })).toContain("unknown field colour");
    expect(bad((x) => { x.parts.star.draw[0].d = "L 0 0 X 1"; })[0]).toMatch(/parts\.star\.draw\[0\]: "L"/);
    expect(bad((x) => { x.parts.star.draw[0].fill = "red"; })[0]).toMatch(/bad paint red/);
    expect(bad((x) => { x.avatars.pip.eyes.style = "three"; })[0]).toMatch(/avatars\.pip\.eyes\.style: one of/);
    expect(bad((x) => { x.avatars.pip.head.size = 0.9; })[0]).toMatch(/head\.size: a number in \[0\.12, 0\.3\]/);
    expect(bad((x) => { x.avatars.pip.antennae = [{}, {}, {}]; })[0]).toMatch(/antennae: a list of at most 2/);
    expect(bad((x) => { x.avatars.scout.wear[0].part = "monocle"; })[0]).toMatch(/no part "monocle"/);
    expect(bad((x) => { x.avatars.blip.extends = "code"; }).join()).toMatch(/extends itself/);
    expect(bad((x) => { x.moments.dance.tracks.push({ do: "teleport" }); }).join()).toMatch(/do "teleport" is not one the apps play/);
    expect(bad((x) => { x.moments.dance.tracks.push({ do: "crouch", v: "sin(beat" }); }).join()).toMatch(/expected \)/);
    expect(bad((x) => { x.moments.dance.tracks.push({ do: "crouch", v: "wobble(t)" }); }).join()).toMatch(/unknown function wobble/);
    expect(bad((x) => { x.moments.dance.tracks.push({ do: "crouch", v: "y*2" }); }).join()).toMatch(/unknown name y/);
    expect(bad((x) => { x.moments.dance.tracks.push({ do: "crouch", v: "clamp(t, 1)" }); }).join()).toMatch(/clamp takes 3 arguments/);
    expect(bad((x) => { x.moments.dance.tracks.push({ do: "crouch", wobble: 1 }); }).join()).toMatch(/crouch has no field wobble/);
    expect(bad((x) => { x.moments.dance.tracks.push({ do: "hop", at: 99 }); }).join()).toMatch(/at: seconds in \[0, 2\]/);
    expect(bad((x) => { x.moments.dance.tracks.push({ do: "eyes", after: "boom", state: "x" }); }).join()).toMatch(/nothing fires "boom"/);
    expect(bad((x) => { x.moments.dance.tracks.push({ do: "others", play: "nope" }); }).join()).toMatch(/no moment "nope"/);
    expect(bad((x) => { x.moments.dance.tracks.push({ do: "emit", part: "star", paint: "$any", aim: "elbow" }); }).join()).toMatch(/aim: one of/);
    expect(bad((x) => { x.moments.dance.fallback = "dance"; }).join()).toMatch(/fallback: one of/);
    expect(bad((x) => { x.kinds.code = "nobody"; }).join()).toMatch(/kinds\.code: no avatar "nobody"/);
    expect(bad((x) => { x.idle.moments = ["fart", "moonwalk"]; }).join()).toMatch(/idle\.moments/);
    // A recipe for a newer build is left to that build: its tracks are not judged here.
    expect(bad((x) => { x.moments.future = { format: 2, dur: 1, tracks: [{ do: "teleport" }], fallback: "wave" }; })).toEqual([]);
  });

  it("expressions are the mic program's language (motionLang.ts) with a moment's names; a result that is not a number is refused", () => {
    for (const ok of ["0.3*sin(beat*pi) + crest(t)", "x > 2 ? -1 : 1", "clamp(u, 0, 1)^2", "ramp(t, 0.1, 0.4)", "min(1, 2, 3) + hash(k) + tri(T) + sign(side)", "-2^2", "rnd*W + px"]) {
      expect(checkMomentExpression(ok), ok).toBe("");
    }
    for (const bad of ["sin(", "foo(1)", "y + 1", "1 +", "a.b", "random()", "constructor(1)"]) expect(checkMomentExpression(bad), bad).not.toBe("");
  });
});

describe("the catalog served, pushed and taken back", () => {
  it("the file's, until one with a higher v is pushed (kept across a restart); a lower or equal v, or a broken one, is refused", () => {
    const c = catalog();
    expect(activeLooks()?.v).toBe(c.v);
    expect(pushLooks({ ...c, v: c.v })).toMatchObject({ ok: false, status: 409 });
    const broken = pushLooks({ ...c, v: c.v + 1, moments: { x: { dur: 0, tracks: [] } } });
    expect(broken).toMatchObject({ ok: false, status: 400 });
    // Warnings (a scene that does not fit one node size, so that moment plays its fallback act there) are not a no.
    expect(pushLooks({ ...c, v: c.v + 1 }, { dry: true })).toMatchObject({ ok: true, v: c.v + 1 });
    expect(activeLooks()?.v).toBe(c.v);
    expect(pushLooks({ ...c, v: c.v + 1 })).toMatchObject({ ok: true, v: c.v + 1 });
    expect(activeLooks()?.v).toBe(c.v + 1);
    resetLooksForTests();
    expect(activeLooks()?.v, "kept on the control volume").toBe(c.v + 1);
    expect(looksFlags()).toEqual({ "bots.looks": { v: c.v + 1, url: `/v1/bots/looks?v=${c.v + 1}` } });
    dropPushed();
    expect(activeLooks()?.v).toBe(c.v);
  });

  it("the Bots app's bootstrap names it; today's app's does not", () => {
    const flags = (botsApp: boolean) => (buildBootstrap({ botsApp, onboarded: true }).flags ?? {}) as Record<string, unknown>;
    expect(flags(true)["bots.looks"]).toEqual({ v: catalog().v, url: `/v1/bots/looks?v=${catalog().v}` });
    expect(flags(false)["bots.looks"]).toBeUndefined();
  });

  it("GET /v1/bots/looks serves it (an ETag, a 304); PUT and DELETE are the admin's", async () => {
    const app = Fastify();
    registerBotLooksRoutes(app, { rateLimit: undefined });
    await app.ready();
    const c = catalog();
    const got = await app.inject({ method: "GET", url: "/v1/bots/looks" });
    expect(got.statusCode).toBe(200);
    expect(got.json().v).toBe(c.v);
    expect(got.headers["cache-control"]).toMatch(/public/);
    const again = await app.inject({ method: "GET", url: "/v1/bots/looks", headers: { "if-none-match": String(got.headers.etag) } });
    expect(again.statusCode).toBe(304);
    const anon = await app.inject({ method: "PUT", url: "/v1/admin/bots/looks", payload: { ...c, v: c.v + 1 } });
    expect(anon.statusCode).toBe(401);
    const admin = { "x-admin-secret": ENV.ADMIN_SECRET };
    const refused = await app.inject({ method: "PUT", url: "/v1/admin/bots/looks", headers: admin, payload: { ...c, v: c.v + 1, extra: true } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().errors).toContain("unknown field extra");
    const pushedNow = await app.inject({ method: "PUT", url: "/v1/admin/bots/looks", headers: admin, payload: { ...c, v: c.v + 1 } });
    expect(pushedNow.json()).toMatchObject({ ok: true, v: c.v + 1 });
    expect((await app.inject({ method: "GET", url: "/v1/bots/looks" })).json().v).toBe(c.v + 1);
    const back = await app.inject({ method: "DELETE", url: "/v1/admin/bots/looks", headers: admin });
    expect(back.json()).toMatchObject({ ok: true, v: c.v });
    await app.close();
  });
});

describe("moments on screens", () => {
  const ctx = (can: string[]) => ctxFor("bots.home", "phone", undefined, { can: new Set(can) });

  it("a build that plays moments gets the moment; one that does not, the recipe's plain act; an unknown id, nothing", () => {
    expect(momentProps(new Set(["BotMoments"]), "sleep", "loop")).toEqual({ moment: "sleep", momentMode: "loop" });
    expect(momentProps(new Set(), "sleep")).toEqual({ act: "settle" });
    expect(momentProps(new Set(["BotMoments"]), "moonwalk")).toEqual({});
    expect(playsFormat(new Set(["BotMoments", "BotMoments2", "BotMoments3"]))).toBe(3);
    expect(playsFormat(new Set(["BotMoments2"])), "the first name is the promise").toBe(0);
    const everything = { has: () => true } as unknown as ReadonlySet<string>;
    expect(playsFormat(everything), "a set that says yes to every name still ends").toBe(99);
    expect(botMoment(ctx(["BotsKit", "BotsMotion", "BotMoments"]), "celebrate")).toEqual({ moment: "celebrate" });
    expect(botMoment(ctx(["BotsKit", "BotsMotion"]), "celebrate")).toEqual({ act: "wave" });
    expect(botMoment(ctx(["BotsKit", "BotMoments"]), "celebrate"), "moments need the living bots too").toEqual({ act: "wave" });
  });

  it("Home's living tiles carry the rare idle surprises for a build that plays them, as the catalog sets them", async () => {
    const c = catalog();
    expect(idleSurprises(new Set(["BotMoments"]))).toEqual({ every: c.idle!.every, chance: c.idle!.chance, moments: c.idle!.moments });
    expect(homeSurprises(ctx(["BotsKit", "BotsMotion"]))).toBeUndefined();
    const home = async (can: string[]) => {
      const s = await buildBotsScreen({ screenId: "bots.home", client: "phone", tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(can), desk: { pages: false, notes: false } }, fakeDeps());
      return walk(s.root).find((n) => n.type === "BotTiles");
    };
    expect((await home(["BotsKit", "BotsMotion", "BotMoments"]))?.props?.surprises).toEqual({ every: c.idle!.every, chance: c.idle!.chance, moments: c.idle!.moments });
    expect((await home(["BotsKit", "BotsMotion"]))?.props?.surprises).toBeUndefined();
  });
});

describe("looks format 2: the projection served, the kill list, and the highest v ever", () => {
  const F2 = new Set(["BotMoments", "BotMoments2"]);
  const F1 = new Set(["BotMoments"]);

  it("a build that plays only format 1 is served exactly what it was served before: { v, url }, and no scenes", () => {
    const c = catalog();
    expect(looksFlags()).toEqual({ "bots.looks": { v: c.v, url: `/v1/bots/looks?v=${c.v}` } });
    expect(looksFlags(1)).toEqual({ "bots.looks": { v: c.v, url: `/v1/bots/looks?v=${c.v}` } });
    const cut = servedLooks(1)!;
    expect(cut.scenes).toBeUndefined();
    expect(cut.format).toBe(1);
    expect(Object.values(cut.moments ?? {}).every((m) => (m.format ?? 1) === 1)).toBe(true);
  });

  it("a build that plays format 2 gets its format, the f URL and the kill list", () => {
    const c = catalog();
    expect(looksFlags(2)).toEqual({ "bots.looks": { v: c.v, f: 2, url: `/v1/bots/looks?v=${c.v}&f=2`, off: [] } });
    setOffMoments(["p.pond"]);
    expect(offMoments()).toEqual(["p.pond"]);
    expect(looksFlags(2)).toMatchObject({ "bots.looks": { off: ["p.pond"] } });
    // A moment switched off plays its fallback act, even on a build that could play it.
    expect(momentProps(F2, "p.pond")).toEqual({ act: "survey" });
    setOffMoments([]);
    expect(momentProps(F2, "p.pond")).toEqual({ moment: "p.pond" });
    expect(setOffMoments(["NOT AN ID"])).toMatchObject({ ok: false });
  });

  it("a format-2 recipe goes to a build that plays it, and its act to every other", () => {
    expect(momentProps(F1, "p.pond")).toEqual({ act: "survey" });
    expect(momentProps(new Set(), "p.pond")).toEqual({ act: "survey" });
    expect(momentProps(F2, "p.pond", "loop")).toEqual({ moment: "p.pond", momentMode: "loop" });
    expect(canScenes(F2)).toBe(true);
    expect(canScenes(F1)).toBe(false);
    expect(activeFormat()).toBe(2);
    // Home's surprises never carry one a build cannot play, or one switched off.
    const c = catalog();
    const idle = (c.idle?.moments ?? []) as string[];
    expect(idleSurprises(F1)?.moments.every((m) => idle.includes(m))).toBe(true);
  });

  it("GET carries f: the ETag says which cut it is, and no f means the format-1 one", async () => {
    const app = Fastify();
    registerBotLooksRoutes(app, { rateLimit: undefined });
    await app.ready();
    const c = catalog();
    const one = await app.inject({ method: "GET", url: "/v1/bots/looks" });
    expect(one.headers.etag).toBe(`"looks-${c.v}"`);
    expect(one.json().scenes).toBeUndefined();
    const two = await app.inject({ method: "GET", url: `/v1/bots/looks?v=${c.v}&f=2` });
    expect(two.headers.etag).toBe(`"looks-${c.v}-f2"`);
    expect(Object.keys(two.json().scenes ?? {})).toContain("pond");
    const again = await app.inject({ method: "GET", url: "/v1/bots/looks?f=2", headers: { "if-none-match": String(two.headers.etag) } });
    expect(again.statusCode).toBe(304);
    // f is clamped, never trusted: a newer format than this server knows is served as the newest it does.
    const wild = await app.inject({ method: "GET", url: "/v1/bots/looks?f=99" });
    expect(wild.headers.etag).toBe(`"looks-${c.v}-f2"`);
    const low = await app.inject({ method: "GET", url: "/v1/bots/looks?f=zero" });
    expect(low.headers.etag).toBe(`"looks-${c.v}"`);
    await app.close();
  });

  it("each (v, f) URL keeps one catalog forever: a push at or below the highest ever served is refused, even after a DELETE", () => {
    const c = catalog();
    expect(pushLooks({ ...c, v: c.v + 1 })).toMatchObject({ ok: true, v: c.v + 1 });
    dropPushed();
    expect(activeLooks()?.v).toBe(c.v);
    expect(pushLooks({ ...c, v: c.v + 1 })).toMatchObject({ ok: false, status: 409 });
    expect(pushLooks({ ...c, v: c.v + 2 })).toMatchObject({ ok: true, v: c.v + 2 });
  });

  it("the off route is the admin's, and it comes back", async () => {
    const app = Fastify();
    registerBotLooksRoutes(app, { rateLimit: undefined });
    await app.ready();
    const admin = { "x-admin-secret": ENV.ADMIN_SECRET };
    expect((await app.inject({ method: "PUT", url: "/v1/admin/bots/looks/off", payload: { off: [] } })).statusCode).toBe(401);
    const set = await app.inject({ method: "PUT", url: "/v1/admin/bots/looks/off", headers: admin, payload: { off: ["p.pond"] } });
    expect(set.json()).toEqual({ ok: true, off: ["p.pond"] });
    expect((await app.inject({ method: "GET", url: "/v1/admin/bots/looks/off", headers: admin })).json()).toEqual({ ok: true, off: ["p.pond"] });
    const bad = await app.inject({ method: "PUT", url: "/v1/admin/bots/looks/off", headers: admin, payload: { off: ["NOPE"] } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

describe("the launch-dark switch on format 2 (BOTS_SCENES)", () => {
  const F2 = new Set(["BotMoments", "BotMoments2", "DeskShell", "FontBricolage"]);
  const scenes = (on: string | null, users?: string) => {
    if (on === null) delete process.env.BOTS_SCENES; else process.env.BOTS_SCENES = on;
    if (users === undefined) delete process.env.BOTS_SCENES_USERS; else process.env.BOTS_SCENES_USERS = users;
    resetConfigForTests();
  };
  afterEach(() => scenes(null));

  it("off, and off by default: a BotMoments2 build is served exactly what a format-1 build is", () => {
    for (const setting of [null, "false"]) {
      scenes(setting);
      const can = looksCan(F2);
      expect(can.has("BotMoments2")).toBe(false);
      expect(can.has("BotMoments")).toBe(true);
      // Nothing else is touched: the gate drops BotMoments<n >= 2> and no other name.
      expect([...can].sort()).toEqual(["BotMoments", "DeskShell", "FontBricolage"]);
      expect(playsFormat(can)).toBe(1);
      expect(canScenes(can)).toBe(false);
      // The bootstrap's flag is then the one today's builds already get, byte for byte.
      const c = catalog();
      expect(looksFlags(playsFormat(can))).toEqual({ "bots.looks": { v: c.v, url: `/v1/bots/looks?v=${c.v}` } });
      // And the pond goes out as its fallback act, to a build that could have played it.
      expect(momentProps(can, "p.pond")).toEqual({ act: "survey" });
    }
  });

  it("on: the build keeps its format, gets the f URL and the kill list, and is sent the moment itself", () => {
    scenes("true");
    const can = looksCan(F2);
    expect(can).toBe(F2);
    expect(playsFormat(can)).toBe(2);
    expect(canScenes(can)).toBe(true);
    const c = catalog();
    expect(looksFlags(playsFormat(can))).toEqual({ "bots.looks": { v: c.v, f: 2, url: `/v1/bots/looks?v=${c.v}&f=2`, off: [] } });
    expect(momentProps(can, "p.pond")).toEqual({ moment: "p.pond" });
  });

  it("with a list of accounts, only those accounts get it, whoever else asks", () => {
    scenes("true", " u-owner , u-office ");
    expect(playsFormat(looksCan(F2, "u-owner"))).toBe(2);
    expect(playsFormat(looksCan(F2, "u-office"))).toBe(2);
    expect(playsFormat(looksCan(F2, "u-someone"))).toBe(1);
    expect(playsFormat(looksCan(F2))).toBe(1);
    // An empty list means the switch alone decides.
    scenes("true", "");
    expect(playsFormat(looksCan(F2, "u-someone"))).toBe(2);
  });

  it("a later format is gated the same way, and a build with no BotMoments at all is left alone", () => {
    scenes(null);
    const f9 = new Set(["BotMoments", "BotMoments2", "BotMoments9"]);
    expect([...looksCan(f9)]).toEqual(["BotMoments"]);
    const none = new Set(["DeskShell"]);
    expect([...looksCan(none)]).toEqual(["DeskShell"]);
  });
});
