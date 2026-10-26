/**
 * THE FOUR DOORS (src/routes/code.ts): POST /v1/code/projects/:id/{locate,resources,audit,intake}.
 *
 * Thin: they check the session, that the project is the caller's and that the brain is on, shape the body, and call
 * code/work, code/resources and code/newproject. The rig is the project brain's (tests/project-rig.ts: a fake GitHub
 * serving Acme Shop, a fake model, in-memory stores); the model door and the registries' fetch are swapped for the
 * work fixtures' where a test needs a particular answer. Nothing reaches a network.
 *
 * What these hold down:
 *   - off while the brain is off (404 brain_off, before the session), 401 with no session, 404 for someone else's
 *     project, 400 for a body that is not what was asked for, 409 when the project has never been read;
 *   - locate: the answer, no model call when the words are enough, and the cheap tier under a cap when they are not;
 *   - resources and audit: the registry and OSV through the injected fetch, a private repo taken for closed source,
 *     the lockfile read from the repo itself;
 *   - intake: questions first, the spec and the plan once nothing is left, kept between calls, a plain spec when the
 *     model is down, and the milestones with their branch names.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

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

noNetwork();

const { projectRig, KEYS } = await import("./project-rig.js");
const { acmeFiles } = await import("./project-repo.js");
const { fakeCall, fakeWorld, osvRecord } = await import("./work-fixtures.js");
const { registerCodeRoutes } = await import("../src/routes/code.js");
const { createCode } = await import("../src/code/index.js");

type Rig = Awaited<ReturnType<typeof projectRig>>;

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const SECRET = "whsec_" + "k".repeat(40);
const who = (user: string) => ({ authorization: `Bearer ${user}` });
const DOORS = ["locate", "resources", "audit", "intake"] as const;
/** A body each door accepts. */
const GOOD: Record<(typeof DOORS)[number], object> = {
  locate: { task: "fix the label on the signup button" }, resources: { need: "schema validation" }, audit: {}, intake: { request: "I want an app" },
};

