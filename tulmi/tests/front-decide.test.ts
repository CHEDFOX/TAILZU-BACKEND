/**
 * DECIDE (src/front/decide.ts, rules.ts, visual.ts, path.ts): a message in, a Decision out.
 *
 * Table-driven, and free: a model that must not be asked is wired in wherever the rules are meant to be sure, so a test that
 * passes has also shown that no model was called. What these hold down:
 *   - the intents, in English, Hinglish and Hindi, with and without a project, an attachment, an earlier turn;
 *   - the shape: how long, and which visual (a table inline, a diagram, a chart, a component, a page), the cheapest that explains it;
 *   - when there is none: a short fact, a spoken reply (offered instead), visuals off, one that costs more than the answer, a person
 *     who closes them; and when it is only offered: visuals "ask";
 *   - the small model is asked only under 0.7, and what it says wins on the intent, the length, the clarifying question;
 *   - a question goes back only under 0.45 and only for a costly road; a cheap one is answered;
 *   - the road: route, tier and budget.
 */
import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

const { decide, RULES_SURE, CLARIFY_BELOW, lengthOf, usableClarify, decideMessage } = await import("../src/front/decide.js");
const { readByRules } = await import("../src/front/rules.js");
const { chooseVisual, needsOf, askedKind, habitFactor, estimatePaise } = await import("../src/front/visual.js");
const { buildTierTable } = await import("../src/code/brain/tiers.js");
const { ctx, inProject, model, noModel, decideJson } = await import("./front-rig.js");
const { stableBlock } = await import("../src/principles/roles.js");
type Decision = import("../src/front/types.js").Decision;

const tiers = buildTierTable();
const free = (call = noModel()) => ({ call: call.call, tiers, fx: 88, jobBudgetPaise: 3000 });

/** One message, decided with no model at all. */
async function ruled(message: string, c = ctx()): Promise<Decision> {
  return decide(message, c, free());
}

describe("the thresholds", () => {
  it("are 0.7 for the rules to stand alone and 0.45 for a question back", () => {
    expect(RULES_SURE).toBe(0.7);
    expect(CLARIFY_BELOW).toBe(0.45);
  });
});

// ------------------------------------------------------------------------------------------------ intents

