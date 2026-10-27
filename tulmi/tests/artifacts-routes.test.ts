/**
 * The artifact routes (src/routes/artifacts.ts): off unless ARTIFACTS is on; the owner's only; the share token reads and nothing else; saved
 * data by scope with the protocol's limits, and a viewer writes only if the owner said so; rate limits; `ask` metered against the caller; the
 * project routes (a component in place, "build it").
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});
noNetwork();

// Whoever the test says is calling: the token is the user id; none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id ? { id } : null;
    },
  };
});

const { registerArtifactRoutes } = await import("../src/routes/artifacts.js");
const { Guard } = await import("../src/guard/index.js");
const { rig, idOf, FAKE_STRIPE } = await import("./artifacts-rig.js");
type Sent = import("./artifacts-rig.js").Sent;
const { LIMITS } = await import("../src/artifacts/protocol.js");
const { agentRig, APP_FILES } = await import("./agent-rig.js");
const { sym } = await import("./work-fixtures.js");

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const PAGE = `<main>\n  <h1>Poll</h1>\n  <button id="vote">Vote</button>\n</main>\n`;
const PROJECT = "55555555-5555-4555-8555-555555555555";

type Rig = ReturnType<typeof rig>;

async function served(r: Rig | null, o: { rateLimit?: typeof RL; plugin?: boolean; code?: unknown; jobs?: unknown; agent?: unknown } = {}) {
  const app = Fastify();
  if (o.plugin) await app.register(rateLimit, { global: false, max: 1000, timeWindow: 60_000, keyGenerator: (req) => String(req.headers.authorization ?? req.ip) });
  registerArtifactRoutes(app, { guard: new Guard(), rateLimit: o.rateLimit ?? RL, artifacts: r ? { service: r.service } : null, code: (o.code ?? null) as never, jobs: (o.jobs ?? null) as never, agent: (o.agent ?? null) as never });
  await app.ready();
  const call = (user: string | null, method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { ...(user ? who(user) : {}), ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { app, call };
}

/** A rig whose artifact is made by alice. */
async function withPage(answer?: Parameters<typeof rig>[0], o?: Parameters<typeof rig>[1]) {
  const r = rig(answer, o);
  const s = await served(r);
  const made = await s.call("alice", "POST", "/v1/artifacts", { type: "html", title: "Poll", content: PAGE });
  return { r, ...s, id: made.json().artifact.id as string, made };
}

describe("the switch", () => {
  it("is off unless ARTIFACTS=true, and the daily limits have their defaults and can be set", async () => {
    const { getConfig, resetConfigForTests, ENV_KEYS } = await import("../src/config.js");
    const { createArtifacts } = await import("../src/artifacts/index.js");
    resetConfigForTests();
    expect(getConfig()).toMatchObject({ ARTIFACTS: false, ARTIFACT_DAILY_PAISE: 2000, ARTIFACT_ASK_DAILY_PAISE: 500 });
    expect(createArtifacts()).toBeNull();
    for (const k of ["ARTIFACTS", "ARTIFACT_DAILY_PAISE", "ARTIFACT_ASK_DAILY_PAISE"]) expect(ENV_KEYS).toContain(k);
    process.env.ARTIFACTS = "true";
    process.env.ARTIFACT_DAILY_PAISE = "1234";
    process.env.ARTIFACT_ASK_DAILY_PAISE = "99";
    resetConfigForTests();
    try {
      expect(getConfig()).toMatchObject({ ARTIFACTS: true, ARTIFACT_DAILY_PAISE: 1234, ARTIFACT_ASK_DAILY_PAISE: 99 });
      const on = createArtifacts()!;
      expect(on.service.meter.leftPaise("u")).toBe(1234);
      expect(on.service.askMeter.leftPaise("u")).toBe(99);
      expect(createArtifacts({ force: true })).not.toBeNull();
    } finally {
      delete process.env.ARTIFACTS;
      delete process.env.ARTIFACT_DAILY_PAISE;
      delete process.env.ARTIFACT_ASK_DAILY_PAISE;
      resetConfigForTests();
    }
    expect(createArtifacts()).toBeNull();
    expect(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".env.example"), "utf8")).toMatch(/^# ARTIFACTS=false$/m);
  });
});

describe("when artifacts are off", () => {
  it("every route answers 404 artifacts_off, before the session", async () => {
    const { call, app } = await served(null);
    for (const [m, u] of [["GET", "/v1/artifacts"], ["POST", "/v1/artifacts"], ["GET", "/v1/artifacts/x"], ["GET", "/v1/artifacts/shared/tok"], ["GET", "/v1/artifacts/x/data"], ["POST", "/v1/artifacts/x/ask"], ["POST", "/v1/code/projects/x/artifacts/component"], ["POST", "/v1/artifacts/x/build"]] as const) {
      for (const user of [null, "alice"]) {
        const res = await call(user, m, u, {});
        expect(res.statusCode, `${m} ${u}`).toBe(404);
        expect(res.json()).toMatchObject({ code: "artifacts_off" });
      }
    }
    await app.close();
  });
});

