/**
 * The phone's launch motion (experience/phone/launch.ts, shared/launch/launch.json): the file passes the app's rules and
 * the check finds what would not (an unknown field, name or function, a part that is not one, too many names); the
 * launch served is the file's or a pushed one with a higher v; a phone's bootstrap carries it whole and a desktop's does
 * not; the routes serve it and only the admin pushes or takes one back. When the app's repo sits beside this one, its
 * own compiler plays the same file.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const CONTROL = mkdtempSync(join(tmpdir(), "tz-launch-"));
const ENV = {
  CONTROL_DIR: CONTROL, ADMIN_SECRET: "launch-admin-secret-long-enough-0123456789",
  OPENROUTER_API_KEY: "test-openrouter-key", OPENAI_API_KEY: "test-openai-key", STT_PROVIDER: "openai", DEV_SKIP_AUTH: "true",
};
Object.assign(process.env, ENV);

// eslint-disable-next-line import/first
import { resetConfigForTests } from "../src/config.js";
// eslint-disable-next-line import/first
import { activeLaunch, checkLaunch, dropPushedLaunch, launchFlags, pushLaunch, pushedLaunchFile, resetLaunchForTests, type LaunchSpec } from "../src/experience/phone/launch.js";
// eslint-disable-next-line import/first
import { registerLaunchRoutes } from "../src/routes/app/launchMotion.js";
// eslint-disable-next-line import/first
import { buildBootstrap } from "../src/experience/bootstrap/bootstrap.js";

const FILE = new URL("../../shared/launch/launch.json", import.meta.url);
const launch = (): LaunchSpec => JSON.parse(readFileSync(FILE, "utf8"));

beforeEach(() => {
  Object.assign(process.env, ENV);
  resetConfigForTests();
  rmSync(pushedLaunchFile(), { force: true });
  resetLaunchForTests();
});
afterAll(() => rmSync(CONTROL, { recursive: true, force: true }));

describe("the launch", () => {
  it("the file passes every rule", () => {
    expect(checkLaunch(launch())).toEqual([]);
  });

  it("finds what the app would not play", () => {
    const c = launch();
    const errs = checkLaunch({
      ...c, tail: 1, format: 2, length: 0,
      head: { dy: "wobble(t)", tail: 1 }, bar: { dy: "nobody + 1" }, strip: { let: [["x", "1"]] },
      gloves: { ...c.gloves, let: Array.from({ length: 12 }, (_, i) => [`g${i}`, "1"]) },
    });
    for (const want of ["tail: not something a launch has", "format: 1", "length: ms, up to 10000", "head.dy: unknown function wobble",
      "head.tail: not something the head has (dy, sway, sq, shut, shown)", "bar.dy: unknown name nobody", "strip.let: a new name and an expression"]) {
      expect(errs).toContain(want);
    }
    expect(errs.some((e) => e.startsWith("gloves: at most 32 names"))).toBe(true);
    expect(checkLaunch("x")).toEqual(["a launch: an object"]);
  });
});

describe("served, pushed and carried", () => {
  it("a pushed launch with a higher v is served, kept, and taken back", () => {
    const c = launch();
    expect(activeLaunch()?.v).toBe(c.v);
    expect(pushLaunch({ ...c })).toMatchObject({ ok: false, status: 409 });
    expect(pushLaunch({ ...c, v: c.v + 1, head: { dy: "boom(" } })).toMatchObject({ ok: false, status: 400 });
    const next = { ...c, v: c.v + 1, length: 1800 };
    expect(pushLaunch(next, { dry: true })).toEqual({ ok: true, v: c.v + 1 });
    expect(activeLaunch()?.v, "a dry run keeps nothing").toBe(c.v);
    expect(pushLaunch(next)).toEqual({ ok: true, v: c.v + 1 });
    resetLaunchForTests();
    expect(activeLaunch()?.length, "kept across a restart").toBe(1800);
    dropPushedLaunch();
    expect(activeLaunch()?.v).toBe(c.v);
  });

  it("a phone's bootstrap carries it whole; a desktop's does not", () => {
    expect(launchFlags()).toEqual({ "app.launch": launch() });
    const flags = (formFactor?: "desktop") => (buildBootstrap({ onboarded: true, ...(formFactor ? { formFactor } : {}) }).flags ?? {}) as Record<string, unknown>;
    expect(flags()["app.launch"]).toEqual(launch());
    expect(flags("desktop")["app.launch"]).toBeUndefined();
    expect(JSON.stringify(launch()).length, "small enough to ride every phone's bootstrap").toBeLessThan(8000);
  });

  it("GET /v1/launch serves it (an ETag, a 304); PUT and DELETE are the admin's", async () => {
    const app = Fastify();
    registerLaunchRoutes(app, { rateLimit: undefined });
    await app.ready();
    const c = launch();
    const got = await app.inject({ method: "GET", url: "/v1/launch" });
    expect(got.statusCode).toBe(200);
    expect(got.json().v).toBe(c.v);
    expect((await app.inject({ method: "GET", url: "/v1/launch", headers: { "if-none-match": String(got.headers.etag) } })).statusCode).toBe(304);
    expect((await app.inject({ method: "PUT", url: "/v1/admin/launch", payload: { ...c, v: c.v + 1 } })).statusCode).toBe(401);
    const admin = { "x-admin-secret": ENV.ADMIN_SECRET };
    expect((await app.inject({ method: "PUT", url: "/v1/admin/launch", headers: admin, payload: { ...c, v: c.v + 1, bar: { dy: "x(" } } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/v1/admin/launch", headers: admin, payload: { ...c, v: c.v + 1 } })).json()).toMatchObject({ ok: true, v: c.v + 1 });
    expect((await app.inject({ method: "GET", url: "/v1/launch" })).json().v).toBe(c.v + 1);
    expect((await app.inject({ method: "DELETE", url: "/v1/admin/launch", headers: admin })).json()).toMatchObject({ ok: true, v: c.v });
    await app.close();
  });

  it("the app's own compiler plays the same file (when the app's repo sits beside this one)", async () => {
    const core = new URL("../../../TAILZU-FRONTEND/app/src/launch/launchCore.ts", import.meta.url);
    if (!existsSync(core)) return;
    const { launchMotion } = (await import(core.href)) as { launchMotion: (s: unknown) => { v: number; length: number } };
    const pushed = { ...launch(), v: launch().v + 7 };
    expect(launchMotion(pushed).v, "compiles: a launch that did not would play the build's own v").toBe(pushed.v);
  });
});