describe("what a message is, by the rules alone", () => {
  type Row = [string, string, Partial<ReturnType<typeof ctx>>, { intent: string; route: string; tier: string }];
  const rows: Row[] = [
    // small talk, in three languages
    ["hi", "chat", {}, { intent: "chat", route: "reply", tier: "tiny" }],
    ["thanks!", "chat", {}, { intent: "chat", route: "reply", tier: "tiny" }],
    ["namaste", "chat", {}, { intent: "chat", route: "reply", tier: "tiny" }],
    ["नमस्ते", "chat", {}, { intent: "chat", route: "reply", tier: "tiny" }],
    // general knowledge
    ["what is the capital of France?", "answer", {}, { intent: "answer", route: "reply", tier: "cheap" }],
    ["explain how OAuth works", "answer", {}, { intent: "answer", route: "reply", tier: "cheap" }],
    ["what is 15% of 800", "answer", {}, { intent: "answer", route: "reply", tier: "cheap" }],
    ["bhai 15% of 800 kitna hota hai?", "answer", {}, { intent: "answer", route: "reply", tier: "cheap" }],
    ["translate 'good morning' to Hindi", "answer", {}, { intent: "answer", route: "reply", tier: "cheap" }],
    ["write a python function to reverse a string", "answer", {}, { intent: "answer", route: "reply", tier: "cheap" }],
    ["kya Python mein list aur tuple mein fark hai?", "answer", {}, { intent: "answer", route: "reply", tier: "cheap" }],
    ["पायथन और जावा में अंतर बताओ", "answer", {}, { intent: "answer", route: "reply", tier: "cheap" }],
    // code, with no project: a question about how, never a change
    ["fix this: TypeError: Cannot read properties of undefined (reading 'x')\n    at foo (a.ts:1:2)", "answer", {}, { intent: "answer", route: "reply", tier: "cheap" }],
    // a project: a question about it, or a change to it
    ["how does the login flow work", "code_question", { projectId: "p" }, { intent: "code_question", route: "code_answer", tier: "cheap" }],
    ["yeh app kaise kaam karta hai?", "code_question", { projectId: "p" }, { intent: "code_question", route: "code_answer", tier: "cheap" }],
    ["why is the cart empty after refresh?", "code_question", { projectId: "p" }, { intent: "code_question", route: "code_answer", tier: "cheap" }],
    ["fix the login bug", "code_task", { projectId: "p" }, { intent: "code_task", route: "code_job", tier: "code" }],
    ["fix the payment webhook bug", "code_task", { projectId: "p" }, { intent: "code_task", route: "code_job", tier: "strong" }],
    ["change the button color to red", "code_task", { projectId: "p" }, { intent: "code_task", route: "code_job", tier: "code" }],
    ["refactor the auth module into smaller functions", "code_task", { projectId: "p" }, { intent: "code_task", route: "code_job", tier: "code" }],
    // a design is something to look at
    ["add a pricing card", "design", { projectId: "p" }, { intent: "design", route: "artifact", tier: "code" }],
    ["show me how a pricing page would look", "design", { projectId: "p" }, { intent: "design", route: "artifact", tier: "code" }],
    ["how would a pricing page look for my bakery", "design", {}, { intent: "design", route: "artifact", tier: "code" }],
    ["mujhe ek pricing card chahiye", "design", { projectId: "p" }, { intent: "design", route: "artifact", tier: "code" }],
    ["ek pricing card banao", "design", { projectId: "p" }, { intent: "design", route: "artifact", tier: "code" }],
    // the web
    ["research the best vector databases with sources", "research", {}, { intent: "research", route: "research", tier: "code" }],
    ["what's the latest version of React?", "research", {}, { intent: "research", route: "research", tier: "cheap" }],
    ["is there a good library for date pickers in react", "research", { projectId: "p" }, { intent: "research", route: "research", tier: "code" }],
    // plans
    ["plan my week", "plan", {}, { intent: "plan", route: "plan", tier: "cheap" }],
    ["python seekhne ka plan banao", "plan", {}, { intent: "plan", route: "plan", tier: "cheap" }],
    ["plan the roadmap for adding payments", "plan", { projectId: "p" }, { intent: "plan", route: "plan", tier: "code" }],
  ];
  for (const [message, _why, over, want] of rows) {
    it(`${JSON.stringify(message.split("\n")[0]!.slice(0, 50))}${over.projectId ? " (in a project)" : ""} is ${want.intent}`, async () => {
      const d = await ruled(message, ctx(over));
      expect({ intent: d.intent, route: d.route, tier: d.tier }).toEqual(want);
      expect(d.via).toBe("rules");
      expect(d.confidence).toBeGreaterThanOrEqual(RULES_SURE);
      expect(d.clarify).toBeUndefined();
    });
  }

  it("does not read a change to code as a design, or a design as a change", async () => {
    // "the form" is a thing that exists; "a field" is a part of it: these change code
    for (const m of ["make the form submit on enter", "add a field to the signup form", "add validation to the signup form", "change the pricing card padding"]) {
      expect((await decide(m, inProject(), { ...free(), call: model(() => decideJson({ intent: "code_task", confidence: 0.6 })).call })).intent, m).toBe("code_task");
    }
    expect((await ruled("add a new pricing card", inProject())).intent).toBe("design");
    expect((await ruled("build me a landing page for my bakery")).intent).toBe("design");
  });

  it("makes a question about the world an answer even when there is a project, if it is not about the project", async () => {
    const d = await decide("what is the capital of France?", inProject(), free());
    expect(d.intent).toBe("answer");
  });

  it("takes anything attached to be what the message is about", async () => {
    const att = [{ id: "f1", kind: "code" as const, mime: "text/plain", bytes: 10, sha256: "a".repeat(64), name: "x.ts" }];
    const d = await ruled("what does this do", ctx({ attachments: att }));
    expect(d).toMatchObject({ intent: "file_question", route: "file", tier: "cheap", via: "rules" });
  });

  it("sends an image to the vision tier", async () => {
    const att = [{ id: "i1", kind: "image" as const, mime: "image/png", bytes: 1000, sha256: "b".repeat(64), name: "shot.png" }];
    const d = await ruled("what is in this picture?", ctx({ attachments: att }));
    expect(d).toMatchObject({ intent: "file_question", route: "file", tier: "vision" });
    // the vision call is in the budget
    const text = await ruled("what is in this picture?", ctx({ attachments: [{ ...att[0]!, kind: "text" as const, mime: "text/plain", name: "n.txt" }] }));
    expect(d.budgetPaise).toBeGreaterThan(text.budgetPaise);
  });

  it("carries a short follow-up on from the turn before: the same intent, and the earlier words in front", async () => {
    const recent = [{ said: "show me a pricing page", did: "design" }];
    const r = readByRules("and one for the blog", { projectId: undefined, recent, attachments: [], mode: "text" });
    expect(r.intent).toBe("design");
    expect(r.followUp).toEqual({ base: "show me a pricing page" });
    const d = await decide("make it darker", ctx({ projectId: "p", recent }), { ...free(), call: model(() => decideJson({ intent: "design", confidence: 0.75 })).call });
    expect(d.intent).toBe("design");
    expect(d.followUp).toBe("show me a pricing page");
    // a long message that happens to start with "and" is its own request
    expect(readByRules("and then explain in detail why the sky is blue during the day but red at sunset", { recent, attachments: [], mode: "text" }).followUp).toBeUndefined();
  });

  it("takes \"what?\", \"why?\", \"explain\" after an answer as about that answer, in the language it is said in (as Claude Code does)", async () => {
    const recent = [{ said: "what do you understand of the project", did: "code_question" }];
    const lost = readByRules("what ?", { projectId: "p", recent, attachments: [], mode: "text" });
    expect(lost).toMatchObject({ intent: "code_question", followUp: { base: "what do you understand of the project" } });
    expect(lost.reaction?.language).toBe("en");
    expect(lost.reaction?.ask).toMatch(/explain your last answer again, simpler/i);
    const d = await ruled("what?", ctx({ projectId: "p", recent }));
    expect(d).toMatchObject({ intent: "code_question", language: "en", followUp: "what do you understand of the project" });
    expect(d.reask).toMatch(/simpler/);
    expect(d.clarify).toBeUndefined();
    // "why?" is asked of the last answer as it is; Hinglish is answered in Hinglish
    expect(readByRules("why?", { projectId: "p", recent, attachments: [], mode: "text" }).reaction).toEqual({ ask: "About your last answer: why?", language: "en" });
    expect(readByRules("matlab?", { projectId: "p", recent, attachments: [], mode: "text" }).reaction?.language).toBe("hinglish");
    // "??" alone is lost too, said in the language of the question it follows.
    const marks = readByRules("??", { projectId: "p", recent, attachments: [], mode: "text" });
    expect(marks.intent).toBe(lost.intent);
    expect(marks.reaction).toEqual({ ask: lost.reaction?.ask, language: "en" });
    expect(readByRules("...?", { projectId: "p", recent, attachments: [], mode: "text" }).reaction?.language).toBe("en");
    // With nothing before it, "what?" is still nothing to go on; a long message is its own request
    expect(readByRules("what?", { projectId: "p", recent: [], attachments: [], mode: "text" }).reaction).toBeUndefined();
    expect(readByRules("what does the checkout page do when the cart is empty?", { projectId: "p", recent, attachments: [], mode: "text" }).reaction).toBeUndefined();
  });

  it("is the same for the same words, and says why in short ids, never in the words", async () => {
    const a = await ruled("compare React vs Vue");
    const b = await ruled("compare React vs Vue");
    expect(a).toEqual(b);
    expect(a.reasons.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).not.toContain("React");
  });
});