describe("making, reading, listing, going back, deleting", () => {
  it("makes an artifact from content: 201 with the text and what it cost, and refuses what validation refuses", async () => {
    const { call, made, id } = await withPage();
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ version: 1, content: PAGE, paise: 0, totalPaise: 0, artifact: { id, type: "html", title: "Poll", headVersion: 1, shared: false, shareToken: null, othersCanSave: false } });
    expect(made.json().artifact.userId).toBeUndefined();
    const secret = await call("alice", "POST", "/v1/artifacts", { type: "html", title: "x", content: `<p>${FAKE_STRIPE}</p>` });
    expect(secret.statusCode).toBe(422);
    expect(secret.json()).toMatchObject({ code: "secret" });
    expect(JSON.stringify(secret.json())).not.toContain(FAKE_STRIPE);
    const lib = await call("alice", "POST", "/v1/artifacts", { type: "react", title: "x", content: `import x from "lodash"; export default () => null;` });
    expect(lib.statusCode).toBe(422);
    expect(lib.json().errors[0]).toMatch(/lodash/);
    expect((await call("alice", "POST", "/v1/artifacts", { type: "word", title: "x", content: "x" })).statusCode).toBe(400);
    expect((await call("alice", "POST", "/v1/artifacts", { type: "html", content: 5 })).statusCode).toBe(400);
    expect((await call("alice", "POST", "/v1/artifacts", { type: "markdown", title: "big", content: "a".repeat(LIMITS.contentBytes + 1) })).statusCode).toBe(413);
  });

  it("makes one from words (the code tier), and says how the classifier read it", async () => {
    const { call, r } = await withPage((s: Sent) => (s.purpose === "classify" ? { json: { type: "feature", difficulty: "low", risk: "low", needs: { web: false, exec: false, vision: false, indic: false }, language: "en", confidence: 0.9, signals: [] } } : "<h1>A clock</h1>"), { paise: 5 });
    const res = await call("alice", "POST", "/v1/artifacts", { type: "html", prompt: "Make a clock that shows the time in Mumbai" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: 1, content: "<h1>A clock</h1>", artifact: { type: "html", title: "Clock that shows the time in Mumbai" }, classifiedAs: { difficulty: "low" }, how: { mode: "generate", tier: "code" } });
    expect(r.model.of("artifact.generate")[0]!.userId).toBe("alice");
    expect(res.json().totalPaise).toBeGreaterThan(0);
    expect(res.json().artifact.spentPaise).toBe(res.json().totalPaise);
  });

  it("reads the head or an earlier version, lists newest first (by project too), shows the versions, goes back, and deletes", async () => {
    // A clock that never gives the same millisecond twice: two artifacts made in one millisecond are listed in the order of their random ids.
    let last = Date.now();
    const { call, id } = await withPage(undefined, { now: () => (last = Math.max(last + 1, Date.now())) });
    await call("alice", "POST", "/v1/artifacts", { type: "markdown", title: "Other", content: "# o", projectId: PROJECT });
    const head = await call("alice", "GET", `/v1/artifacts/${id}`);
    expect(head.json()).toMatchObject({ version: 1, content: PAGE, artifact: { id, headVersion: 1 } });
    expect((await call("alice", "GET", `/v1/artifacts/${id}?version=1`)).json().content).toBe(PAGE);
    expect((await call("alice", "GET", `/v1/artifacts/${id}?version=2`)).statusCode).toBe(404);
    expect((await call("alice", "GET", `/v1/artifacts/${id}?version=abc`)).statusCode).toBe(400);
    const list = (await call("alice", "GET", "/v1/artifacts")).json().artifacts;
    expect(list.map((a: { title: string }) => a.title)).toEqual(["Other", "Poll"]);
    expect((await call("alice", "GET", `/v1/artifacts?projectId=${PROJECT}`)).json().artifacts.map((a: { title: string }) => a.title)).toEqual(["Other"]);
    expect((await call("alice", "GET", "/v1/artifacts?projectId=nope")).statusCode).toBe(400);
    expect((await call("alice", "GET", `/v1/artifacts/${id}/versions`)).json().versions).toEqual([expect.objectContaining({ version: 1, kind: "snapshot", madeBy: "person" })]);
    expect((await call("alice", "POST", `/v1/artifacts/${id}/revert`, { version: 1 })).statusCode).toBe(400);
    expect((await call("alice", "DELETE", `/v1/artifacts/${id}`)).json()).toEqual({ ok: true });
    expect((await call("alice", "GET", `/v1/artifacts/${id}`)).statusCode).toBe(404);
  });

  it("goes back to a version as a new one, with its text", async () => {
    const r = rig((s: Sent) => /<element>\n([\s\S]*?)\n<\/element>/.exec(s.user)![1]!.replace("Poll", "Vote now"), { paise: 3 });
    const { call } = await served(r);
    const id = (await call("alice", "POST", "/v1/artifacts", { type: "html", title: "P", content: PAGE })).json().artifact.id;
    const el = await call("alice", "POST", `/v1/artifacts/${id}/edit`, { instruction: "Rename the heading", elementId: idOf(PAGE, "<h1>") });
    expect(el.statusCode).toBe(200);
    expect(el.json()).toMatchObject({ version: 2, content: PAGE.replace("Poll", "Vote now"), paise: 3, totalPaise: 3, how: { mode: "element", tier: "cheap" }, artifact: { headVersion: 2, spentPaise: 3 } });
    const back = await call("alice", "POST", `/v1/artifacts/${id}/revert`, { version: 1 });
    expect(back.json()).toMatchObject({ version: 3, content: PAGE, paise: 0 });
    expect((await call("alice", "GET", `/v1/artifacts/${id}/versions`)).json().versions.map((v: { version: number; madeBy: string }) => [v.version, v.madeBy])).toEqual([[3, "person"], [2, "person"], [1, "person"]]);
  });
});

