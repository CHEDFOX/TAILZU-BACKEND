/**
 * Blip's catalog on the desktop (experience/bots/blip.ts, shared/bots/blip.json): the file passes the desktop's rules and
 * the check finds what would not (an unknown field, name or function, a bad move name in `as`, a missing rest); the
 * catalog served is the file's or a pushed one with a higher v; the desktop's bootstrap names it; the routes serve it
 * and only the admin pushes or takes one back. When the desktop repo sits beside this one, its own compiler agrees.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const CONTROL = mkdtempSync(join(tmpdir(), "tz-blip-"));
const ENV = {
  CONTROL_DIR: CONTROL, ADMIN_SECRET: "blip-admin-secret-long-enough-0123456789",
  OPENROUTER_API_KEY: "test-openrouter-key", OPENAI_API_KEY: "test-openai-key", STT_PROVIDER: "openai", DEV_SKIP_AUTH: "true",
};
Object.assign(process.env, ENV);

// eslint-disable-next-line import/first
import { resetConfigForTests } from "../src/config.js";
// eslint-disable-next-line import/first
import { activeBlip, blipFlags, checkBlip, dropPushedBlip, expandMacros, pushBlip, pushedBlipFile, resetBlipForTests, type BlipCatalog } from "../src/experience/bots/blip.js";
// eslint-disable-next-line import/first
import { registerBlipRoutes } from "../src/routes/bots/blipCatalog.js";
// eslint-disable-next-line import/first
import { buildBootstrap } from "../src/experience/bootstrap/bootstrap.js";

const FILE = new URL("../../shared/bots/blip.json", import.meta.url);
const catalog = (): BlipCatalog => JSON.parse(readFileSync(FILE, "utf8"));

beforeEach(() => {
  Object.assign(process.env, ENV);
  resetConfigForTests();
  rmSync(pushedBlipFile(), { force: true });
  resetBlipForTests();
});
afterAll(() => rmSync(CONTROL, { recursive: true, force: true }));

describe("the catalog", () => {
  it("the file passes every rule, with every move he had", () => {
    const c = catalog();
    expect(checkBlip(c)).toEqual([]);
    expect(Object.keys(c.gestures).length).toBeGreaterThanOrEqual(39);
    for (const m of ["rest", "sleep", "wake", "listen", "think", "send", "done", "celebrate", "talk", "stroll"]) expect(c.gestures[m], m).toBeTruthy();
  });

  it("finds what the desktop would not play", () => {
    const bad = catalog();
    bad.gestures.a = { pose: { tail: 1 } };
    bad.gestures.b = { pose: { tilt: "wobble(t)" } };
    bad.gestures.c = { pose: { tilt: "x + 1" } };
    bad.gestures.d = { steps: [{ as: "nothing" }] };
    bad.gestures.e = { pose: { mouth: "shout" } };
    bad.gestures.f = { let: [["t", "1"]], pose: {} };
    const errs = checkBlip(bad);
    for (const want of ["gestures.a.pose.tail: not a field Blip has", "gestures.b.pose.tilt: unknown function wobble", "gestures.c.pose.tilt: unknown name x",
      "gestures.d.steps[0].as: another move in this catalog", "gestures.e.pose.mouth: mouth is one of smile, grin, flat, o", "gestures.f.let: a new name and an expression"]) {
      expect(errs).toContain(want);
    }
    const noRest = catalog();
    delete (noRest.gestures as Record<string, unknown>).rest;
    expect(checkBlip(noRest)).toContain("gestures: a rest move");
    expect(checkBlip({ ...catalog(), format: 2 })).toContain("format: 1");
  });

  it("macros are spelled out as the desktop spells them", () => {
    expect(expandMacros("io(two(t, max(1, 2)))", { io: [["k"], "k*k"], two: [["a", "b"], "a+b"] })).toBe("((((t)+(max(1, 2))))*(((t)+(max(1, 2)))))");
  });

  it("the desktop's own compiler plays the same file (when the desktop repo sits beside this one)", () => {
    const desk = new URL("../../../TAILZU-DESKTOP/src/shared/blipCatalog.js", import.meta.url);
    if (!existsSync(desk)) return;
    const { compile } = createRequire(import.meta.url)(desk.pathname) as { compile: (c: unknown) => { errors: string[]; gestures: Record<string, unknown> } };
    const r = compile(catalog());
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.gestures).length).toBe(Object.keys(catalog().gestures).length);
  });
});

describe("served, pushed and named", () => {
  it("a pushed catalog with a higher v is served, kept, and taken back", () => {
    const c = catalog();
    expect(activeBlip()?.v).toBe(c.v);
    expect(pushBlip({ ...c, v: c.v })).toMatchObject({ ok: false, status: 409 });
    expect(pushBlip({ ...c, v: c.v + 1, gestures: { ...c.gestures, rest: { pose: { tail: 1 } } } })).toMatchObject({ ok: false, status: 400 });
    const next = { ...c, v: c.v + 1, gestures: { ...c.gestures, wiggle: { length: 1, hover: true, pose: { spin: "0.2*sin(t*20)", mouth: "grin" } } } };
    expect(pushBlip(next, { dry: true })).toEqual({ ok: true, v: c.v + 1 });
    expect(activeBlip()?.v, "a dry run keeps nothing").toBe(c.v);
    expect(pushBlip(next)).toEqual({ ok: true, v: c.v + 1 });
    resetBlipForTests();
    expect(activeBlip()?.gestures.wiggle, "kept across a restart").toBeTruthy();
    dropPushedBlip();
    expect(activeBlip()?.v).toBe(c.v);
  });

  it("the desktop's bootstrap names it; a phone's does not", () => {
    const v = catalog().v;
    expect(blipFlags()).toEqual({ "desktop.blip": { v, url: `/v1/blip?v=${v}` } });
    const flags = (formFactor?: "desktop") => (buildBootstrap({ onboarded: true, ...(formFactor ? { formFactor } : {}) }).flags ?? {}) as Record<string, unknown>;
    expect(flags("desktop")["desktop.blip"]).toEqual({ v, url: `/v1/blip?v=${v}` });
    expect(flags()["desktop.blip"]).toBeUndefined();
  });

  it("GET /v1/blip serves it (an ETag, a 304); PUT and DELETE are the admin's", async () => {
    const app = Fastify();
    registerBlipRoutes(app, { rateLimit: undefined });
    await app.ready();
    const c = catalog();
    const got = await app.inject({ method: "GET", url: "/v1/blip" });
    expect(got.statusCode).toBe(200);
    expect(got.json().v).toBe(c.v);
    expect((await app.inject({ method: "GET", url: "/v1/blip", headers: { "if-none-match": String(got.headers.etag) } })).statusCode).toBe(304);
    expect((await app.inject({ method: "PUT", url: "/v1/admin/blip", payload: { ...c, v: c.v + 1 } })).statusCode).toBe(401);
    const admin = { "x-admin-secret": ENV.ADMIN_SECRET };
    const bad = await app.inject({ method: "PUT", url: "/v1/admin/blip", headers: admin, payload: { ...c, v: c.v + 1, gestures: { rest: { pose: { tilt: "boom(" } } } } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/v1/admin/blip", headers: admin, payload: { ...c, v: c.v + 1 } })).json()).toMatchObject({ ok: true, v: c.v + 1 });
    expect((await app.inject({ method: "GET", url: "/v1/blip" })).json().v).toBe(c.v + 1);
    expect((await app.inject({ method: "DELETE", url: "/v1/admin/blip", headers: admin })).json()).toMatchObject({ ok: true, v: c.v });
    await app.close();
  });
});
