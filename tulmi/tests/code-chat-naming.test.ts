/**
 * WHAT A CHAT IS CALLED, AND WHICH PROJECT A TASK MEANS (src/code/chat/naming.ts).
 *
 * These are one problem: a person who says "fix the login thing" with nothing selected has given a task that must land on one
 * project and one chat, and the names are the list the reasoning picks from. What these hold down:
 *   - a name says the repo and the thing, is short enough for a list, and needs NO MODEL for the ordinary case;
 *   - the free name drops the scaffolding of a request ("can you please fix") and keeps what carries meaning;
 *   - which project is answered from FACTS first — they said it, there is one, the chat they are in, the one they were just in —
 *     and a model is asked only when those cannot say;
 *   - a model's pick must be ON THE LIST and sure enough, or the person is asked instead;
 *   - A WRONG PROJECT IS WORSE THAN A QUESTION: with no model, a model that is down, or a guess that is unsure, it asks;
 *   - no projects at all is not a question about which one: it is "none", and the answer is to connect one.
 */
import { describe, expect, it, vi } from "vitest";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});
noNetwork();

const { ASK_MAX, NAME_MAX, SURE_ENOUGH, askName, namedIn, nameFor, repoOf, thingOf, whichProject } = await import("../src/code/chat/naming.js");
const { fakeCall } = await import("./work-fixtures.js");
type ProjectBrief = import("../src/code/chat/naming.js").ProjectBrief;

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;
const P = (id: string, fullName: string, over: Partial<ProjectBrief> = {}): ProjectBrief => ({ id, fullName, ...over });
const BACKEND = P("p1", "alice/tailzu-backend", { about: "the server: screens, bots and Xode's jobs" });
const FRONTEND = P("p2", "alice/tailzu-frontend", { about: "the phone app" });
const SHOP = P("p3", "alice/shopfront", { about: "a storefront for a bakery" });
const THREE = [BACKEND, FRONTEND, SHOP];

const ctx = (answer: unknown) => {
  const json = fakeCall();
  json.on("code.which_project", answer);
  json.on("code.chat_name", answer);
  return { json, model: { userId: "u", budget: "none" as const, call: json.call } };
};

describe("what a chat is called", () => {
  it("is the repo and the thing, and needs no model", () => {
    expect(nameFor({ fullName: "alice/tailzu-backend", question: "Why does slug() leave stray dashes at the ends?" }))
      .toBe("tailzu-backend · slug leave stray dashes ends");
    expect(repoOf("alice/tailzu-backend")).toBe("tailzu-backend");
  });

  it("drops the scaffolding of a request and keeps what carries meaning", () => {
    expect(thingOf("Can you please fix the login redirect for me")).toBe("login redirect");
    expect(thingOf("I want you to add dark mode to the settings page")).toBe("dark mode settings page");
    // All scaffolding and nothing else: empty, which is what makes a model worth asking.
    expect(thingOf("can you please just fix it for me thanks")).toBe("");
    expect(thingOf("")).toBe("");
  });

  it("is the repo alone when the question says nothing, and never longer than a list can show", () => {
    expect(nameFor({ fullName: "alice/shopfront", question: "please fix it" })).toBe("shopfront");
    const long = nameFor({ fullName: "alice/tailzu-backend", question: "the checkout page total is wrong when a discount and a gift card are both applied at once in the cart" });
    expect(long.length).toBeLessThanOrEqual(NAME_MAX);
    expect(long.startsWith("tailzu-backend · ")).toBe(true);
  });

  it("asks a model for a better one, and keeps it to a few words joined to the repo's own name", async () => {
    const c = ctx({ name: "Fix The Checkout Total!" });
    const out = await askName({ fullName: "alice/shopfront", question: "can you please just fix it" }, c.model);
    // The verb and the punctuation go; the repo's name is this code's to put there, not the model's.
    expect(out).toBe("shopfront · checkout total");
    expect(out.length).toBeLessThanOrEqual(NAME_MAX);
  });

  it("cannot be given a name longer than a list can show: the schema refuses it, and the free name stands", async () => {
    const c = ctx({ name: "a very long sentence about what this conversation is really about, with punctuation and more" });
    const out = await askName({ fullName: "alice/shopfront", question: "fix the login redirect" }, c.model);
    expect(out).toBe("shopfront · login redirect");
  });

  it("keeps the free name when the model cannot be reached", async () => {
    const c = ctx({ name: "x" });
    c.json.down = true;
    const out = await askName({ fullName: "alice/shopfront", question: "fix the login redirect" }, c.model);
    expect(out).toBe(nameFor({ fullName: "alice/shopfront", question: "fix the login redirect" }));
  });
});

