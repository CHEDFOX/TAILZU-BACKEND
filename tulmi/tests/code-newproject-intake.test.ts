/**
 * INTAKE (src/code/newproject/intake.ts, intakeStore.ts): at most five questions, and none the person's own words already
 * answer; the state kept per project, in memory and in Supabase; and, once nothing is left to ask, the spec, the stack and
 * PLAN.md.
 *
 * What these hold down:
 *   - which question a message answers, read with rules and no model: where it runs, what it is and who for, the features,
 *     the limits (a budget, hosting, a stack), the examples; a product with no audience gets only "Who is it for?";
 *   - the state machine: the first message, answers by id, a free-text reply to the first open question, "just start",
 *     "skip" kept as what it means, secrets not kept, a store that fails costing nothing;
 *   - on to the spec when nothing is left, kept with the project, returned as it was when nothing new is said, rebuilt when
 *     something is, and a plain spec when no model can be had.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { fakeCall, fakeSupabase } = await import("./work-fixtures.js");
const { answeredBy, nextQuestions, cleanAnswer, stepIntake, advanceIntake, QUESTIONS } = await import("../src/code/newproject/intake.js");
const { MemoryIntakeStore, SupabaseIntakeStore } = await import("../src/code/newproject/intakeStore.js");
type IntakeStore = import("../src/code/newproject/intakeStore.js").IntakeStore;

const PROJECT = "7d444840-9dc0-4f6a-a8b1-1f2b8d5a8c01";
const USER = "0b3f6a52-6d0e-4c4e-9f7d-2f7a3c1e5b11";

const FULL = "I want a booking site for yoga studios, with login and payments, hosted on Vercel, something like Calendly.";

describe("which question a message already answers", () => {
  it("a message that says what it is, who for, where, the features, the limits and a reference answers all five", () => {
    expect([...answeredBy(FULL).answered].sort()).toEqual(["constraints", "examples", "features", "platforms", "what"]);
    expect(nextQuestions(FULL, {}).questions).toEqual([]);
  });

  it("'I want an app' answers nothing, and all five are asked, in order", () => {
    const q = nextQuestions("I want an app", {});
    expect(q.questions.map((x) => x.id)).toEqual(["what", "platforms", "features", "constraints", "examples"]);
    expect(q.answered).toEqual([]);
    expect(q.questions.map((x) => x.ask)).toEqual(Object.values(QUESTIONS).map((x) => x.ask));
  });

  it("at most five questions, and each is a sentence or two", () => {
    const q = nextQuestions("", {}).questions;
    expect(q.length).toBeLessThanOrEqual(5);
    for (const x of q) { expect(x.ask.length).toBeLessThan(160); expect(x.why.length).toBeGreaterThan(10); }
  });

  it("a product with no audience is asked only 'Who is it for?'", () => {
    const q = nextQuestions("I would like to build a task tracker for my own use soon", {});
    // "for my own" names an audience; take one that does not
    const bare = nextQuestions("I'd like to build a task tracker in the evenings", {});
    expect(bare.questions[0]).toMatchObject({ id: "what", ask: "Who is it for?" });
    expect(q.answered).toContain("what");
  });

  it("each platform word answers where it runs", () => {
    for (const t of ["a website for my shop", "an iPhone app for runners", "an Android app", "a desktop tool", "just an API for my data", "a browser extension that does x", "a web app"]) {
      expect(answeredBy(t).answered.has("platforms"), t).toBe(true);
    }
    expect(answeredBy("an app for runners").answered.has("platforms")).toBe(false);
  });

  it("features are named, listed, or cued", () => {
    expect(answeredBy("users can book and pay").answered.has("features")).toBe(true);
    expect(answeredBy("it needs login, search and notifications").answered.has("features")).toBe(true);
    expect(answeredBy("1. add tasks\n2. share lists").answered.has("features")).toBe(true);
    expect(answeredBy("a nice app for runners").answered.has("features")).toBe(false);
  });

  it("limits are a budget, hosting, or a stack", () => {
    for (const t of ["on a tiny budget", "I already have hosting on Netlify", "use Next.js and Supabase", "I know Python", "under ₹5000", "free tier only"]) {
      expect(answeredBy(t).answered.has("constraints"), t).toBe(true);
    }
    expect(answeredBy("a nice app for runners").answered.has("constraints")).toBe(false);
  });

  it("examples are a name, a link, or 'like X'", () => {
    for (const t of ["like Notion", "similar to Zomato", "inspired by https://example.com/app", "think Duolingo"]) expect(answeredBy(t).answered.has("examples"), t).toBe(true);
    expect(answeredBy("a nice app for runners").answered.has("examples")).toBe(false);
  });

  it("an answer given to a question stands, whatever it says, and the first message and the answers add up", () => {
    const q = nextQuestions("I'd like to build a task tracker in the evenings", { what: "for freelancers", platforms: "web", examples: "none" });
    expect(q.answered).toEqual(expect.arrayContaining(["what", "platforms", "examples"]));
    expect(q.questions.map((x) => x.id)).toEqual(["features", "constraints"]);
  });

  it("'skip' and 'you decide' are answers, kept as what they mean; a secret is not kept", () => {
    for (const t of ["skip", "No", "none", "you decide", "up to you.", "Not sure", "whatever"]) expect(cleanAnswer(t), t).toBe("(no preference: you decide)");
    expect(cleanAnswer("   ")).toBeNull();
    expect(cleanAnswer(5)).toBeNull();
    const key = ["gh", "p_"].join("") + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    expect(cleanAnswer(`my token is ${key}`)).toBe("my token is [redacted]");
  });
});

describe("stepIntake: the state machine", () => {
  it("the first message is kept and the questions are asked; asking again does not lose them", async () => {
    const store = new MemoryIntakeStore();
    const a = await stepIntake(USER, PROJECT, { request: "I want an app" }, { store });
    expect(a.state).toBe("asking");
    expect(a.questions).toHaveLength(5);
    const row = await store.get(PROJECT);
    expect(row).toMatchObject({ projectId: PROJECT, userId: USER, state: "asking", request: "I want an app", asked: ["what", "platforms", "features", "constraints", "examples"] });
    const again = await stepIntake(USER, PROJECT, {}, { store });
    expect(again.request).toBe("I want an app");
    expect(again.questions).toHaveLength(5);
  });

  it("answers by id remove their questions; an id that is not a question is ignored", async () => {
    const store = new MemoryIntakeStore();
    await stepIntake(USER, PROJECT, { request: "I want an app" }, { store });
    const b = await stepIntake(USER, PROJECT, { answers: { what: "a tracker for freelancers", platforms: "web", bogus: "x" } }, { store });
    expect(b.answered).toEqual(["what", "platforms"]);
    expect(b.questions.map((q) => q.id)).toEqual(["features", "constraints", "examples"]);
    expect((await store.get(PROJECT))!.answers).toEqual({ what: "a tracker for freelancers", platforms: "web" });
  });

  it("a free-text reply is the answer to the first open question that was asked", async () => {
    const store = new MemoryIntakeStore();
    await stepIntake(USER, PROJECT, { request: "I want an app" }, { store });
    const r1 = await stepIntake(USER, PROJECT, { reply: "an invoicing tool for freelancers" }, { store });
    expect((await store.get(PROJECT))!.answers.what).toBe("an invoicing tool for freelancers");
    expect(r1.questions[0]!.id).toBe("platforms");
    await stepIntake(USER, PROJECT, { reply: "skip" }, { store });
    expect((await store.get(PROJECT))!.answers.platforms).toBe("(no preference: you decide)");
  });

  it("'just start' leaves the rest to the planner and the intake is ready", async () => {
    const store = new MemoryIntakeStore();
    const r = await stepIntake(USER, PROJECT, { request: "I want an app", proceed: true }, { store });
    expect(r.state).toBe("ready");
    expect(r.questions).toEqual([]);
    expect(Object.values((await store.get(PROJECT))!.answers)).toEqual(Array(5).fill("(no preference: you decide)"));
  });

  it("is ready at once when the first message answers everything", async () => {
    const r = await stepIntake(USER, PROJECT, { request: FULL }, { store: new MemoryIntakeStore() });
    expect(r.state).toBe("ready");
    expect(r.answered).toHaveLength(5);
  });

  it("keeps no secret, in the request or in an answer", async () => {
    const key = ["gh", "p_"].join("") + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const store = new MemoryIntakeStore();
    await stepIntake(USER, PROJECT, { request: `I want an app, my key is ${key}`, answers: { what: `uses ${key}` } }, { store });
    expect(JSON.stringify(await store.get(PROJECT))).not.toContain(key);
  });

  it("a store that fails costs the person nothing: the reply is made from what it was given", async () => {
    const broken: IntakeStore = { get: async () => { throw new Error("db"); }, save: async () => { throw new Error("db"); }, delete: async () => {} };
    const r = await stepIntake(USER, PROJECT, { request: "I want an app" }, { store: broken });
    expect(r.state).toBe("asking");
    expect(r.questions).toHaveLength(5);
  });

  it("works through the Supabase store, with the same rows", async () => {
    const sb = fakeSupabase();
    const store = new SupabaseIntakeStore(sb as never);
    await stepIntake(USER, PROJECT, { request: "I want an app" }, { store });
    await stepIntake(USER, PROJECT, { answers: { what: "a tracker for freelancers" } }, { store });
    expect(sb.tables.code_intake).toHaveLength(1);
    expect(sb.tables.code_intake[0]).toMatchObject({ project_id: PROJECT, user_id: USER, state: "asking", request: "I want an app", answers: { what: "a tracker for freelancers" } });
    expect(await store.get(PROJECT)).toMatchObject({ answers: { what: "a tracker for freelancers" }, asked: expect.arrayContaining(["what"]) });
    expect(await store.get("not-a-uuid")).toBeNull();
    await expect(store.save("not-a-uuid", USER, {})).rejects.toThrow(/not a project or user id/);
    await store.delete(PROJECT);
    expect(await store.get(PROJECT)).toBeNull();
    await expect(new SupabaseIntakeStore(fakeSupabase({ error: "no table" }) as never).get(PROJECT)).rejects.toThrow(/no table/);
  });
});

describe("advanceIntake: from the last answer to the plan", () => {
  const SPEC = {
    name: "Yoga Book", summary: "Booking for yoga studios.", users: ["studio owners", "students"], platforms: ["web"],
    features: [{ name: "Book a class", description: "Pick a class and a time.", priority: "must" }, { name: "Pay", description: "Pay by card.", priority: "must" }],
    nonGoals: ["Video classes"], dataModel: [{ entity: "Class", fields: ["title", "starts_at"] }], screens: [{ name: "Schedule", purpose: "See classes." }],
    risks: ["Payments need care."], assumptions: ["One studio to start."], needs: { auth: true, database: true, payments: true, seo: true, realtime: false, files: false, ai: false },
  };
  const deps = (call: ReturnType<typeof fakeCall>, store = new MemoryIntakeStore()) => ({ model: { call: call.call, userId: "alice", budget: { maxPaise: 800 } as const }, store });

  it("while questions are left it only asks them, and calls no model", async () => {
    const call = fakeCall();
    const out = await advanceIntake(USER, PROJECT, { request: "I want an app" }, deps(call));
    expect(out).toMatchObject({ state: "asking", questions: expect.any(Array), answered: [] });
    expect(call.calls).toHaveLength(0);
  });

  it("when nothing is left it writes the spec on the strong tier, chooses the stack, and writes PLAN.md, and keeps them", async () => {
    const call = fakeCall().on("work.spec", SPEC);
    const store = new MemoryIntakeStore();
    const out = await advanceIntake(USER, PROJECT, { request: FULL }, deps(call, store));
    expect(out.state).toBe("done");
    if (out.state !== "done") return;
    expect(call.of("work.spec")).toHaveLength(1);
    expect(call.of("work.spec")[0]).toMatchObject({ tier: "strong", userId: "alice", budget: { maxPaise: 800 } });
    expect(out.spec).toMatchObject({ name: "Yoga Book", source: "model" });
    expect(out.stack).toMatchObject({ kind: "next", hosting: { name: "Vercel", tier: "yours" } });
    expect(out.plan).toMatch(/^# Yoga Book: plan/);
    expect(out.degraded).toBe(false);
    const row = await store.get(PROJECT);
    expect(row).toMatchObject({ state: "done", spec: { name: "Yoga Book" }, stack: { kind: "next" } });
  });

  it("asked again with nothing new, it returns what it kept and does not call the model again", async () => {
    const call = fakeCall().on("work.spec", SPEC);
    const store = new MemoryIntakeStore();
    const first = await advanceIntake(USER, PROJECT, { request: FULL }, deps(call, store));
    const second = await advanceIntake(USER, PROJECT, {}, deps(call, store));
    expect(call.of("work.spec")).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("new words make a new spec", async () => {
    const call = fakeCall().on("work.spec", SPEC);
    const store = new MemoryIntakeStore();
    await advanceIntake(USER, PROJECT, { request: FULL }, deps(call, store));
    const changed = await advanceIntake(USER, PROJECT, { answers: { constraints: "actually use Flutter please" } }, deps(call, store));
    expect(call.of("work.spec")).toHaveLength(2);
    expect(changed.state === "done" && changed.stack.kind).toBe("flutter");
  });

  it("with no model to be had the spec is what the answers say, and the reply says so", async () => {
    const call = fakeCall();
    call.down = true;
    const out = await advanceIntake(USER, PROJECT, { request: FULL }, deps(call));
    expect(out.state === "done" && out.degraded).toBe(true);
    expect(out.state === "done" && out.spec.source).toBe("rules");
    expect(out.state === "done" && out.plan).toMatch(/from your answers alone/);
  });
});