// ------------------------------------------------------------------------------------------------ the shape

describe("how long", () => {
  it("is short for a short fact, small talk and a job's reply; medium for an explanation; long when asked for detail or for research", () => {
    expect(lengthOf("what is the capital of France?", "answer", "text")).toBe("short");
    expect(lengthOf("what is 15% of 800", "answer", "text")).toBe("short");
    expect(lengthOf("hello", "chat", "text")).toBe("short");
    expect(lengthOf("fix the login bug", "code_task", "text")).toBe("short");
    expect(lengthOf("explain how OAuth works", "answer", "text")).toBe("medium");
    expect(lengthOf("why is the sky blue?", "answer", "text")).toBe("medium");
    expect(lengthOf("explain how OAuth works in detail", "answer", "text")).toBe("long");
    expect(lengthOf("research cats", "research", "text")).toBe("long");
    expect(lengthOf("how does login work", "code_question", "text")).toBe("medium");
  });

  it("is brief when it is read out", () => {
    expect(lengthOf("explain how OAuth works", "answer", "voice")).toBe("short");
    expect(lengthOf("research cats", "research", "voice")).toBe("medium");
    // unless they asked for detail
    expect(lengthOf("explain OAuth in detail", "answer", "voice")).toBe("long");
  });
});

describe("a visual, when it explains faster", () => {
  it("is none for a short fact", async () => {
    const d = await ruled("what is the capital of France?");
    expect(d.shape).toEqual({ length: "short", visual: null });
    expect(d.reasons).not.toContain("visual:table");
  });

  it("is a table, inline, for a comparison", async () => {
    const d = await ruled("compare Postgres vs MySQL for a small online shop");
    expect(d.intent).toBe("answer");
    expect(d.shape.length).toBe("medium");
    expect(d.shape.visual).toMatchObject({ kind: "table", via: "inline", offer: false, isAnswer: false, asked: false });
    expect(d.shape.visual!.artifactType).toBeUndefined();
    expect(d.route).toBe("reply");
  });

  it("is a table for specs, in Hinglish and in Hindi", async () => {
    expect((await ruled("specs of iPhone 15 and Galaxy S24 batao")).shape.visual?.kind).toBe("table");
    expect((await ruled("iPhone aur Samsung ka comparison karo")).shape.visual?.kind).toBe("table");
    expect((await ruled("पायथन और जावा में अंतर बताओ")).shape.visual?.kind).toBe("table");
    expect((await ruled("kya Python mein list aur tuple mein fark hai?")).shape.visual?.kind).toBe("table");
  });

  it("is a mermaid diagram, made beside the answer, for how a project's login flow works", async () => {
    const d = await ruled("how does the login flow work", inProject());
    expect(d.intent).toBe("code_question");
    expect(d.route).toBe("code_answer");
    expect(d.shape.visual).toMatchObject({ kind: "diagram", via: "artifact", artifactType: "mermaid", offer: false });
  });

  it("is a diagram for steps, a flow, an architecture, a timeline, and a plan", async () => {
    for (const m of ["explain the request flow of a web server", "walk me through the architecture of a typical SaaS app", "explain step by step how a bill becomes law"]) {
      expect((await ruled(m)).shape.visual?.kind, m).toBe("diagram");
    }
    const plan = await ruled("plan my week");
    expect(plan.shape.visual).toMatchObject({ kind: "diagram", via: "artifact", estPaise: 0 });
    expect((await ruled("make a launch plan for my app")).shape.visual?.kind).toBe("diagram");
  });

  it("is a chart for numbers over time, when it is worth it, and a table when a chart would cost more than the answer", async () => {
    const m = "sales were 10, 20, 35, 50 in jan feb mar apr; chart the trend over time";
    const d = await ruled(m);
    expect(d.intent).toBe("answer");
    // asked for in so many words, so it is made whatever it costs
    expect(d.shape.visual).toMatchObject({ kind: "chart", via: "artifact", artifactType: "react", asked: true });
    // not asked for, but the numbers call for one: a cheap answer does not carry a dearer chart; its numbers are a table
    const quiet = await ruled("sales by month were 10, 20, 35, 50 for jan feb mar apr; what is the growth trend, and compare it to last year's");
    expect(quiet.shape.visual?.kind).not.toBe("chart");
  });

  it("is a component, in the project's style, for a new UI in a project; a page without one", async () => {
    const withProject = await ruled("add a pricing card", inProject());
    expect(withProject.shape.visual).toMatchObject({ kind: "component", via: "artifact", artifactType: "react", isAnswer: true, offer: false });
    const without = await ruled("how would a pricing page look for my bakery");
    expect(without.shape.visual).toMatchObject({ kind: "page", via: "artifact", artifactType: "html", isAnswer: true });
  });

  it("is none for small talk and for a job (its result is a pull request)", async () => {
    expect((await ruled("hi")).shape.visual).toBeNull();
    expect((await ruled("fix the login bug", inProject())).shape.visual).toBeNull();
  });

  it("is made when asked for in so many words, whatever the mode or the preference but 'off' for the unasked", async () => {
    expect(askedKind("put it in a table please")).toBe("table");
    expect(askedKind("draw a diagram of the checkout")).toBe("diagram");
    expect(askedKind("plot this as a chart")).toBe("chart");
    expect(askedKind("डायग्राम बनाओ")).toBe("diagram");
    expect(askedKind("what is the weather")).toBeNull();
    for (const c of [ctx({ mode: "voice" }), ctx({ visuals: "ask" }), ctx({ visuals: "off" })]) {
      const d = await ruled("what is the difference between TCP and UDP? put it in a table", c);
      expect(d.shape.visual, JSON.stringify(c)).toMatchObject({ kind: "table", offer: false, asked: true });
    }
  });

  it("is a design even when visuals are off, spoken, or to be asked about: the person asked to see it", async () => {
    for (const c of [ctx({ visuals: "off" }), ctx({ mode: "voice" }), ctx({ visuals: "ask" })]) {
      const d = await ruled("add a pricing card", { ...c, projectId: "p" });
      expect(d.shape.visual, JSON.stringify(c)).toMatchObject({ kind: "component", offer: false, isAnswer: true });
    }
  });

  it("is offered, not made, when the reply is spoken", async () => {
    const d = await ruled("compare Postgres vs MySQL for a small online shop", ctx({ mode: "voice" }));
    expect(d.shape.visual).toMatchObject({ kind: "table", offer: true });
    expect(d.shape.length).toBe("short");
    expect(d.reasons).toContain("visual:offer:voice");
  });

  it("is offered, one tap, when the person likes to be asked; and none when they turned visuals off", async () => {
    const ask = await ruled("compare Postgres vs MySQL for a small online shop", ctx({ visuals: "ask" }));
    expect(ask.shape.visual).toMatchObject({ kind: "table", offer: true });
    expect(ask.reasons).toContain("visual:offer:ask");
    const off = await ruled("compare Postgres vs MySQL for a small online shop", ctx({ visuals: "off" }));
    expect(off.shape.visual).toBeNull();
  });

  it("is made when the person took the offer: whatever they prefer", async () => {
    const d = await ruled("compare Postgres vs MySQL for a small online shop", ctx({ visuals: "off", takeOffer: "table" }));
    expect(d.shape.visual).toMatchObject({ kind: "table", offer: false, asked: true });
    const page = await ruled("tell me about our product", ctx({ takeOffer: "component" }));
    expect(page.shape.visual?.kind).toBe("page");
    const comp = await ruled("tell me about our product", inProject({ takeOffer: "component" }));
    expect(comp.shape.visual?.kind).toBe("component");
  });

  it("has no table on a road whose answer is not written by the reply role", async () => {
    const d = await decide("compare the latest versions of React and Vue with sources", ctx(), free());
    expect(d.route).toBe("research");
    expect(d.shape.visual).toBeNull();
    expect(d.reasons).toContain("visual:skip:no_table_on_research");
  });
});