describe("which project, from facts alone", () => {
  it("is the one they named, by its own name or owner/name, and no model is asked", async () => {
    const c = ctx({ projectId: "p1", confidence: 1, why: "should not be asked" });
    const out = await whichProject({ task: "fix the checkout total on shopfront", projects: THREE }, c.model);
    expect(out).toEqual({ kind: "one", projectId: "p3", why: "you named shopfront" });
    expect(await whichProject({ task: "in alice/tailzu-frontend the list jumps", projects: THREE }, c.model))
      .toMatchObject({ kind: "one", projectId: "p2" });
    expect(c.json.of("code.which_project")).toHaveLength(0);
  });

  it("does not take a name that is only part of another word", async () => {
    const out = await whichProject({ task: "the shopfronts of other sites look better", projects: THREE }, null);
    // "shopfronts" is not "shopfront": nobody said it, so it asks rather than guessing.
    expect(out.kind).toBe("ask");
  });

  it("is the only one there is", async () => {
    const out = await whichProject({ task: "make it faster", projects: [BACKEND] }, null);
    expect(out).toEqual({ kind: "one", projectId: "p1", why: "it is your only project" });
  });

  it("is the one the chat they are in belongs to", async () => {
    const out = await whichProject({ task: "make it faster", projects: THREE, threadProjectId: "p2" }, null);
    expect(out).toMatchObject({ kind: "one", projectId: "p2" });
    expect(out.kind === "one" && out.why).toContain("tailzu-frontend");
  });

  it("is the one they were just working on, when it stands clearly apart", async () => {
    const recent = [P("p1", "alice/tailzu-backend", { lastAt: NOW }), P("p2", "alice/tailzu-frontend", { lastAt: NOW - 5 * DAY }), SHOP];
    const out = await whichProject({ task: "make it faster", projects: recent }, null);
    expect(out).toMatchObject({ kind: "one", projectId: "p1" });
  });

  it("is NOT the newest when two were used about as recently: that is a guess, so it asks", async () => {
    const close = [P("p1", "alice/tailzu-backend", { lastAt: NOW }), P("p2", "alice/tailzu-frontend", { lastAt: NOW - 1000 }), SHOP];
    expect((await whichProject({ task: "make it faster", projects: close }, null)).kind).toBe("ask");
  });
});

describe("which project, when the facts cannot say", () => {
  it("asks a model, shown only the names and what each is", async () => {
    const c = ctx({ projectId: "p3", confidence: 0.9, why: "the bakery site is shopfront" });
    const out = await whichProject({ task: "the bakery's totals are wrong", projects: THREE }, c.model);
    expect(out).toMatchObject({ kind: "one", projectId: "p3" });
    const sent = c.json.of("code.which_project")[0]!.user;
    expect(sent).toContain("alice/shopfront");
    expect(sent).toContain("<data>");
    // Nothing of any project's code: only what they are called and what they are.
    expect(sent).not.toMatch(/function |import /);
  });

  it("will not take a guess it is unsure of, nor an id that is not on the list", async () => {
    const unsure = ctx({ projectId: "p3", confidence: SURE_ENOUGH - 0.01, why: "maybe" });
    expect((await whichProject({ task: "make it faster", projects: THREE }, unsure.model)).kind).toBe("ask");
    const invented = ctx({ projectId: "p9", confidence: 1, why: "a project that does not exist" });
    expect((await whichProject({ task: "make it faster", projects: THREE }, invented.model)).kind).toBe("ask");
  });

  it("asks when there is no model at all, and when the model is down", async () => {
    expect((await whichProject({ task: "make it faster", projects: THREE }, null)).kind).toBe("ask");
    const down = ctx({ projectId: "p1", confidence: 1, why: "x" });
    down.json.down = true;
    expect((await whichProject({ task: "make it faster", projects: THREE }, down.model)).kind).toBe("ask");
  });

  it("offers a handful, newest first, with a question in plain words", async () => {
    const many = Array.from({ length: 6 }, (_, i) => P(`p${i}`, `alice/repo-${i}`, { lastAt: NOW - i * DAY }));
    const out = await whichProject({ task: "make it faster", projects: many }, null);
    expect(out.kind).toBe("ask");
    if (out.kind !== "ask") throw new Error("expected ask");
    expect(out.options).toHaveLength(ASK_MAX);
    expect(out.options.map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
    expect(out.question).toBe("Which project do you mean?");
  });

  it("is 'none' with no projects at all: the answer is to connect one, not to choose one", async () => {
    expect(await whichProject({ task: "fix the login", projects: [] }, null)).toEqual({ kind: "none" });
  });
});

describe("the name on a thread", () => {
  it("rides in the same jsonb as the history, so a row written before simply has no name", async () => {
    const { MemoryThreadStore } = await import("../src/code/chat/threads.js");
    const store = new MemoryThreadStore();
    const id = "11111111-2222-3333-4444-555555555555";
    const base = {
      id, userId: "u1", projectId: "p1", summary: "", turns: 1, lastQuestion: "fix the checkout total",
      lastCites: [], lastLocated: null, history: [], createdAt: 1, updatedAt: 2,
    };
    // Written with no name, as every row before this existed: it reads back without one and nothing else moves.
    await store.put(base);
    expect((await store.get("u1", "p1", id))?.name).toBeUndefined();
    // Written with one: it comes back.
    await store.put({ ...base, name: "shopfront · checkout total" });
    const back = await store.get("u1", "p1", id);
    expect(back?.name).toBe("shopfront · checkout total");
    expect(back?.lastQuestion).toBe("fix the checkout total");
  });
});

describe("naming a repo in words", () => {
  it("matches a full name, a bare repo name, and nothing ambiguous", () => {
    expect(namedIn("fix shopfront's total", THREE)?.id).toBe("p3");
    expect(namedIn("in alice/tailzu-backend", THREE)?.id).toBe("p1");
    expect(namedIn("make it faster", THREE)).toBeNull();
    // Two of them named: nobody can say which, so nothing is returned.
    expect(namedIn("move it from tailzu-backend to tailzu-frontend", THREE)).toBeNull();
  });
});