describe("the owner's only", () => {
  it("is 404 for anyone else on every route that names an artifact, and 401 with no session", async () => {
    const { call, id } = await withPage();
    const mine = [
      ["GET", `/v1/artifacts/${id}`], ["GET", `/v1/artifacts/${id}/versions`], ["POST", `/v1/artifacts/${id}/revert`, { version: 1 }], ["DELETE", `/v1/artifacts/${id}`],
      ["POST", `/v1/artifacts/${id}/edit`, { instruction: "x" }], ["POST", `/v1/artifacts/${id}/errors`, { version: 1, kind: "runtime", message: "m", line: 1 }],
      ["POST", `/v1/artifacts/${id}/share`, {}], ["DELETE", `/v1/artifacts/${id}/share`],
    ] as const;
    for (const [m, u, b] of mine) {
      const bob = await call("bob", m, u, b);
      expect(bob.statusCode, `${m} ${u}`).toBe(404);
      expect(bob.json().message).toBe("I couldn't find that artifact.");
      expect((await call(null, m, u, b)).statusCode, `${m} ${u} (no session)`).toBe(401);
    }
    // another person's artifact looks exactly like one that is not there
    expect((await call("bob", "GET", `/v1/artifacts/${id.replace(/.$/, "0")}`)).json()).toEqual((await call("bob", "GET", `/v1/artifacts/${id}`)).json());
    expect((await call("bob", "GET", "/v1/artifacts")).json().artifacts).toEqual([]);
    // and alice's artifact is untouched
    expect((await call("alice", "GET", `/v1/artifacts/${id}`)).json().content).toBe(PAGE);
  });
});

describe("sharing", () => {
  it("makes a link anyone can read: the text and the title, and not who owns it, what it cost or which project", async () => {
    const { call, id } = await withPage();
    const shared = await call("alice", "POST", `/v1/artifacts/${id}/share`, {});
    expect(shared.statusCode).toBe(200);
    const { token, path } = shared.json();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(path).toBe(`/v1/artifacts/shared/${token}`);
    // idempotent
    expect((await call("alice", "POST", `/v1/artifacts/${id}/share`, {})).json().token).toBe(token);
    const pub = await call(null, "GET", path);
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toEqual({ id, type: "html", title: "Poll", version: 1, content: PAGE, othersCanSave: false });
    expect(pub.headers["cache-control"]).toBe("private, no-store");
    expect(pub.headers["referrer-policy"]).toBe("no-referrer");
    // the owner sees the token on their own view
    expect((await call("alice", "GET", `/v1/artifacts/${id}`)).json().artifact).toMatchObject({ shared: true, shareToken: token });
  });

  it("carries the project's look to the link, so it looks the same there", async () => {
    const r = rig();
    const { call } = await served(r);
    const id = (await call("alice", "POST", "/v1/artifacts", { type: "html", title: "P", content: PAGE, projectId: PROJECT })).json().artifact.id;
    await r.store.putKit(PROJECT, "alice", "sha", { prompt: "p", css: { css: ":root { --tz-primary: #7c3aed; }", fonts: ["https://fonts.googleapis.com/css2?family=Inter"] } });
    const { path } = (await call("alice", "POST", `/v1/artifacts/${id}/share`, {})).json();
    expect((await call(null, "GET", path)).json().kit).toEqual({ css: ":root { --tz-primary: #7c3aed; }", fonts: ["https://fonts.googleapis.com/css2?family=Inter"] });
    expect((await call("alice", "GET", `/v1/artifacts/${id}`)).json().kit.css).toContain("--tz-primary");
    // and neither the project nor the kit's prompt is shown to the link
    expect(JSON.stringify((await call(null, "GET", path)).json())).not.toContain(PROJECT);
  });

  it("is read only: nothing writes through a share link, and a revoked or invented token opens nothing", async () => {
    const { call, id } = await withPage();
    const { token, path } = (await call("alice", "POST", `/v1/artifacts/${id}/share`, {})).json();
    for (const m of ["POST", "PUT", "DELETE"] as const) expect((await call(null, m, path, { content: "<p>pwned</p>" })).statusCode, m).toBe(404);
    // the owner's routes need the owner, whatever the token
    expect((await call("bob", "POST", `/v1/artifacts/${id}/edit`, { instruction: "x" }, { "x-artifact-share": token })).statusCode).toBe(404);
    expect((await call("bob", "DELETE", `/v1/artifacts/${id}`, undefined, { "x-artifact-share": token })).statusCode).toBe(404);
    expect((await call("bob", "GET", `/v1/artifacts/${id}`, undefined, { "x-artifact-share": token })).statusCode).toBe(404);
    expect((await call("alice", "GET", `/v1/artifacts/${id}`)).json().content).toBe(PAGE);
    expect((await call(null, "GET", "/v1/artifacts/shared/not-a-real-token-at-all-1234567890")).statusCode).toBe(404);
    expect((await call(null, "GET", "/v1/artifacts/shared/x")).json().code).toBe("not_shared");
    expect((await call("alice", "DELETE", `/v1/artifacts/${id}/share`)).json()).toEqual({ ok: true });
    const gone = await call(null, "GET", path);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toMatchObject({ code: "not_shared" });
    // sharing again makes a different token
    expect((await call("alice", "POST", `/v1/artifacts/${id}/share`, {})).json().token).not.toBe(token);
  });

  it("shows the head, so the link follows the owner's changes", async () => {
    const r = rig((s: Sent) => /<element>\n([\s\S]*?)\n<\/element>/.exec(s.user)![1]!.replace("Poll", "Quiz"));
    const { call } = await served(r);
    const id = (await call("alice", "POST", "/v1/artifacts", { type: "html", title: "P", content: PAGE })).json().artifact.id;
    const { path } = (await call("alice", "POST", `/v1/artifacts/${id}/share`, {})).json();
    await call("alice", "POST", `/v1/artifacts/${id}/edit`, { instruction: "Rename it", elementId: idOf(PAGE, "<h1>") });
    expect((await call(null, "GET", path)).json()).toMatchObject({ version: 2, content: PAGE.replace("Poll", "Quiz") });
  });
});