async function served(r: Rig, code = r.code) {
  const app = Fastify();
  registerCodeRoutes(app, { rateLimit: RL, code });
  await app.ready();
  const post = (user: string | null, project: string, door: string, payload?: unknown) =>
    app.inject({ method: "POST", url: `/v1/code/projects/${project}/${door}`, ...(user ? { headers: who(user) } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { app, post };
}

/** The rig's project with its brain built and the routes up. */
async function ready(o: Parameters<typeof projectRig>[0] = {}) {
  const r = await projectRig(o);
  await r.brain.build("alice", r.projectId, { mode: "full" });
  const s = await served(r);
  return { r, ...s };
}

/** Work-purpose calls the brain's model door has been asked for (the build's own are brain.*). */
const workCalls = (r: Rig) => r.model.calls.filter((c) => c.purpose.startsWith("work."));

// ---------------------------------------------------------------- the doors

describe("the four doors: who may knock", () => {
  it("answer 404 brain_off while the brain is off, before the session is looked at", async () => {
    const r = await projectRig();
    const off = createCode({
      store: r.store, app: { slug: "s", clientId: r.fake.appClientId, clientSecret: r.fake.clientSecret, privateKey: KEYS.privateKeyPem }, oauth: null, webhookSecret: SECRET,
      fetchFn: r.gh.fetchFn, now: () => r.fake.clock.t, brain: false,
    });
    const { app, post } = await served(r, off);
    for (const door of DOORS) for (const user of [null, "alice"]) {
      const res = await post(user, r.projectId, door, GOOD[door]);
      expect([door, res.statusCode, res.json().code]).toEqual([door, 404, "brain_off"]);
    }
    await app.close();
  });

  it("answer 401 with no session", async () => {
    const { r, post, app } = await ready();
    for (const door of DOORS) {
      const res = await post(null, r.projectId, door, GOOD[door]);
      expect([door, res.statusCode, res.json().code]).toEqual([door, 401, "unauthorized"]);
    }
    expect(workCalls(r)).toEqual([]);
    await app.close();
  });

  it("answer 404 for a project that is someone else's, or is not a project, and do nothing", async () => {
    const { r, post, app } = await ready();
    const before = r.model.calls.length;
    for (const door of DOORS) {
      for (const id of [r.projectId, "00000000-0000-4000-8000-000000000000", "nope"]) {
        const res = await post("bob", id, door, GOOD[door]);
        expect([door, id === r.projectId ? "theirs" : id, res.statusCode, res.json().code]).toEqual([door, id === r.projectId ? "theirs" : id, 404, "not_found"]);
      }
    }
    expect(r.model.calls.length).toBe(before);
    await app.close();
  });

  it("answer 409 brain_not_ready for locate and audit on a project that has never been read, and nothing is charged", async () => {
    const r = await projectRig();
    const { post, app } = await served(r);
    for (const door of ["locate", "audit"] as const) {
      const res = await post("alice", r.projectId, door, GOOD[door]);
      expect([door, res.statusCode, res.json().code]).toEqual([door, 409, "brain_not_ready"]);
    }
    expect(r.model.calls).toEqual([]);
    await app.close();
  });
});

describe("the four doors: the body", () => {
  it("locate wants a task of 3 to 4,000 characters", async () => {
    const { r, post, app } = await ready();
    for (const body of [undefined, {}, { task: "" }, { task: "  " }, { task: "ab" }, { task: 5 }, { task: ["x"] }, { task: "x".repeat(4001) }, []]) {
      const res = await post("alice", r.projectId, "locate", body);
      expect([JSON.stringify(body)?.slice(0, 20), res.statusCode, res.json().code]).toEqual([JSON.stringify(body)?.slice(0, 20), 400, "bad_request"]);
    }
    expect((await post("alice", r.projectId, "locate", { task: "x".repeat(4000) })).statusCode).toBe(200);
    await app.close();
  });

  it("resources wants a need of 3 to 300 characters", async () => {
    const { r, post, app } = await ready();
    for (const body of [undefined, {}, { need: "" }, { need: "hi" }, { need: 5 }, { need: "x".repeat(301) }]) {
      const res = await post("alice", r.projectId, "resources", body);
      expect([JSON.stringify(body), res.statusCode, res.json().code]).toEqual([JSON.stringify(body), 400, "bad_request"]);
    }
    await app.close();
  });

  it("intake wants text for request, reply and the answers, and true or false for proceed", async () => {
    const { r, post, app } = await ready();
    const bad = [
      { request: 5 }, { request: "" }, { request: "x".repeat(4001) }, { reply: 5 }, { reply: "x".repeat(1501) }, { answers: "web" }, { answers: [] }, { answers: { what: 5 } },
      { answers: { what: "x".repeat(1501) } }, { answers: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"])) }, { proceed: "yes" },
    ];
    for (const body of bad) {
      const res = await post("alice", r.projectId, "intake", body);
      expect([JSON.stringify(body).slice(0, 40), res.statusCode, res.json().code]).toEqual([JSON.stringify(body).slice(0, 40), 400, "bad_request"]);
    }
    await app.close();
  });
});

// ------------------------------------------------------------------ locate

describe("POST /v1/code/projects/:id/locate", () => {
  it("answers with the file a path in the words names, and asks no model", async () => {
    const { r, post, app } = await ready();
    const res = await post("alice", r.projectId, "locate", { task: "fetchUsers in src/lib/api.ts returns the wrong thing" });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.targets[0]).toMatchObject({ path: "src/lib/api.ts" });
    expect(out.confidence).toBeGreaterThan(0.75);
    expect(out.question).toBeUndefined();
    expect(Array.isArray(out.related)).toBe(true);
    expect(out.tests).toContain("src/lib/api.test.ts");
    expect(workCalls(r)).toEqual([]);
    await app.close();
  });

  it("when the words are not enough it asks the cheap tier, under a cap, as the person, and a crisp question if still unsure", async () => {
    const { r, post, app } = await ready();
    const fc = fakeCall();
    fc.on("work.locate.expand", { terms: [] }).on("work.locate.pick", { picks: [], sure: false });
    r.brain.runtime.call = fc.call;
    const res = await post("alice", r.projectId, "locate", { task: "make it nicer" });
    expect(res.statusCode).toBe(200);
    expect(res.json().confidence).toBeLessThan(0.45);
    expect(res.json().question).toBeTruthy();
    expect(fc.calls.length).toBeGreaterThan(0);
    for (const c of fc.calls) {
      expect(c.tier).toBe("cheap");
      expect(c.userId).toBe("alice");
      expect(c.budget).toEqual({ maxPaise: 100 });
    }
    await app.close();
  });

  it("is a plain answer, not an error, when the model is down", async () => {
    const { r, post, app } = await ready();
    const fc = fakeCall();
    fc.down = true;
    r.brain.runtime.call = fc.call;
    const res = await post("alice", r.projectId, "locate", { task: "make it nicer" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ targets: expect.any(Array), confidence: expect.any(Number) });
    await app.close();
  });

  it("never sends a secret in the words to the model", async () => {
    const { r, post, app } = await ready();
    const fc = fakeCall();
    fc.on("work.locate.expand", { terms: ["login"] }).on("work.locate.pick", { picks: [], sure: false });
    r.brain.runtime.call = fc.call;
    const key = ["gh", "p_"].join("") + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const res = await post("alice", r.projectId, "locate", { task: `the checkout fails when I use ${key} in the form` });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain(key);
    expect(fc.calls.map((c) => c.sent).join("\n")).not.toContain(key);
    await app.close();
  });
});

// --------------------------------------------------------------- resources

describe("POST /v1/code/projects/:id/resources", () => {
  const world = () => {
    const w = fakeWorld();
    w.npm.set("tiny-validate", { version: "2.1.0", license: "MIT", description: "Tiny schema validation", date: "2026-10-01T00:00:00.000Z", weekly: 900_000, tags: ["validation", "schema"], repo: "https://github.com/acme-oss/tiny-validate" });
    w.npm.set("gpl-validate", { version: "1.0.0", license: "GPL-3.0-only", description: "Schema validation", date: "2026-10-01T00:00:00.000Z", weekly: 800_000, tags: ["validation", "schema"], repo: "https://github.com/acme-oss/gpl-validate" });
    w.github.set("acme-oss/tiny-validate", { stars: 9000, issues: 12, pushed: "2026-10-10T00:00:00Z", spdx: "MIT" });
    w.github.set("acme-oss/gpl-validate", { stars: 7000, issues: 12, pushed: "2026-10-10T00:00:00Z", spdx: "GPL-3.0" });
    return w;
  };

  it("ranks what the registry has, through the fetch the brain was given, with the licence judged for this repo", async () => {
    const { r, post, app } = await ready();
    const w = world();
    r.brain.runtime.fetchFn = w.fetch as never;
    const res = await post("alice", r.projectId, "resources", { need: "schema validation" });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out).toMatchObject({ need: "schema validation", ecosystem: "npm" });
    const names = out.candidates.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(["tiny-validate", "gpl-validate"]));
    expect(out.pick).toBe("tiny-validate");
    // the repo is private, so it is taken for closed source
    expect(r.project.private).toBe(true);
    const gpl = out.candidates.find((c: { name: string }) => c.name === "gpl-validate");
    expect(gpl.licence).toMatchObject({ level: "strong_warn" });
    expect(w.urls("registry.npmjs.org").length).toBeGreaterThan(0);
    // the registry is read with rules; no model is asked
    expect(workCalls(r)).toEqual([]);
    await app.close();
  });

  it("works for a project whose brain was never built: it only reads the registry", async () => {
    const r = await projectRig();
    r.brain.runtime.fetchFn = world().fetch as never;
    const { post, app } = await served(r);
    const res = await post("alice", r.projectId, "resources", { need: "schema validation" });
    expect(res.statusCode).toBe(200);
    expect(res.json().candidates.length).toBeGreaterThan(0);
    await app.close();
  });
});

// -------------------------------------------------------------------- audit

describe("POST /v1/code/projects/:id/audit", () => {
  const LOCK = JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "acme" }, "node_modules/lodash": { version: "4.17.15" }, "node_modules/express": { version: "4.19.2" } } });

  it("reads the lockfile from the repo itself and asks OSV for what is in it", async () => {
    const { r, post, app } = await ready({ files: { ...acmeFiles(), "package-lock.json": LOCK } });
    const w = fakeWorld();
    w.osv.set("npm:lodash@4.17.15", [osvRecord({ id: "GHSA-lodash-1", pkg: "lodash", ecosystem: "npm", severity: "HIGH", fixed: ["4.17.21"] })]);
    r.brain.runtime.fetchFn = w.fetch as never;
    const res = await post("alice", r.projectId, "audit");
    expect(res.statusCode).toBe(200);
    const out = res.json();
    // npm from the lockfile; the Python side has no lockfile, so it is read from requirements.txt at its minimum versions
    expect(out).toMatchObject({ source: "package-lock.json and manifests", approximate: true, checked: true, scanned: 4 });
    expect(out.notes).toEqual(expect.arrayContaining(["manifest:approximate", "pnpm-lock.yaml:empty"]));
    expect(out.vulnerable.map((v: { name: string; version: string; severity: string; fixedIn: string }) => [v.name, v.version, v.severity, v.fixedIn])).toEqual([["lodash", "4.17.15", "high", "4.17.21"]]);
    expect(out.counts).toMatchObject({ high: 1, critical: 0 });
    expect(w.calls.filter((c) => c.url.endsWith("/querybatch"))).toHaveLength(1);
    expect(workCalls(r)).toEqual([]);
    await app.close();
  });

  it("falls back to the manifests, and says it is approximate, when the lockfile has nothing in it", async () => {
    const { r, post, app } = await ready();
    const w = fakeWorld();
    r.brain.runtime.fetchFn = w.fetch as never;
    const res = await post("alice", r.projectId, "audit");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ approximate: true, checked: true });
    expect(res.json().notes).toContain("manifest:approximate");
    await app.close();
  });

  it("says it did not check, rather than that nothing is wrong, when OSV cannot be reached", async () => {
    const { r, post, app } = await ready({ files: { ...acmeFiles(), "package-lock.json": LOCK } });
    const w = fakeWorld();
    w.down.add("api.osv.dev");
    r.brain.runtime.fetchFn = w.fetch as never;
    const res = await post("alice", r.projectId, "audit");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ checked: false, vulnerable: [] });
    await app.close();
  });
});

