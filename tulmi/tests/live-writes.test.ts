/**
 * Live updates, the publishing side: which topics a write changes and which a screen hears (live/topics.ts), the hook that
 * publishes a 2xx write after its response, bursts folded into one event, the Code bot's jobs saying so as they move, and the
 * topics a Bots app screen carries.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { LiveBus, type LiveEvent } from "../src/live/bus.js";
import { botTopic, jobTopic, joinTopics, noteTopic, topicsForScreen, topicsForWrite } from "../src/live/topics.js";
import { installLiveWrites, liveJobStore, LiveThrottle } from "../src/live/writes.js";
import { MemoryJobStore } from "../src/code/jobs/store.js";
import { buildBotsScreen } from "../src/experience/bots/index.js";
import { fakeDeps, IST } from "../src/experience/bots/fixtures.js";

process.env.OPENROUTER_API_KEY ??= "k";
process.env.OPENAI_API_KEY ??= "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

afterEach(() => { vi.useRealTimers(); });

describe("topicsForWrite", () => {
  it("names what each write changes, by its route pattern", () => {
    expect(topicsForWrite("PUT", "/v1/keybot/prefs")).toEqual(["keybot"]);
    expect(topicsForWrite("POST", "/v1/words")).toEqual(["keybot"]);
    expect(topicsForWrite("POST", "/v1/shell/ask")).toEqual(["activity", "home"]);
    expect(topicsForWrite("PUT", "/v1/you/settings")).toEqual(["you"]);
    expect(topicsForWrite("PUT", "/v1/profile")).toEqual(["you"]);
    expect(topicsForWrite("PUT", "/v1/personality")).toEqual(["you", "keybot"]);
    expect(topicsForWrite("DELETE", "/v1/history/:id", { id: "h1" })).toEqual(["keybot", "activity"]);
    expect(topicsForWrite("POST", "/v1/code/jobs/:id/answer", { id: "j-1" })).toEqual(["job:j-1", "code", "home", "activity"]);
    expect(topicsForWrite("POST", "/v1/code/jobs")).toEqual(["code", "home", "activity"]);
    expect(topicsForWrite("POST", "/v1/bots/code/jobs/:id/replan", { id: "j-2" })).toEqual(["code", "home", "job:j-2"]);
    expect(topicsForWrite("POST", "/v1/bots/code/start")).toEqual(["code", "home"]);
    expect(topicsForWrite("PATCH", "/v1/bots/:slug", { slug: "Chai" })).toEqual(["bot:chai", "bots", "home"]);
    expect(topicsForWrite("DELETE", "/v1/bots/:slug/memory/:factId", { slug: "chai", factId: "f" })).toEqual(["bot:chai"]);
    expect(topicsForWrite("POST", "/v1/botsapp/bots/chat/:slug", { slug: "plan" })).toEqual(["activity", "home", "bot:plan"]);
    expect(topicsForWrite("POST", "/v1/botsapp/bots/trip/:id/packing", { id: "t" })).toEqual(["bot:travel", "home"]);
    expect(topicsForWrite("POST", "/v1/botsapp/bots/plan/move")).toEqual(["bot:plan", "home"]);
    expect(topicsForWrite("POST", "/v1/tasks/:id/approve", { id: "t" })).toEqual(["tasks", "activity", "home"]);
    expect(topicsForWrite("PUT", "/v1/bots/first-run/arrival")).toEqual(["home"]);
  });

  it("names nothing for a read, a runner's heartbeat, Spaces (they publish their own) or a write nobody else sees", () => {
    expect(topicsForWrite("GET", "/v1/keybot/prefs")).toEqual([]);
    expect(topicsForWrite("POST", "/v1/code/runner/heartbeat")).toEqual([]);
    expect(topicsForWrite("POST", "/v1/code/github/webhook")).toEqual([]);
    expect(topicsForWrite("POST", "/v1/botsapp/bots/spaces")).toEqual([]);
    expect(topicsForWrite("POST", "/v1/botsapp/bots/spaces/:id/invite", { id: "s" })).toEqual([]);
    expect(topicsForWrite("POST", "/v1/app/screen")).toEqual([]);
    expect(topicsForWrite("POST", "/v1/botsapp/bots/draft")).toEqual([]);
    expect(topicsForWrite("POST", "/v1/transcribe-clean")).toEqual([]);
  });

  it("never puts a strange id in a topic", () => {
    expect(jobTopic("a b")).toBe("");
    expect(botTopic("x:y")).toBe("");
    expect(noteTopic("../n")).toBe("");
    expect(topicsForWrite("POST", "/v1/code/jobs/:id/answer", { id: "has space" })).toEqual(["code", "home", "activity"]);
  });
});

describe("topicsForScreen", () => {
  it("gives each screen the topics the writes above publish", () => {
    expect(topicsForScreen("bots.home")).toEqual(["home", "bots"]);
    expect(topicsForScreen("bots.activity")).toEqual(["activity"]);
    expect(topicsForScreen("bots.keybot")).toEqual(["keybot"]);
    expect(topicsForScreen("bots.keybot.history")).toEqual(["keybot"]);
    expect(topicsForScreen("bots.you")).toEqual(["you"]);
    expect(topicsForScreen("bots.code")).toEqual(["code"]);
    expect(topicsForScreen("bots.code.job", { id: "j-1" })).toEqual(["job:j-1"]);
    expect(topicsForScreen("bots.code.job", {})).toEqual(["code"]);
    expect(topicsForScreen("bots.note", { id: "n-1" })).toEqual(["note:n-1"]);
    expect(topicsForScreen("bots.notes")).toEqual(["notes"]);
    expect(topicsForScreen("bots.bot", { slug: "chai" })).toEqual(["bots", "bot:chai"]);
    expect(topicsForScreen("bots.plan")).toEqual(["bot:plan", "calendar", "tasks"]);
  });

  it("gives none to a live session, a training run or a flow in progress", () => {
    for (const id of ["bots.keybot.live", "bots.keybot.train", "bots.ask", "bots.approve", "bots.welcome", "bots.sign-in"]) {
      expect(topicsForScreen(id)).toEqual([]);
    }
  });

  it("joins a screen's own topics with its defaults, each once", () => {
    expect(joinTopics(["home", "bots"], ["bots", "space:1", ""])).toEqual(["home", "bots", "space:1"]);
    expect(joinTopics(undefined, undefined)).toEqual([]);
  });

  it("puts them on the Bots app's ScreenResponse", async () => {
    const req = (screenId: string, params: Record<string, unknown> = {}) => ({
      screenId, params, client: "phone" as const, tzOffsetMinutes: IST, user: { id: "u" }, can: new Set(["BotsKit"]),
      desk: { pages: false, notes: false },
    });
    const home = await buildBotsScreen(req("bots.home"), fakeDeps());
    // A phone's Home has the Notes tile (screens/notes.ts), whose line follows the meetings: it listens to "notes" too.
    expect(home.liveTopics).toEqual(["home", "bots", "notes"]);
    const sign = await buildBotsScreen(req("bots.welcome"), fakeDeps());
    expect(sign.liveTopics).toBeUndefined();
  });
});

describe("the write hook", () => {
  async function app(status = 200) {
    const published: Array<[string, string[]]> = [];
    const f = Fastify();
    installLiveWrites(f, { publish: (u, t) => published.push([u, t]), userOf: async (r) => (r.headers.authorization === "Bearer a" ? "user-a" : null) });
    f.put("/v1/keybot/prefs", async (_req, reply) => reply.code(status).send({ ok: status < 300 }));
    f.get("/v1/keybot/prefs", async () => ({ ok: true }));
    f.post<{ Params: { id: string } }>("/v1/code/jobs/:id/answer", async () => ({ ok: true }));
    f.post("/v1/app/screen", async () => ({ ok: true }));
    await f.ready();
    return { f, published };
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("publishes a successful write's topics for the person who made it", async () => {
    const { f, published } = await app();
    await f.inject({ method: "PUT", url: "/v1/keybot/prefs", headers: { authorization: "Bearer a" } });
    await f.inject({ method: "POST", url: "/v1/code/jobs/j-9/answer", headers: { authorization: "Bearer a" } });
    await settle();
    expect(published).toEqual([["user-a", ["keybot"]], ["user-a", ["job:j-9", "code", "home", "activity"]]]);
    await f.close();
  });

  it("publishes nothing for a read, a refused write, a route not in the table, or no session", async () => {
    const refused = await app(403);
    await refused.f.inject({ method: "PUT", url: "/v1/keybot/prefs", headers: { authorization: "Bearer a" } });
    const { f, published } = await app();
    await f.inject({ method: "GET", url: "/v1/keybot/prefs", headers: { authorization: "Bearer a" } });
    await f.inject({ method: "POST", url: "/v1/app/screen", headers: { authorization: "Bearer a" } });
    await f.inject({ method: "PUT", url: "/v1/keybot/prefs", headers: { authorization: "Bearer someone" } });
    await settle();
    expect(refused.published).toEqual([]);
    expect(published).toEqual([]);
    await f.close();
    await refused.f.close();
  });
});

describe("a burst is one event", () => {
  it("sends the first at once and folds the rest of the burst into one at its end, per person and topic", () => {
    vi.useFakeTimers();
    const bus = new LiveBus();
    const heard: Array<[string, string]> = [];
    bus.subscribe("a", (e) => heard.push(["a", e.topic]));
    bus.subscribe("b", (e) => heard.push(["b", e.topic]));
    const t = new LiveThrottle(bus, () => 1000, () => Date.now());
    t.publish("a", ["home", "home", "activity"]);
    t.publish("b", ["home"]);
    expect(heard).toEqual([["a", "home"], ["a", "activity"], ["b", "home"]]);
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(100); t.publish("a", ["home"]); }
    expect(heard.length).toBe(3);
    vi.advanceTimersByTime(600);
    expect(heard).toEqual([["a", "home"], ["a", "activity"], ["b", "home"], ["a", "home"]]);
    vi.advanceTimersByTime(5000);
    expect(heard.length).toBe(4);
    // A quiet spell later, the next one goes at once again.
    t.publish("a", ["home"]);
    expect(heard.length).toBe(5);
    t.clear();
  });
});

describe("the Code bot's jobs", () => {
  const newJob = { userId: "user-a", projectId: "p", branch: "b", task: "Fix the login", budgetPaise: 0 };

  it("say so when they are made, change in a way a screen shows, or a step moves; lease bookkeeping stays quiet", async () => {
    const told: Array<[string, string]> = [];
    const store = liveJobStore(new MemoryJobStore(), (u, j) => told.push([u, j]));
    const job = await store.createJob(newJob);
    expect(told).toEqual([["user-a", job.id]]);
    await store.casJob(job.id, {}, { leaseExpiresAt: Date.now() + 60_000, leaseHolder: "pc-1" });
    expect(told.length).toBe(1);
    const moved = await store.casJob(job.id, {}, { state: "running" });
    expect(moved?.state).toBe("running");
    expect(told.length).toBe(2);
    await store.addStep(job.id, { kind: "exec", commands: ["npm test"], timeoutSec: 60, estimateMinutes: 1, status: "queued" } as never);
    expect(told.length).toBe(3);
    // The store's own answers are unchanged, and reads say nothing.
    expect((await store.getJob("user-a", job.id))?.state).toBe("running");
    expect((await store.listJobs("user-a", 10)).length).toBe(1);
    expect(told.length).toBe(3);
    expect(store instanceof MemoryJobStore).toBe(true);
  });

  it("learns whose a job is from the store when a step moves on a job it has not seen", async () => {
    const told: Array<[string, string]> = [];
    const inner = new MemoryJobStore();
    const job = await inner.createJob(newJob);
    const store = liveJobStore(inner, (u, j) => told.push([u, j]));
    await store.addStep(job.id, { kind: "exec", commands: ["ls"], timeoutSec: 60, estimateMinutes: 1, status: "queued" } as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(told).toEqual([["user-a", job.id]]);
  });
});

describe("a note", () => {
  it("says so as it is made, grows and goes", async () => {
    const bus = (await import("../src/live/bus.js")).live;
    const heard: LiveEvent[] = [];
    const stop = bus.subscribe("note-person", (e) => heard.push(e));
    const { createNote, updateNote, deleteNote } = await import("../src/notes/store.js");
    const user = { id: "note-person" };
    const n = await createNote(user);
    expect(heard.map((e) => e.topic)).toEqual(["notes", `note:${n.id}`]);
    await new Promise((r) => setTimeout(r, 1100));
    await updateNote(user, n.id, (x) => ({ ...x, words: 3 }));
    expect(heard.map((e) => e.topic).slice(2)).toEqual(["notes", `note:${n.id}`]);
    await new Promise((r) => setTimeout(r, 1100));
    await deleteNote(user, n.id);
    expect(heard.length).toBe(6);
    stop();
  });
});