describe("saved data", () => {
  it("is the owner's, in two scopes: the artifact's shared data and their own", async () => {
    const { call, id } = await withPage();
    const d = `/v1/artifacts/${id}/data`;
    expect((await call("alice", "PUT", `${d}/score?scope=shared`, { value: { n: 1 } })).json()).toEqual({ ok: true });
    expect((await call("alice", "PUT", `${d}/score`, { value: 7 })).json()).toEqual({ ok: true }); // me is the default
    expect((await call("alice", "PUT", `${d}/score?scope=me`, { value: 8 })).statusCode).toBe(200);
    expect((await call("alice", "GET", `${d}/score?scope=shared`)).json()).toEqual({ found: true, value: { n: 1 } });
    expect((await call("alice", "GET", `${d}/score`)).json()).toEqual({ found: true, value: 8 });
    expect((await call("alice", "GET", `${d}/nothing`)).json()).toEqual({ found: false, value: null });
    expect((await call("alice", "GET", `${d}?scope=shared`)).json()).toEqual({ keys: ["score"] });
    expect((await call("alice", "DELETE", `${d}/score?scope=shared`)).json()).toEqual({ ok: true, deleted: true });
    expect((await call("alice", "DELETE", `${d}/score?scope=shared`)).json()).toEqual({ ok: true, deleted: false });
    expect((await call("alice", "GET", `${d}?scope=shared`)).json()).toEqual({ keys: [] });
    expect((await call("alice", "GET", `${d}?scope=everyone`)).statusCode).toBe(400);
    // someone who is not the owner and has no link is not let in
    expect((await call("bob", "GET", `${d}?scope=shared`)).statusCode).toBe(404);
    expect((await call(null, "GET", `${d}?scope=shared`)).statusCode).toBe(401);
  });

  it("holds the protocol's limits: a value of 64 KB, 500 keys a scope, and a key that is a key", async () => {
    const { call, id, r } = await withPage(undefined, { rates: { data: 100_000 } });
    const d = `/v1/artifacts/${id}/data`;
    expect((await call("alice", "PUT", `${d}/big?scope=shared`, { value: "x".repeat(LIMITS.storageValueBytes) })).statusCode).toBe(413);
    expect((await call("alice", "PUT", `${d}/ok?scope=shared`, { value: "x".repeat(LIMITS.storageValueBytes - 10) })).statusCode).toBe(200);
    for (const bad of ["a%00b", "%20lead", "%2e%2e%2f"]) expect((await call("alice", "PUT", `${d}/${bad}?scope=shared`, { value: 1 })).statusCode, bad).toBe(400);
    expect((await call("alice", "PUT", `${d}/novalue?scope=shared`, {})).statusCode).toBe(400);
    for (let i = 0; i < LIMITS.storageKeys - 1; i += 1) await r.store.dataPut(id, "shared", `k${i}`, i);
    const full = await call("alice", "PUT", `${d}/one-more?scope=shared`, { value: 1 });
    expect(full.statusCode).toBe(409);
    expect(full.json()).toMatchObject({ code: "too_many" });
    expect((await call("alice", "PUT", `${d}/k3?scope=shared`, { value: "changed" })).statusCode).toBe(200);
    // the other scope has its own room
    expect((await call("alice", "PUT", `${d}/one-more`, { value: 1 })).statusCode).toBe(200);
  });

  it("lets someone with the link READ the shared data, and write it only when the owner turned saving on", async () => {
    const { call, id } = await withPage();
    const d = `/v1/artifacts/${id}/data`;
    const { token } = (await call("alice", "POST", `/v1/artifacts/${id}/share`, {})).json();
    await call("alice", "PUT", `${d}/votes?scope=shared`, { value: [1, 2] });
    const link = { "x-artifact-share": token };
    // anonymous, with the link
    expect((await call(null, "GET", `${d}/votes?scope=shared`, undefined, link)).json()).toEqual({ found: true, value: [1, 2] });
    expect((await call(null, "GET", `${d}?scope=shared&share=${token}`)).json()).toEqual({ keys: ["votes"] });
    const denied = await call(null, "PUT", `${d}/votes?scope=shared`, { value: "mine" }, link);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().message).toMatch(/not turned on saving/);
    expect((await call(null, "DELETE", `${d}/votes?scope=shared`, undefined, link)).statusCode).toBe(403);
    // no session: no data of their own
    expect((await call(null, "GET", `${d}/votes`, undefined, link)).statusCode).toBe(401);
    // signed in with the link: their own scope reads, and writes only when allowed
    expect((await call("bob", "GET", `${d}/mine`, undefined, link)).json()).toEqual({ found: false, value: null });
    expect((await call("bob", "PUT", `${d}/mine`, { value: 1 }, link)).statusCode).toBe(403);
    // the owner turns saving on
    expect((await call("alice", "POST", `/v1/artifacts/${id}/share`, { othersCanSave: true })).json()).toMatchObject({ token, othersCanSave: true });
    expect((await call(null, "PUT", `${d}/votes?scope=shared`, { value: [1, 2, 3] }, link)).statusCode).toBe(200);
    expect((await call("alice", "GET", `${d}/votes?scope=shared`)).json().value).toEqual([1, 2, 3]);
    expect((await call("bob", "PUT", `${d}/mine`, { value: "bobs" }, link)).statusCode).toBe(200);
    // bob's own scope is bob's: the owner's `me` is alice's own, and anonymous cannot reach bob's
    expect((await call("bob", "GET", `${d}/mine`, undefined, link)).json().value).toBe("bobs");
    expect((await call("alice", "GET", `${d}/mine`)).json()).toEqual({ found: false, value: null });
    expect((await call("carol", "GET", `${d}/mine`, undefined, link)).json()).toEqual({ found: false, value: null });
    // a wrong token is nothing, and taking the link back takes the access with it
    expect((await call(null, "GET", `${d}?scope=shared`, undefined, { "x-artifact-share": "wrong" })).statusCode).toBe(404);
    await call("alice", "DELETE", `/v1/artifacts/${id}/share`);
    expect((await call(null, "GET", `${d}/votes?scope=shared`, undefined, link)).statusCode).toBe(404);
    expect((await call("bob", "GET", `${d}/mine`, undefined, link)).statusCode).toBe(404);
    // turning the link off turned saving off with it
    expect((await call("alice", "POST", `/v1/artifacts/${id}/share`, {})).json().othersCanSave).toBe(false);
  });

  it("is rate limited per person, and per link when there is no person", async () => {
    const { call, id } = await withPage(undefined, { rates: { data: 3 } });
    const d = `/v1/artifacts/${id}/data`;
    const { token } = (await call("alice", "POST", `/v1/artifacts/${id}/share`, {})).json();
    for (let i = 0; i < 3; i += 1) expect((await call("alice", "GET", `${d}?scope=shared`)).statusCode).toBe(200);
    const slow = await call("alice", "GET", `${d}?scope=shared`);
    expect(slow.statusCode).toBe(429);
    expect(slow.json()).toMatchObject({ code: "rate_limited" });
    expect(Number(slow.headers["retry-after"])).toBeGreaterThan(0);
    // alice's limit is alice's: the link has its own, and so does bob
    for (let i = 0; i < 3; i += 1) expect((await call(null, "GET", `${d}?scope=shared`, undefined, { "x-artifact-share": token })).statusCode).toBe(200);
    expect((await call(null, "GET", `${d}?scope=shared`, undefined, { "x-artifact-share": token })).statusCode).toBe(429);
    expect((await call("bob", "GET", `${d}?scope=shared`, undefined, { "x-artifact-share": token })).statusCode).toBe(200);
  });

  it("is also held by the app's own limiter, tightened for these routes", async () => {
    const r = rig();
    const s = await served(r, { plugin: true, rateLimit: { rateLimit: { max: 3, timeWindow: 60_000 } } });
    const id = (await s.call("alice", "POST", "/v1/artifacts", { type: "html", title: "P", content: PAGE })).json().artifact.id;
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) codes.push((await s.call("alice", "GET", `/v1/artifacts/${id}/data?scope=shared`)).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]); // the route has the app's limit, here 3, counted on its own
    await s.app.close();
  });
});