// ------------------------------------------------------------------- intake

describe("POST /v1/code/projects/:id/intake", () => {
  const FULL = "I want a booking site for yoga studios, with login and payments, hosted on Vercel, something like Calendly.";
  const SPEC = {
    name: "Yoga Book", summary: "A booking site for yoga studios.", users: ["studio owners"], platforms: ["web"],
    features: [{ name: "Book a class", description: "Pick a class and a time.", priority: "must" }, { name: "Pay", description: "Pay by card.", priority: "must" }],
    nonGoals: ["Mobile apps"], dataModel: [{ entity: "Class", fields: ["title"] }], screens: [{ name: "Schedule", purpose: "See the classes." }], endpoints: [],
    risks: [], assumptions: ["One studio to start."],
    needs: { auth: true, database: true, payments: true, seo: true, realtime: false, files: false, ai: false },
  };

  it("asks the five questions of a vague first message, and says what the repo is", async () => {
    const { r, post, app } = await ready();
    const res = await post("alice", r.projectId, "intake", { request: "I want an app" });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.state).toBe("asking");
    expect(out.questions.map((q: { id: string }) => q.id)).toEqual(["what", "platforms", "features", "constraints", "examples"]);
    expect(out.answered).toEqual([]);
    // Acme Shop has code in it
    expect(out.repo).toMatchObject({ empty: false });
    expect(out.spec).toBeUndefined();
    expect(workCalls(r)).toEqual([]);
    await app.close();
  });

  it("asks nothing the first message answers, and goes on to the spec, the stack, the plan and the milestones", async () => {
    const { r, post, app } = await ready();
    const fc = fakeCall();
    fc.on("work.spec", SPEC);
    r.brain.runtime.call = fc.call;
    const res = await post("alice", r.projectId, "intake", { request: FULL });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out).toMatchObject({ state: "done", degraded: false, spec: { name: "Yoga Book", source: "model" } });
    expect(out.stack.kind).toBe("next");
    expect(out.plan).toContain("# Yoga Book: plan");
    expect(out.milestones[0]).toEqual({ k: 0, title: "Scaffold, CI and preview", branch: "tailzu/m0-scaffold-ci-and-preview" });
    expect(out.milestones.at(-1).title).toBe("Launch readiness");
    for (const m of out.milestones) expect(m.branch).toMatch(/^tailzu\/m\d+-[a-z0-9-]+$/);
    // one call, on the strong tier, under the spec cap, as the person
    expect(fc.calls).toHaveLength(1);
    expect(fc.calls[0]).toMatchObject({ purpose: "work.spec", tier: "strong", userId: "alice", budget: { maxPaise: 800 } });
    await app.close();
  });

  it("answers by question id, or in a free-text reply to the first open question, and 'proceed' lets Tailzu decide the rest", async () => {
    const { r, post, app } = await ready();
    const fc = fakeCall();
    fc.on("work.spec", SPEC);
    r.brain.runtime.call = fc.call;
    const first = await post("alice", r.projectId, "intake", { request: "I want an app" });
    expect(first.json().state).toBe("asking");
    const second = await post("alice", r.projectId, "intake", { reply: "A booking site for yoga studios, for studio owners" });
    expect(second.json().state).toBe("asking");
    expect(second.json().answered).toContain("what");
    expect(second.json().questions[0].id).not.toBe("what");
    const third = await post("alice", r.projectId, "intake", { answers: { platforms: "web", features: "book and pay" } });
    expect(third.json().answered).toEqual(expect.arrayContaining(["what", "platforms", "features"]));
    const done = await post("alice", r.projectId, "intake", { proceed: true });
    expect(done.statusCode).toBe(200);
    expect(done.json().state).toBe("done");
    expect(fc.calls).toHaveLength(1);
    await app.close();
  });

  it("returns the same spec, with no new model call, when nothing new is said, and a new one when something is", async () => {
    const { r, post, app } = await ready();
    const fc = fakeCall();
    fc.on("work.spec", SPEC);
    r.brain.runtime.call = fc.call;
    const a = await post("alice", r.projectId, "intake", { request: FULL });
    const b = await post("alice", r.projectId, "intake", {});
    expect(b.json()).toMatchObject({ state: "done", spec: a.json().spec, plan: a.json().plan });
    expect(fc.calls).toHaveLength(1);
    await post("alice", r.projectId, "intake", { answers: { constraints: "use Expo for mobile too" } });
    expect(fc.calls).toHaveLength(2);
    await app.close();
  });

  it("is a plain spec from the answers, marked degraded, when the model is down", async () => {
    const { r, post, app } = await ready();
    const fc = fakeCall();
    fc.down = true;
    r.brain.runtime.call = fc.call;
    const res = await post("alice", r.projectId, "intake", { request: FULL });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: "done", degraded: true, spec: { source: "rules" } });
    expect(res.json().plan).toContain("from your answers alone");
    expect(res.json().milestones.length).toBeGreaterThan(1);
    await app.close();
  });

  it("keeps a secret in the words out of the plan and the model's prompt", async () => {
    const { r, post, app } = await ready();
    const fc = fakeCall();
    fc.on("work.spec", SPEC);
    r.brain.runtime.call = fc.call;
    const key = ["gh", "p_"].join("") + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const res = await post("alice", r.projectId, "intake", { request: `${FULL} My stripe key is ${key}` });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain(key);
    expect(fc.calls.map((c) => c.sent).join("\n")).not.toContain(key);
    await app.close();
  });

  it("says the repo is empty when it is", async () => {
    const { r, post, app } = await ready({ files: { "README.md": "# new\n" } });
    const res = await post("alice", r.projectId, "intake", { request: "I want an app" });
    expect(res.json().repo).toMatchObject({ empty: true, reason: "only_boilerplate" });
    await app.close();
  });
});
