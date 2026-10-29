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
import { afterAll, beforeEach, describe, expect, it } from "vitest";

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
  activeLooks, checkLooks, checkMomentExpression, dropPushed, fileCatalog, idleSurprises, looksFlags, momentProps, playsFormat, pushLooks, pushedFile,
  resetLooksForTests, type LooksCatalog,
} from "../src/experience/bots/looks.js";
// eslint-disable-next-line import/first
import { registerBotLooksRoutes } from "../src/routes/botLooks.js";
// eslint-disable-next-line import/first
import { buildBotsScreen } from "../src/experience/bots/index.js";
// eslint-disable-next-line import/first
import { botMoment, homeSurprises } from "../src/experience/bots/kit.js";
// eslint-disable-next-line import/first
import { fakeDeps, IST, ctxFor } from "../src/experience/bots/fixtures.js";
// eslint-disable-next-line import/first
import { walk } from "../src/experience/bots/lint.js";
// eslint-disable-next-line import/first
import { buildBootstrap } from "../src/experience/catalog.js";

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
    expect(pushLooks({ ...c, v: c.v + 1 }, { dry: true })).toEqual({ ok: true, v: c.v + 1 });
    expect(activeLooks()?.v).toBe(c.v);
    expect(pushLooks({ ...c, v: c.v + 1 })).toEqual({ ok: true, v: c.v + 1 });
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