describe("ask", () => {
  const answer = (s: Sent) => (s.purpose === "artifact.ask" ? `You asked: ${/<question>\n([\s\S]*?)\n<\/question>/.exec(s.user)?.[1] ?? "?"}` : "");

  it("is metered against the person who asked, the cheap tier by default, with their id and not the owner's", async () => {
    const { call, id, r } = await withPage(answer, { paise: 6, askDailyPaise: 20 });
    const { token } = (await call("alice", "POST", `/v1/artifacts/${id}/share`, {})).json();
    const link = { "x-artifact-share": token };
    const mine = await call("alice", "POST", `/v1/artifacts/${id}/ask`, { prompt: "What is 2 + 2?" });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toEqual({ text: "You asked: What is 2 + 2?", paise: 6, leftPaise: 14 });
    const theirs = await call("bob", "POST", `/v1/artifacts/${id}/ask`, { prompt: "Tell me a joke" }, link);
    expect(theirs.json()).toMatchObject({ paise: 6, leftPaise: 14 });
    const sent = r.model.of("artifact.ask");
    expect(sent.map((s) => [s.userId, s.tier])).toEqual([["alice", "cheap"], ["bob", "cheap"]]);
    expect(sent[1]!.capPaise).toBeLessThanOrEqual(200);
    // alice's day is alice's: she can spend more of hers without touching bob's
    await call("alice", "POST", `/v1/artifacts/${id}/ask`, { prompt: "again" });
    await call("alice", "POST", `/v1/artifacts/${id}/ask`, { prompt: "again" });
    expect(r.service.askMeter.usedPaise("alice")).toBe(18);
    expect(r.service.askMeter.usedPaise("bob")).toBe(6);
    // the owner's money for edits is not touched by asks
    expect(r.service.meter.usedPaise("alice")).toBe(0);
    expect((await r.service.own("alice", id)).spentPaise).toBe(0);
    // a day's worth: the next ask is refused for the one who has used theirs up, and only for them
    const over = await call("alice", "POST", `/v1/artifacts/${id}/ask`, { prompt: "more" });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ code: "limit_reached" });
    expect((await call("bob", "POST", `/v1/artifacts/${id}/ask`, { prompt: "more" }, link)).statusCode).toBe(200);
  });

  it("may use the code tier when asked to, and nothing stronger", async () => {
    const { call, id, r } = await withPage(answer);
    expect((await call("alice", "POST", `/v1/artifacts/${id}/ask`, { prompt: "hard one", tier: "code" })).statusCode).toBe(200);
    expect(r.model.of("artifact.ask")[0]!.tier).toBe("code");
    expect((await call("alice", "POST", `/v1/artifacts/${id}/ask`, { prompt: "x", tier: "strong" })).statusCode).toBe(400);
  });

  it("needs a signed-in caller who may open the artifact, a prompt, and at most LIMITS.askChars", async () => {
    const { call, id } = await withPage(answer);
    const { token } = (await call("alice", "POST", `/v1/artifacts/${id}/share`, {})).json();
    const ask = `/v1/artifacts/${id}/ask`;
    // there is no one to meter without a session
    const anon = await call(null, "POST", ask, { prompt: "hi" }, { "x-artifact-share": token });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ code: "needs_login" });
    expect((await call("bob", "POST", ask, { prompt: "hi" })).statusCode).toBe(404);
    expect((await call("alice", "POST", ask, {})).statusCode).toBe(400);
    expect((await call("alice", "POST", ask, { prompt: "   " })).statusCode).toBe(400);
    expect((await call("alice", "POST", ask, { prompt: "x".repeat(LIMITS.askChars) })).statusCode).toBe(200);
    const long = await call("alice", "POST", ask, { prompt: "x".repeat(LIMITS.askChars + 1) });
    expect(long.statusCode).toBe(413);
    expect(long.json()).toMatchObject({ code: "too_large" });
  });

  it("is rate limited, does not show the model a secret, and says plainly when the model is down", async () => {
    const { call, id, r } = await withPage(answer, { rates: { ask: 2 } });
    await call("alice", "POST", `/v1/artifacts/${id}/ask`, { prompt: `my key is ${FAKE_STRIPE}` });
    expect(r.model.of("artifact.ask")[0]!.user).not.toContain(FAKE_STRIPE);
    await call("alice", "POST", `/v1/artifacts/${id}/ask`, { prompt: "two" });
    const third = await call("alice", "POST", `/v1/artifacts/${id}/ask`, { prompt: "three" });
    expect(third.statusCode).toBe(429);
    expect(third.json().code).toBe("rate_limited");
    const down = await withPage(answer);
    down.r.model.down.add("cheap");
    const res = await down.call("alice", "POST", `/v1/artifacts/${down.id}/ask`, { prompt: "hello" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "model_down" });
    // one call, no climb: a cheap ask is not turned into a code ask behind the person's back
    expect(down.r.model.of("artifact.ask")).toHaveLength(1);
  });
});

