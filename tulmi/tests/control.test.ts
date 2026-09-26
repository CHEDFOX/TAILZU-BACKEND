/**
 * The control plane: rules that edit any payload live, for whoever they
 * target, without a deploy. Unit tests for targeting and every operation,
 * then the whole path through the real routes: save a rule over the admin
 * API, fetch as a client, see it applied — and not applied to anyone else.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONTROL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tailzu-control-"));
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.GROQ_API_KEY = "test-groq-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";
process.env.ADMIN_SECRET = "test-admin-secret-xyz";
process.env.CONTROL_DIR = CONTROL_DIR;

vi.mock("../src/pipeline/cleanup.js", () => ({
  clean: vi.fn(async (s: string) => `cleaned:${s}`),
  assist: vi.fn(async (s: string) => `assisted:${s}`),
  cleanBasic: vi.fn(async (s: string) => `basic:${s}`),
  cleanStream: async function* () {},
  draftReply: vi.fn(async () => "drafted"),
  inferStyle: vi.fn(async () => ({})),
  refineWithTone: vi.fn(async (s: string) => `refined:${s}`),
  LLM_TONES: ["formal", "casual", "very-casual", "excited"],
  expandSnippets: (s: string) => s,
}));
vi.mock("../src/pipeline/stt.js", () => ({
  transcribe: vi.fn(async () => ({ text: "", durationSeconds: 0 })),
  estimateDurationSeconds: () => 0,
}));

import { buildApp } from "../src/server.js";
import { applyOp, applyRules, bucket, cmpVersion, matches, pickVariant, RuleSchema, type Rule } from "../src/control/rules.js";
import { ControlStore } from "../src/control/store.js";

const rule = (r: Partial<Rule> & { id: string }): Rule => RuleSchema.parse({ surface: "*", ...r });
const tree = () => ({
  flags: { "kb.touch.vSlop": 12, "a.b": { deep: 1, keep: 2 } },
  root: {
    type: "Stack",
    children: [
      { type: "Text", id: "hello", props: { content: "Hello there" } },
      { type: "LetterKey", props: { char: "q" }, style: { flex: 1 } },
      { type: "LetterKey", props: { char: "w" }, style: { flex: 1 } },
    ],
  },
  list: [1, 2, 3],
});

describe("targeting", () => {
  it("matches surface, platform, screens, build, version, locale, sign-in", () => {
    const r = rule({ id: "t", surface: "screen", when: {
      screens: ["home"], platform: ["ios"], build: { min: 40 }, appVersion: { min: "1.2.0", max: "1.9" },
      locale: ["hi"], signedIn: true } });
    const ok = { surface: "screen" as const, screen: "home", platform: "ios", build: 40, appVersion: "1.10.0",
      locale: "hi-IN", signedIn: true };
    expect(matches(r, { ...ok, appVersion: "1.3.0" })).toBe(true);
    expect(matches(r, { ...ok, appVersion: "1.10.0" })).toBe(false);
    expect(matches(r, { ...ok, appVersion: "1.3.0", screen: "settings" })).toBe(false);
    expect(matches(r, { ...ok, appVersion: "1.3.0", platform: "android" })).toBe(false);
    expect(matches(r, { ...ok, appVersion: "1.3.0", build: 39 })).toBe(false);
    expect(matches(r, { ...ok, appVersion: "1.3.0", locale: "en" })).toBe(false);
    expect(matches(r, { ...ok, appVersion: "1.3.0", signedIn: false })).toBe(false);
    expect(matches(r, { ...ok, appVersion: "1.3.0", surface: "bootstrap" })).toBe(false);
  });
  it("compares versions numerically", () => {
    expect(cmpVersion("1.10.0", "1.9.3")).toBe(1);
    expect(cmpVersion("2.0", "2.0.0")).toBe(0);
  });
  it("percent slices are stable per user and exclude signed-out unless everyone", () => {
    const r = rule({ id: "slice", when: { percent: [0, 49] } });
    const inSlice = Array.from({ length: 400 }, (_, i) => `u${i}`)
      .filter((u) => matches(r, { surface: "bootstrap", userId: u }));
    expect(inSlice.length).toBeGreaterThan(140);
    expect(inSlice.length).toBeLessThan(260);
    for (const u of inSlice) expect(bucket(u, "slice")).toBeLessThanOrEqual(49);
    expect(matches(r, { surface: "bootstrap" })).toBe(false);
    expect(matches(rule({ id: "all", when: { percent: [0, 99] } }), { surface: "bootstrap" })).toBe(true);
  });
  it("users, exceptUsers, disabled, schedule", () => {
    expect(matches(rule({ id: "u", when: { users: ["a"] } }), { surface: "site", userId: "a" })).toBe(true);
    expect(matches(rule({ id: "u", when: { users: ["a"] } }), { surface: "site", userId: "b" })).toBe(false);
    expect(matches(rule({ id: "x", when: { exceptUsers: ["a"] } }), { surface: "site", userId: "a" })).toBe(false);
    expect(matches(rule({ id: "off", enabled: false }), { surface: "site" })).toBe(false);
    const now = Date.parse("2026-06-01T00:00:00Z");
    const w = rule({ id: "win", when: { from: "2026-05-01T00:00:00Z", until: "2026-05-31T23:59:59Z" } });
    expect(matches(w, { surface: "site", now })).toBe(false);
    expect(matches(w, { surface: "site", now: Date.parse("2026-05-15T00:00:00Z") })).toBe(true);
  });
  it("variants split users by weight, stable per user", () => {
    const r = rule({ id: "exp", variants: [{ name: "a", weight: 3, ops: [] }, { name: "b", weight: 1, ops: [] }] });
    const counts = { a: 0, b: 0 } as Record<string, number>;
    for (let i = 0; i < 1000; i++) counts[pickVariant(r, { surface: "site", userId: `user-${i}` })!.name]!++;
    expect(counts.a).toBeGreaterThan(650);
    expect(counts.b).toBeGreaterThan(170);
    expect(pickVariant(r, { surface: "site", userId: "user-7" })!.name)
      .toBe(pickVariant(r, { surface: "site", userId: "user-7" })!.name);
  });
});

describe("operations", () => {
  it("set / merge / remove / insert by JSON Pointer, including dotted flag keys", () => {
    const t = tree();
    applyOp(t, { op: "set", path: "/flags/kb.touch.vSlop", value: 20 });
    applyOp(t, { op: "merge", path: "/flags/a.b", value: { deep: 9 } });
    applyOp(t, { op: "set", path: "/new/nested/value", value: "made" });
    applyOp(t, { op: "remove", path: "/root/children/2" });
    applyOp(t, { op: "insert", path: "/list", index: 1, value: [7, 8] });
    applyOp(t, { op: "set", path: "/list/-", value: 9 });
    expect(t.flags["kb.touch.vSlop"]).toBe(20);
    expect(t.flags["a.b"]).toEqual({ deep: 9, keep: 2 });
    expect((t as Record<string, unknown>).new).toEqual({ nested: { value: "made" } });
    expect(t.root.children).toHaveLength(2);
    expect(t.list).toEqual([1, 7, 8, 2, 3, 9]);
  });
  it("selector ops reach nodes anywhere", () => {
    const t = tree();
    expect(applyOp(t, { op: "patch", select: { type: "LetterKey" }, value: { style: { flex: 2 } } })).toBe(2);
    expect(t.root.children[1]!.style).toEqual({ flex: 2 });
    applyOp(t, { op: "after", select: { id: "hello" }, value: { type: "Divider" } });
    expect(t.root.children[1]).toEqual({ type: "Divider" });
    applyOp(t, { op: "replace", select: { props: { char: "w" } }, value: { type: "Spacer" } });
    expect(t.root.children[3]).toEqual({ type: "Spacer" });
    applyOp(t, { op: "drop", select: { type: "Divider" } });
    expect(t.root.children.map((c) => c.type)).toEqual(["Text", "LetterKey", "Spacer"]);
    applyOp(t, { op: "append", select: { type: "Stack" }, value: { type: "Button" } });
    applyOp(t, { op: "prepend", select: { type: "Stack" }, value: [{ type: "A" }, { type: "B" }] });
    expect(t.root.children.map((c) => c.type)).toEqual(["A", "B", "Text", "LetterKey", "Spacer", "Button"]);
  });
  it("text rewrites whole strings, or parts with whole=false", () => {
    const t = tree();
    expect(applyOp(t, { op: "text", find: "Hello there", value: "Hi" })).toBe(1);
    expect(applyOp(t, { op: "text", find: "Hi", value: "Hey", whole: false })).toBe(1);
    expect(t.root.children[0]!.props).toEqual({ content: "Hey" });
  });
  it("a failing op is reported, the rest still apply, the input is untouched", () => {
    const input = tree();
    const { payload, applied } = applyRules(input, [rule({ id: "r", ops: [
      { op: "remove", path: "/nope/nothing" },
      { op: "set", path: "/flags/kb.touch.vSlop", value: 30 },
      { op: "patch", select: { type: "Missing" }, value: { x: 1 } },
    ] })], { surface: "keyboard" });
    expect(applied.map((a) => [a.changed, !!a.error])).toEqual([[0, true], [1, false], [0, false]]);
    expect(payload.flags["kb.touch.vSlop"]).toBe(30);
    expect(input.flags["kb.touch.vSlop"]).toBe(12);
  });
  it("no matching rule sends the very same object", () => {
    const input = tree();
    expect(applyRules(input, [rule({ id: "r", surface: "site", ops: [] })], { surface: "keyboard" }).payload).toBe(input);
  });
  it("records the experiment arm in flags", () => {
    const { payload } = applyRules(tree(), [rule({ id: "exp", variants: [{ name: "only", weight: 1, ops: [] }] })],
      { surface: "bootstrap", userId: "u" });
    expect((payload.flags as Record<string, unknown>)["control.variants"]).toEqual({ exp: "only" });
  });
});

describe("store", () => {
  it("saves versions, keeps history, rolls back, refuses a bad file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailzu-store-"));
    const s = new ControlStore(dir, 0);
    expect(s.current().version).toBe(0);
    s.put(rule({ id: "one" }), "me");
    s.put(rule({ id: "two" }), "me");
    expect(s.current().version).toBe(2);
    expect(s.rules().map((r) => r.id).sort()).toEqual(["one", "two"]);
    s.rollback(1, "me");
    expect(s.current().version).toBe(3);
    expect(s.rules().map((r) => r.id)).toEqual(["one"]);
    expect(s.history().map((h) => h.version)).toEqual([3, 2, 1]);
    fs.writeFileSync(path.join(dir, "control.json"), "{ not json");
    const fresh = new ControlStore(dir, 0);
    expect(fresh.rules()).toEqual([]);
    expect(fresh.lastError).toMatch(/refused/);
  });
});

describe("through the real routes", () => {
  let app: FastifyInstance;
  const admin = { "x-admin-secret": "test-admin-secret-xyz", "x-admin-name": "test" };
  const IOS = { "user-agent": "TailzuKeyboard CFNetwork Darwin" };
  const ANDROID = { "user-agent": "okhttp/4.12 TailzuKeyboard" };
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  const kb = async (headers: Record<string, string>) =>
    JSON.parse((await app.inject({ method: "GET", url: "/v1/keyboard/config", headers })).body);
  const put = (r: object & { id: string }) =>
    app.inject({ method: "PUT", url: `/v1/admin/control/rules/${r.id}`, headers: admin, payload: r });

  it("the admin API refuses without the secret", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/control" })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/v1/admin/control/rules/x", payload: {} })).statusCode).toBe(401);
    const ok = await app.inject({ method: "GET", url: "/v1/admin/control", headers: admin });
    expect(ok.statusCode).toBe(200);
  });

  it("serves the console", async () => {
    const r = await app.inject({ method: "GET", url: "/admin" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Tailzu");
    expect(r.body).not.toContain("test-admin-secret-xyz");
  });

  it("a keyboard rule reaches iOS at build 40 and nobody else, live, and bumps the cache", async () => {
    const before = await kb({ ...IOS, "x-tulmi-keyboard-build": "K40" });
    const v0 = JSON.parse((await app.inject({ method: "GET", url: "/v1/admin/cache/version" })).body).cacheVersion;
    const res = await put({ id: "vslop", surface: "keyboard", when: { platform: ["ios"], build: { min: 40 } },
      ops: [{ op: "set", path: "/flags/kb.touch.vSlop", value: 21 }] });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).cacheVersion).not.toBe(v0);
    expect((await kb({ ...IOS, "x-tulmi-keyboard-build": "K40" })).flags["kb.touch.vSlop"]).toBe(21);
    expect((await kb({ ...IOS, "x-tulmi-keyboard-build": "K39" })).flags["kb.touch.vSlop"])
      .toBe(before.flags["kb.touch.vSlop"]);
    expect((await kb({ ...ANDROID, "x-tulmi-keyboard-build": "K40" })).flags["kb.touch.vSlop"])
      .toBe(before.flags["kb.touch.vSlop"]);
  });

  it("a selector rule edits a node in the keyboard tree", async () => {
    await put({ id: "q-key", surface: "keyboard",
      ops: [{ op: "patch", select: { type: "LetterKey", props: { char: "q" } }, value: { style: { fontSize: 30 } } }] });
    const cfg = await kb(IOS);
    const find = (n: any): any => n?.props?.char === "q" && n.type === "LetterKey" ? n
      : (n?.children ?? []).map(find).find(Boolean);
    expect(find(cfg.root).style.fontSize).toBe(30);
  });

  it("site, bootstrap and screens are all reachable", async () => {
    await put({ id: "site-copy", surface: "site", ops: [{ op: "set", path: "/copy/controlProbe", value: "live" }] });
    const site = JSON.parse((await app.inject({ method: "GET", url: "/v1/site" })).body);
    expect(site.copy.controlProbe).toBe("live");

    await put({ id: "boot-flag", surface: "bootstrap", ops: [{ op: "set", path: "/flags/control.probe", value: 7 }] });
    const boot = JSON.parse((await app.inject({ method: "POST", url: "/v1/app/bootstrap",
      payload: { capabilities: { platform: "ios" } } })).body);
    expect(boot.flags["control.probe"]).toBe(7);

    await put({ id: "home-title", surface: "screen", when: { screens: ["home"] },
      ops: [{ op: "set", path: "/controlProbe", value: "home only" }] });
    const home = JSON.parse((await app.inject({ method: "POST", url: "/v1/app/screen",
      payload: { screenId: "home" } })).body);
    expect(home.controlProbe).toBe("home only");
  });

  it("preview shows before, after and what applied, and tries a draft without saving it", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/admin/control/preview", headers: admin, payload: {
      surface: "keyboard", ctx: { platform: "ios", build: 40 },
      draft: { id: "draft-only", surface: "keyboard", ops: [{ op: "set", path: "/flags/kb.draft", value: true }] },
    } });
    const j = JSON.parse(r.body);
    expect(j.status).toBe(200);
    expect(j.base.flags["kb.touch.vSlop"]).not.toBe(21);
    expect(j.result.flags["kb.touch.vSlop"]).toBe(21);
    expect(j.result.flags["kb.draft"]).toBe(true);
    expect(j.applied.map((a: { rule: string }) => a.rule)).toEqual(expect.arrayContaining(["vslop", "draft-only"]));
    expect((await kb(IOS)).flags["kb.draft"]).toBeUndefined();
  });

  it("rejects an invalid rule and keeps history with rollback", async () => {
    const bad = await put({ id: "bad", surface: "nowhere", ops: [] });
    expect(bad.statusCode).toBe(400);
    const hist = JSON.parse((await app.inject({ method: "GET", url: "/v1/admin/control/history", headers: admin })).body);
    expect(hist.versions.length).toBeGreaterThanOrEqual(5);
    const first = hist.versions[hist.versions.length - 1].version;
    await app.inject({ method: "POST", url: "/v1/admin/control/rollback", headers: admin, payload: { version: first } });
    const live = JSON.parse((await app.inject({ method: "GET", url: "/v1/admin/control", headers: admin })).body);
    expect(live.rules.map((r: { id: string }) => r.id)).toEqual(["vslop"]);
    const del = await app.inject({ method: "DELETE", url: "/v1/admin/control/rules/vslop", headers: admin });
    expect(del.statusCode).toBe(200);
    expect((await kb({ ...IOS, "x-tulmi-keyboard-build": "K40" })).flags["kb.touch.vSlop"]).not.toBe(21);
  });
});

describe("android build header", () => {
  let app2: FastifyInstance;
  const admin2 = { "x-admin-secret": "test-admin-secret-xyz" };
  beforeAll(async () => { app2 = await buildApp(); await app2.ready(); });
  afterAll(async () => { await app2.close(); });
  it("A<n> targets Android builds and never unlocks iOS-only gates", async () => {
    await app2.inject({ method: "PUT", url: "/v1/admin/control/rules/android-a2", headers: admin2, payload: {
      surface: "keyboard", when: { platform: ["android"], build: { min: 2 } },
      ops: [{ op: "set", path: "/flags/kb.android.probe", value: true }] } });
    const get = async (b: string) => JSON.parse((await app2.inject({ method: "GET", url: "/v1/keyboard/config",
      headers: { "user-agent": "okhttp/4.12 TailzuKeyboard", "x-tulmi-keyboard-build": b } })).body);
    expect((await get("A2")).flags["kb.android.probe"]).toBe(true);
    expect((await get("A1")).flags["kb.android.probe"]).toBeUndefined();
    // A2 must not read as iOS K2-or-later for iOS-only gates like the veil blur.
    expect((await get("A99")).flags["kb.dictation.dim.blur"]).toBe(false);
    await app2.inject({ method: "DELETE", url: "/v1/admin/control/rules/android-a2", headers: admin2 });
  });
});