describe("the ladder, priced", () => {
  const input = (over: Partial<Parameters<typeof chooseVisual>[0]> = {}) => ({
    message: "compare A vs B", intent: "answer" as const, length: "medium" as const, ctx: { mode: "text" as const, visuals: "auto" as const },
    answerPaise: 50, tiers, ...over,
  });

  it("puts the cheaper rung first and prices every one from the tier table", () => {
    const p = (k: Parameters<typeof estimatePaise>[0]) => estimatePaise(k, tiers, 88);
    expect(p("table")).toBeLessThan(p("diagram"));
    expect(p("diagram")).toBeLessThan(p("chart"));
    expect(p("chart")).toBeLessThan(p("component"));
    expect(p("table")).toBeLessThan(10);
  });

  it("picks the cheapest rung the words are sure about: a comparison of steps is a table, not a diagram", () => {
    const both = needsOf("compare the steps of the process of two bank loans", "answer");
    expect(both.map((n) => n.kind)).toEqual(["table", "diagram"]);
    expect(chooseVisual(input({ message: "compare the steps of the process of two bank loans", answerPaise: 500 })).plan?.kind).toBe("table");
  });

  it("skips a visual that costs more than the answer, and steps down to a cheaper rung that explains it", () => {
    const m = "the numbers over time were 10, 20, 35, 50, 80; compare the growth";
    // a cheap answer: no chart; but the comparison is a table
    expect(chooseVisual(input({ message: m, answerPaise: 20 })).plan?.kind).toBe("table");
    // an expensive answer (research) can carry a chart
    const dear = chooseVisual(input({ message: "chart the trend over time: 10, 20, 35, 50, 80", answerPaise: 400, intent: "research" }));
    expect(dear.plan?.kind).toBe("chart");
    // nothing cheaper explains a flow: none, and the reason is the cost
    const none = chooseVisual(input({ message: "explain the request flow", answerPaise: 5 }));
    expect(none.plan).toBeNull();
    expect(none.reasons).toContain("visual:skip:costs_more_than_the_answer");
  });

  it("is moved a little by what the person does with visuals: closed ones lower the chance, kept ones raise it, never past 0.6 to 1.4", () => {
    expect(habitFactor(0.5)).toBe(1);
    expect(habitFactor(0)).toBeCloseTo(0.6);
    expect(habitFactor(1)).toBeCloseTo(1.4);
    expect(habitFactor(undefined)).toBe(1);
    expect(habitFactor(7)).toBeCloseTo(1.4);
    // "how does it work" is weak evidence (0.62): a person who closes visuals does not get it, one who keeps them does
    const weak = { message: "how does OAuth work", intent: "answer" as const, length: "long" as const, ctx: { mode: "text" as const, visuals: "auto" as const }, answerPaise: 500, tiers };
    expect(chooseVisual({ ...weak, propensity: { value: 0.1, why: "closed 8 of 8 visuals" } }).plan).toBeNull();
    expect(chooseVisual({ ...weak, propensity: { value: 0.9, why: "kept 8 of 8 visuals" } }).plan?.kind).toBe("diagram");
    expect(chooseVisual({ ...weak }).plan?.kind).toBe("diagram");
    // a comparison is strong evidence (0.9): it stands against a habit of closing
    expect(chooseVisual({ ...weak, message: "compare A vs B", propensity: { value: 0, why: "closed 9 of 9 visuals" } }).plan?.kind).toBe("table");
    // and what they asked for is never held back by it
    expect(chooseVisual({ ...weak, message: "draw a diagram of how OAuth works", propensity: { value: 0, why: "closed 9 of 9 visuals" } }).plan?.kind).toBe("diagram");
  });
});