describe("a person's edits and the viewer's errors", () => {
  const broken = `export default function App() {\n  const n = items.length;\n  return <p>{n}</p>;\n}\n`;

  it("edits by pointing and by saying, and says what it cost", async () => {
    const r = rig((s: Sent) => (s.purpose === "artifact.edit" ? "<edit><old>Vote</old><new>Vote now</new></edit>" : /<element>\n([\s\S]*?)\n<\/element>/.exec(s.user)![1]!.replace("Poll", "Poll!")), { paise: 2 });
    const { call } = await served(r);
    const id = (await call("alice", "POST", "/v1/artifacts", { type: "html", title: "P", content: PAGE })).json().artifact.id;
    const a = await call("alice", "POST", `/v1/artifacts/${id}/edit`, { instruction: "Add a bang", elementId: idOf(PAGE, "<h1>") });
    expect(a.json()).toMatchObject({ version: 2, how: { mode: "element" }, paise: 2 });
    const b = await call("alice", "POST", `/v1/artifacts/${id}/edit`, { instruction: "Say Vote now on the button" });
    expect(b.json()).toMatchObject({ version: 3, how: { mode: "whole" }, totalPaise: 4 });
    expect(b.json().content).toContain("Vote now");
    expect((await call("alice", "POST", `/v1/artifacts/${id}/edit`, { instruction: "" })).statusCode).toBe(400);
    expect((await call("alice", "POST", `/v1/artifacts/${id}/edit`, { instruction: "x", elementId: 5 })).statusCode).toBe(400);
    const gone = await call("alice", "POST", `/v1/artifacts/${id}/edit`, { instruction: "x", elementId: "99:1" });
    expect(gone.statusCode).toBe(422);
    expect(gone.json()).toMatchObject({ code: "no_element" });
  });

  it("is rate limited per person", async () => {
    const r = rig(() => "no", { rates: { edit: 2 } });
    const { call } = await served(r);
    const id = (await call("alice", "POST", "/v1/artifacts", { type: "html", title: "P", content: PAGE })).json().artifact.id;
    const codes: number[] = [];
    for (let i = 0; i < 3; i += 1) codes.push((await call("alice", "POST", `/v1/artifacts/${id}/edit`, { instruction: "x" })).statusCode);
    expect(codes).toEqual([422, 422, 429]);
  });

  it("fixes the viewer's error from the lines around it, once, and answers duplicate for the same error again", async () => {
    const r = rig(() => "<edit><old>const n = items.length;</old><new>const n = 0;</new></edit>", { paise: 3 });
    const { call } = await served(r);
    const id = (await call("alice", "POST", "/v1/artifacts", { type: "react", title: "B", content: broken })).json().artifact.id;
    const err = { version: 1, kind: "runtime", message: "items is not defined", line: 2, col: 13 };
    const fixed = await call("alice", "POST", `/v1/artifacts/${id}/errors`, err);
    expect(fixed.json()).toMatchObject({ status: "fixed", version: 2, content: broken.replace("items.length", "0"), paise: 3, how: { mode: "fix", tier: "cheap" } });
    expect((await call("alice", "POST", `/v1/artifacts/${id}/errors`, err)).json()).toEqual({ status: "stale", head: 2 });
    const dup = await call("alice", "POST", `/v1/artifacts/${id}/errors`, { ...err, version: 2, message: "x is not defined" });
    expect(dup.json().status).toBe("failed"); // nothing to fix there: the model's edit does not apply to version 2
    expect((await call("alice", "POST", `/v1/artifacts/${id}/errors`, { ...err, version: 2, message: "x is not defined" })).json()).toEqual({ status: "duplicate" });
    expect(r.model.of("artifact.fix").length).toBeGreaterThanOrEqual(2);
    expect((await call("alice", "POST", `/v1/artifacts/${id}/errors`, { version: 1, kind: "weird", message: "m" })).statusCode).toBe(400);
    expect((await call("alice", "POST", `/v1/artifacts/${id}/errors`, { kind: "runtime", message: "m" })).statusCode).toBe(400);
  });
});

// ------------------------------------------------------------------ the Code bot's routes

describe("a component in place, and build it", () => {
  const FILES = {
    ...APP_FILES,
    "tailwind.config.js": `module.exports = { theme: { extend: { colors: { primary: "#7c3aed" } } } }`,
    "src/components/ui/Button.tsx": `export function Button({ variant, size }) { return null; }`,
  };
  const ROWS = [
    { path: "src/util.ts", symbols: [sym("slug")], summary: "String helpers: slug turns a title into a URL slug.", rank: 0.8 },
    { path: "src/components/ui/Button.tsx", symbols: [sym("Button", "component")], summary: "The button.", rank: 0.9 },
  ];

  async function codeRig() {
    const a = await agentRig({ files: FILES, rows: ROWS, structure: { frameworks: ["React", "Tailwind CSS"] } as never });
    a.json.on("artifact.generate", "export default function Card() { return <p>Slug helper</p>; }");
    a.json.on("artifact.vision", "A card with a title and a button.");
    const { ArtifactService } = await import("../src/artifacts/service.js");
    const { MemoryArtifactStore } = await import("../src/artifacts/store.js");
    const service = new ArtifactService({ store: new MemoryArtifactStore(), call: a.model.call as never });
    const code = { ...a.code, brain: { open: async () => a.fixture.brain, runtime: { call: a.model.call } } };
    const app = Fastify();
    registerArtifactRoutes(app, { guard: new Guard(), rateLimit: RL, artifacts: { service }, code: code as never, jobs: a.jobs, agent: a.orch });
    await app.ready();
    const call = (user: string | null, method: "GET" | "POST", url: string, payload?: unknown) =>
      app.inject({ method, url, ...(user ? { headers: who(user) } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { a, service, app, call };
  }

  it("makes a component in the project's style: 201 with the text, where it goes, the kit and what each piece cost", async () => {
    const { a, call, service } = await codeRig();
    const res = await call("alice", "POST", `/v1/code/projects/${a.project.id}/artifacts/component`, { request: "a slug helper card for src/util.ts" });
    expect(res.statusCode).toBe(201);
    const j = res.json();
    expect(j).toMatchObject({ version: 1, type: "react", content: expect.stringContaining("Slug helper"), kit: { cached: false, systems: expect.arrayContaining(["Tailwind CSS"]) }, paise: { make: expect.any(Number) } });
    expect(j.located.targets[0].path).toBe("src/util.ts");
    expect(j.artifact.projectId).toBe(a.project.id);
    expect(JSON.stringify(j)).not.toMatch(/userId/);
    expect((await service.get("alice", j.artifact.id)).kit!.css).toContain("--tz-primary: #7c3aed;");
    // the same project's second component reads the kit from the cache
    const again = await call("alice", "POST", `/v1/code/projects/${a.project.id}/artifacts/component`, { request: "another slug helper card" });
    expect(again.json().kit.cached).toBe(true);
  });

  it("takes a picture, checks it, and sends it to the vision tier first", async () => {
    const { a, call } = await codeRig();
    const url = `/v1/code/projects/${a.project.id}/artifacts/component`;
    for (const image of ["http://x.test/a.png", "data:text/html;base64,AAAA", "data:image/svg+xml;base64,AAAA", 5, "data:image/png;base64,@@@"]) {
      expect((await call("alice", "POST", url, { request: "a card", image })).statusCode, String(image)).toBe(400);
    }
    const ok = await call("alice", "POST", url, { request: "build this sketch of a slug helper card", image: "data:image/png;base64,iVBORw0KGgo=" });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().layout).toBe("A card with a title and a button.");
    expect(a.json.calls.map((c) => c.purpose).indexOf("artifact.vision")).toBeLessThan(a.json.calls.map((c) => c.purpose).indexOf("artifact.generate"));
    expect((await call("alice", "POST", url, { request: "ab" })).statusCode).toBe(400);
    expect((await call("alice", "POST", url, {})).statusCode).toBe(400);
  });

  it("is the project's owner's: another person's project, or none, is 404; with no Code bot or no brain it says which is off", async () => {
    const { a, call } = await codeRig();
    const url = `/v1/code/projects/${a.project.id}/artifacts/component`;
    expect((await call("bob", "POST", url, { request: "a card" })).statusCode).toBe(404);
    expect((await call(null, "POST", url, { request: "a card" })).statusCode).toBe(401);
    expect((await call("alice", "POST", "/v1/code/projects/00000000-0000-4000-8000-000000000000/artifacts/component", { request: "a card" })).statusCode).toBe(404);
    const r = rig();
    const noCode = await served(r);
    expect((await noCode.call("alice", "POST", url, { request: "a card" })).json()).toMatchObject({ code: "code_off" });
    const app = Fastify();
    registerArtifactRoutes(app, { guard: new Guard(), rateLimit: RL, artifacts: { service: r.service }, code: { ...a.code, brain: null } as never });
    await app.ready();
    const res = await app.inject({ method: "POST", url, headers: who("alice"), payload: { request: "a card" } });
    expect(res.json()).toMatchObject({ code: "brain_off" });
  });

  it("builds it: 201 with the job on a new branch, the spec, and where it goes", async () => {
    const { a, call, service } = await codeRig();
    const made = (await call("alice", "POST", "/v1/artifacts", { type: "react", title: "Slug helper card", content: `export default function C() { return <button>Copy slug</button>; }`, projectId: a.project.id })).json();
    const res = await call("alice", "POST", `/v1/artifacts/${made.artifact.id}/build`, { projectId: a.project.id });
    expect(res.statusCode).toBe(201);
    const j = res.json();
    expect(j.job).toMatchObject({ id: expect.any(String), branch: expect.stringMatching(/^tailzu\/build-slug-helper-card-/) });
    expect(j.spec).toMatchObject({ artifactId: made.artifact.id, version: 1, type: "react", title: "Slug helper card" });
    expect(j.located.targets.length).toBeGreaterThan(0);
    const s = await a.stateNow(j.job.id);
    expect(s.spec!.content).toContain("Copy slug");
    // the version they approved is the one named, not the head
    await service.update("alice", made.artifact.id, [{ old: "Copy slug", new: "Copy" }]);
    const v1 = await call("alice", "POST", `/v1/artifacts/${made.artifact.id}/build`, { projectId: a.project.id, version: 1 });
    expect((await a.stateNow(v1.json().job.id)).spec!.content).toContain("Copy slug");
    const head = await call("alice", "POST", `/v1/artifacts/${made.artifact.id}/build`, { projectId: a.project.id });
    expect((await a.stateNow(head.json().job.id)).spec).toMatchObject({ version: 2 });
  });

  it("is the artifact's and the project's owner's, and asks for what it needs", async () => {
    const { a, call } = await codeRig();
    const made = (await call("alice", "POST", "/v1/artifacts", { type: "html", title: "H", content: "<p>x</p>" })).json();
    const url = `/v1/artifacts/${made.artifact.id}/build`;
    expect((await call("bob", "POST", url, { projectId: a.project.id })).statusCode).toBe(404);
    expect((await call("alice", "POST", url, {})).statusCode).toBe(400);
    expect((await call("alice", "POST", url, { projectId: "nope" })).statusCode).toBe(400);
    expect((await call("alice", "POST", url, { projectId: a.project.id, version: "1" })).statusCode).toBe(400);
    expect((await call("alice", "POST", url, { projectId: a.project.id, version: 7 })).statusCode).toBe(404);
    expect((await call("alice", "POST", url, { projectId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(404);
    // no agent loop on this server
    const r = rig();
    const app = Fastify();
    registerArtifactRoutes(app, { guard: new Guard(), rateLimit: RL, artifacts: { service: r.service }, code: { ...a.code, brain: { open: async () => a.fixture.brain, runtime: {} } } as never, jobs: a.jobs, agent: null });
    await app.ready();
    const id = (await app.inject({ method: "POST", url: "/v1/artifacts", headers: who("alice"), payload: { type: "html", title: "H", content: "<p>x</p>" } })).json().artifact.id;
    expect((await app.inject({ method: "POST", url: `/v1/artifacts/${id}/build`, headers: who("alice"), payload: { projectId: a.project.id } })).json()).toMatchObject({ code: "agent_off" });
  });
});