// ------------------------------------------------------------------------------------------------ the small model

describe("the small model", () => {
  it("is not asked when the rules are sure (0.7 or more)", async () => {
    const m = noModel();
    for (const text of ["hi", "what is the capital of France?", "compare React vs Vue", "plan my week"]) await decide(text, ctx(), { call: m.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(m.sent).toEqual([]);
  });

  it("always decides in a project's chat, and is not shown what the keywords guessed", async () => {
    const m = model(() => decideJson({ intent: "code_question", length: "short", confidence: 0.9 }));
    const d = await decide("this isn't a bug, just explain how the login works", inProject(), { call: m.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(m.sent).toHaveLength(1);
    expect(d.intent).toBe("code_question");
    expect(m.sent[0]!.user).not.toMatch(/The rules read it as/);
    // a model that can't be reached leaves the rules' answer standing
    const off = await decide("fix the login bug", inProject(), { call: noModel().call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(off.intent).toBe("code_task");
  });

  it("is asked once under 0.7: the tiny tier, the front_decide role, the message fenced as data, and what the rules saw", async () => {
    const m = model(() => decideJson({ intent: "chat", length: "short", confidence: 0.85 }));
    const d = await decide("I'm feeling tired today", ctx({ device: "phone", mode: "voice" }), { call: m.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(m.sent).toHaveLength(1);
    const s = m.sent[0]!;
    expect(s.tier).toBe("tiny");
    expect(s.purpose).toBe("front.decide");
    expect(s.system).toBe(stableBlock("front_decide"));
    expect(s.user).toContain("Message:\n<<<\nI'm feeling tired today\n>>>");
    expect(s.user).toContain("Project: no.");
    expect(s.user).toContain("Device: phone. Mode: voice.");
    expect(s.user).toContain("The rules read it as: chat (0.4).");
    expect(s.capPaise).toBe(100);
    expect(s.userId).toBe("alice");
    expect(d).toMatchObject({ intent: "chat", via: "model", confidence: 0.85 });
    expect(d.reasons).toContain("model:tiny");
  });

  it("wins on the intent, the length and the visual it suggests; the rules do not argue", async () => {
    const m = model(() => decideJson({ intent: "answer", length: "long", visual: "table", confidence: 0.8 }));
    const d = await decide("I'm feeling tired today", ctx(), { call: m.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(d.intent).toBe("answer");
    expect(d.shape.length).toBe("long");
    expect(d.shape.visual?.kind).toBe("table");
  });

  it("cannot make a code task of a message with no project, or a file question of one with nothing attached", async () => {
    const m = model(() => decideJson({ intent: "code_task", confidence: 0.9 }));
    expect((await decide("I'm feeling tired today", ctx(), { call: m.call, tiers, fx: 88, jobBudgetPaise: 3000 })).intent).toBe("answer");
    const f = model(() => decideJson({ intent: "file_question", confidence: 0.9 }));
    expect((await decide("I'm feeling tired today", ctx(), { call: f.call, tiers, fx: 88, jobBudgetPaise: 3000 })).intent).toBe("answer");
  });

  it("costs nothing but the rules' own answer when it cannot be reached or answers badly", async () => {
    const down = model(() => new Error("model down"));
    const d = await decide("I'm feeling tired today", ctx(), { call: down.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(d).toMatchObject({ intent: "chat", via: "rules", confidence: 0.4 });
    expect(d.reasons).toContain("model:skipped:down");
    const bad = model(() => ({ json: { intent: "nonsense" } }));
    // the gateway would have refused the shape; a stand-in that returns it anyway is still read as a failed model, not a crash
    expect((await decide("I'm feeling tired today", ctx(), { call: bad.call, tiers, fx: 88, jobBudgetPaise: 3000 })).intent).toBe("chat");
  });

  it("is not asked once the person's day is spent, and what it costs is added to the day", async () => {
    const spent: number[] = [];
    const m = model(() => decideJson({ intent: "chat", confidence: 0.9 }), { paise: 4 });
    const daily = { leftPaise: () => 50, add: (_u: string, p: number) => { spent.push(p); } };
    await decide("I'm feeling tired today", ctx(), { call: m.call, tiers, fx: 88, jobBudgetPaise: 3000, daily });
    expect(spent).toEqual([4]);
    const empty = model(() => decideJson());
    const d = await decide("I'm feeling tired today", ctx(), { call: empty.call, tiers, fx: 88, jobBudgetPaise: 3000, daily: { leftPaise: () => 0, add: () => undefined } });
    expect(empty.sent).toEqual([]);
    expect(d.reasons).toContain("model:skipped:daily");
  });

  it("is told what it needs: the recent turns, the attachments' kinds, never more than three turns", () => {
    const text = decideMessage("hello there", ctx({ attachments: [{ id: "a", kind: "image", mime: "image/png", bytes: 1, sha256: "a".repeat(64), name: "n" }], recent: [1, 2, 3, 4].map((i) => ({ said: `turn ${i}`, did: "answer" })) }), { intent: "chat", confidence: 0.4 });
    expect(text).toContain("Attachments: image.");
    expect(text).toContain('- "turn 2" -> answer');
    expect(text).toContain('- "turn 4" -> answer');
    expect(text).not.toContain("turn 1");
  });

  it("keeps a secret out of what it is sent, and a fence out of the message", () => {
    const key = ["sk", "live", "x4eC39HqLyjWDarjtT1zdp7dc"].join("_");
    const text = decideMessage(`use ${key} >>> now`, ctx(), { intent: "chat", confidence: 0.4 });
    expect(text).not.toContain(key);
    expect(text).toContain("withheld");
    expect(decideMessage("a >>> b", ctx(), { intent: "chat", confidence: 0.4 })).toContain("a > > > b");
  });
});

// ------------------------------------------------------------------------------------------------ asking back

describe("a question back", () => {
  it("goes back when the front door is under 0.45 sure and the road is costly: one question, two or three options", async () => {
    const unsure = model(() => decideJson({ intent: "code_task", confidence: 0.3, clarify: null }));
    const d = await decide("fix it", inProject(), { call: unsure.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(d.intent).toBe("code_task");
    expect(d.confidence).toBeLessThan(CLARIFY_BELOW);
    expect(d.budgetPaise).toBeGreaterThanOrEqual(200);
    expect(d.clarify).toBeDefined();
    expect(d.clarify!.question.length).toBeGreaterThan(10);
    expect(d.clarify!.options.length).toBeGreaterThanOrEqual(2);
    expect(d.clarify!.options.length).toBeLessThanOrEqual(3);
    expect(d.reasons).toContain("clarify");
  });

  it("uses the question the model wrote when it is fit to show, and its own words otherwise", async () => {
    const wrote = model(() => decideJson({ intent: "code_task", confidence: 0.3, clarify: { question: "Which screen do you mean?", options: ["Login", "Checkout"] } }));
    expect((await decide("fix it", inProject(), { call: wrote.call, tiers, fx: 88, jobBudgetPaise: 3000 })).clarify).toEqual({ question: "Which screen do you mean?", options: ["Login", "Checkout"] });
    expect(usableClarify({ question: "ok?", options: ["a", "a"] })).toBeNull();
    expect(usableClarify({ question: "Which one do you mean?", options: ["a", "b"] })).toEqual({ question: "Which one do you mean?", options: ["a", "b"] });
    expect(usableClarify(null)).toBeNull();
  });

  it("asks in the person's language", async () => {
    const down = model(() => new Error("down"));
    const hinglish = await decide("isko theek karo", inProject(), { call: down.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(hinglish.language).toBe("hinglish");
    expect(hinglish.clarify?.question).toMatch(/Kya aap/);
    const hi = await decide("इसे ठीक करो", inProject(), { call: down.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(hi.clarify?.question).toMatch(/क्या आप/);
    const en = await decide("fix it", inProject(), { call: down.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(en.clarify?.question).toMatch(/change the code/i);
  });

  it("never goes back for a cheap road: an unclear message is answered", async () => {
    // nothing to go on, and nowhere costly to go
    const hmm = await ruled("hmm");
    expect(hmm).toMatchObject({ intent: "unclear", route: "reply", tier: "tiny" });
    expect(hmm.clarify).toBeUndefined();
    const unsure = model(() => decideJson({ intent: "answer", confidence: 0.1 }));
    const d = await decide("I'm feeling tired today", ctx(), { call: unsure.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(d.confidence).toBeLessThan(CLARIFY_BELOW);
    expect(d.clarify).toBeUndefined();
    expect(d.budgetPaise).toBeLessThan(200);
  });

  it("stays quiet at 0.45 and over, for a costly road: that is the self-check's, at dispatch", async () => {
    const mid = model(() => decideJson({ intent: "code_task", confidence: 0.5 }));
    const d = await decide("fix the redirect after login", inProject(), { call: mid.call, tiers, fx: 88, jobBudgetPaise: 3000, threshold: 1 });
    expect(d.confidence).toBe(0.5);
    expect(d.clarify).toBeUndefined();
  });

  it("asks what, however sure the read, when a change names nothing to change and follows no conversation: fix it, make it work, theek karo", async () => {
    const sure = model(() => decideJson({ intent: "code_task", confidence: 0.95, clarify: null }));
    for (const text of ["fix it", "make it work", "theek karo", "please fix"]) {
      const d = await decide(text, inProject(), { call: sure.call, tiers, fx: 88, jobBudgetPaise: 3000 });
      expect(d.clarify, text).toBeDefined();
      expect(d.reasons, text).toContain("clarify:bare");
    }
    // A request that says what, or a word that follows a conversation, is not asked about.
    for (const text of ["fix the redirect after login", "add a clear completed button to the todo list"]) {
      expect((await decide(text, inProject(), { call: sure.call, tiers, fx: 88, jobBudgetPaise: 3000 })).clarify, text).toBeUndefined();
    }
    const after = await decide("fix it", inProject({ recent: [{ said: "the checkout page throws on an empty cart" }] }), { call: sure.call, tiers, fx: 88, jobBudgetPaise: 3000 });
    expect(after.reasons).not.toContain("clarify:bare");
  });
});

// ------------------------------------------------------------------------------------------------ the road

describe("the road: route, tier, budget", () => {
  it("gives a cheap reply a small budget and a job the job budget, scaled by how hard it is", async () => {
    const chat = await ruled("hi");
    const answer = await ruled("what is the capital of France?");
    const job = await ruled("change the button color to red", inProject());
    const risky = await ruled("fix the payment webhook bug", inProject());
    expect(chat.budgetPaise).toBeLessThanOrEqual(answer.budgetPaise);
    expect(answer.budgetPaise).toBeLessThan(100);
    expect(job.tier).toBe("code");
    expect(risky.tier).toBe("strong");
    expect(job.budgetPaise).toBeGreaterThan(answer.budgetPaise * 5);
    expect(risky.budgetPaise).toBeGreaterThanOrEqual(job.budgetPaise);
    const small = await decide("change the button color to red", inProject(), { ...free(), jobBudgetPaise: 1000 });
    expect(small.budgetPaise).toBe(400); // an easy change gets 0.4 of the job budget
  });

  it("goes deeper for research that asks for it, and quicker for a lookup", async () => {
    expect(await ruled("what's the latest version of React?")).toMatchObject({ route: "research", depth: "quick", tier: "cheap" });
    expect(await ruled("research vector databases with sources")).toMatchObject({ depth: "standard", tier: "code" });
    const deep = await ruled("do a thorough, in-depth research on vector databases with sources");
    expect(deep).toMatchObject({ depth: "deep", tier: "strong" });
    expect(deep.budgetPaise).toBeGreaterThan((await ruled("research vector databases with sources")).budgetPaise);
  });

  it("adds the picture's cap to a reply that has one made beside it, and nothing for a table, an offer, or a plan's drawn diagram", async () => {
    const base = await ruled("explain how OAuth works");
    const diagram = await ruled("explain the request flow of a web server in detail");
    expect(diagram.shape.visual?.kind).toBe("diagram");
    expect(diagram.budgetPaise).toBeGreaterThan(base.budgetPaise);
    const table = await ruled("compare Postgres vs MySQL for a small online shop");
    const tableOffer = await ruled("compare Postgres vs MySQL for a small online shop", ctx({ visuals: "ask" }));
    expect(table.budgetPaise).toBe(tableOffer.budgetPaise);
    const plan = await ruled("plan my week");
    expect(plan.shape.visual?.estPaise).toBe(0);
  });

  it("leaves the language to the classifier, and tells it plainly", async () => {
    expect((await ruled("namaste")).language).toBe("en");
    expect((await ruled("bhai 15% of 800 kitna hota hai?")).language).toBe("hinglish");
    expect((await ruled("पायथन और जावा में अंतर बताओ")).language).toBe("hi");
  });
});

// ------------------------------------------------------------------------------------------------ talking about code, and free-form work

describe("talking about code, and how a task is worked (docs/code-chat.md, docs/code-agent.md)", () => {
  const recent = [{ said: "where is the session cookie set?", did: "code_question" }];

  it("sends a deep why or a what-would-break question to the strong tier, and every other question about the code to the cheap one", async () => {
    for (const q of ["why is checkout slow under load?", "why is the cart page slow after refresh?", "what would break if I rename startSession?"]) {
      const d = await ruled(q, inProject());
      expect(d, q).toMatchObject({ intent: "code_question", route: "code_answer", tier: "strong" });
      expect(d.reasons, q).toContain("code:deep");
    }
    for (const q of ["where is the session cookie set?", "how does the login flow work", "why does startSession use sameSite lax?"]) {
      const d = await ruled(q, inProject());
      expect(d, q).toMatchObject({ intent: "code_question", tier: "cheap" });
      expect(d.reasons, q).not.toContain("code:deep");
    }
    // The strong tier costs more of the question's money than the cheap one does.
    expect((await ruled("why is checkout slow under load?", inProject())).budgetPaise).toBeGreaterThan((await ruled("where is the session cookie set?", inProject())).budgetPaise);
  });

  it("plans a flow diagram for a question about how something works, and the chat draws it", async () => {
    const d = await ruled("how does login work across the app?", inProject());
    expect(d.shape.visual).toMatchObject({ kind: "diagram" });
  });

  it("takes 'ok, change it' after a question about the code for a task that carries what the talk found", async () => {
    for (const m of ["ok, change it", "okay, make the change", "haan, isko badal do"]) {
      const d = await ruled(m, inProject({ recent }));
      expect(d, m).toMatchObject({ intent: "code_task", route: "code_job", handoff: true, followUp: "where is the session cookie set?" });
    }
    // The same words with no question before them are an ordinary short message, not a hand-off.
    expect((await ruled("ok, change it", inProject())).handoff).toBeUndefined();
    // After a task, not a question: no hand-off either.
    expect((await ruled("ok, change it", inProject({ recent: [{ said: "fix the login bug", did: "code_task" }] }))).handoff).toBeUndefined();
  });

  it("takes the person's word for a team: asked for in words, refused in words, and otherwise left to the plan", async () => {
    for (const m of ["refactor the settings screens with a team", "add search to every list in parallel with helpers", "build the export, split it up between helpers", "lead mode: rewrite the settings screens"]) {
      expect(await ruled(m, inProject()), m).toMatchObject({ intent: "code_task", team: "on" });
    }
    for (const m of ["add a logout button, no team please", "rename the api folder, do it yourself", "update the readme without helpers", "fix the typo in the header, one job only"]) {
      expect(await ruled(m, inProject()), m).toMatchObject({ intent: "code_task", team: "off" });
    }
    for (const m of ["change the button color to red", "add a logout button", "refactor the auth module into smaller functions"]) {
      expect((await ruled(m, inProject())).team, m).toBeUndefined();
    }
    // Refusing wins over asking; and a question about the code is never a team's job.
    expect((await ruled("add a logout button, use a team, no team", inProject())).team).toBe("off");
    expect((await ruled("should we use a team of helpers for this?", inProject())).team).toBeUndefined();
  });

  it("reads a problem report that asks for a fix as a code task, not research: \"Security report… find out why and fix it\"", async () => {
    const report = "Security report from a customer: their app runs behind exactly one load balancer and sets `app.set('trust proxy', 1)` as the docs say. A client can spoof `req.ip` with its own X-Forwarded-For header. Find out why and fix it.";
    for (const m of [report, "Bug report from QA: the invoice total is off by one cent when a discount and tax both apply. Investigate and patch it.", "Customer ne bataya ki checkout page pe coupon do baar lag jata hai, dekho kyun hota hai aur fix karo"]) {
      expect(await ruled(m, inProject()), m).toMatchObject({ intent: "code_task" });
    }
    // Without a project there is nothing to change; research words without a fix ask stay research; a bare "fix it" still asks what.
    expect((await ruled(report)).intent).not.toBe("code_task");
    expect((await ruled("research the latest auth libraries for node and find out which one is best", inProject())).intent).toBe("research");
    expect((await ruled("how do I fix this error in the login code?", inProject())).intent).not.toBe("research");
  });

  it("works an open-ended task free-form: debugging, investigating, finding out why, and a flaky or intermittent failure", async () => {
    for (const m of ["debug why the checkout sometimes fails and fix it", "debug the intermittent timeout in the upload job and fix it", "figure out why the cart is empty after refresh and fix it", "track down the flaky login test and fix it"]) {
      const d = await ruled(m, inProject());
      expect(d, m).toMatchObject({ intent: "code_task", mode: "freeform" });
    }
    for (const m of ["change the button color to red", "refactor the auth module into smaller functions", "fix the login bug"]) {
      expect((await ruled(m, inProject())).mode, m).toBeUndefined();
    }
    // A question about the code is never a free-form job.
    expect((await ruled("why does the checkout sometimes fail?", inProject())).mode).toBeUndefined();
  });
});
