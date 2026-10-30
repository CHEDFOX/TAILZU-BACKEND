/**
 * THE X0 WIDGET, SERVER SIDE (docs/widget-glance-v2.md; src/widgets/{botWords,situation,glance,glanceStore,digest}.ts, routes/botsShell.ts):
 *
 *   - a bot's widget words: kept when they fit, cut at a word ("…" only when cut, never half a word), wrong ones dropped, never a throw;
 *     the fill-in lines in English and Hinglish when a bot gives nothing; the doing line cut at a word
 *   - the situation line: which situation it is (in order), its line in the part of the day, slots filled, 60 at most
 *   - glance v2: the case (needs, done, working, quiet), the bots in Home's order (8 at most, `more`), what needs the person with the SAME
 *     id and kind as /v1/widgets/now and choice ids POST /v1/widgets/act takes, the job at work, the last thing done (unseen, 2 h), the
 *     week, the Lock Screen's lines never a private question's words, the words in Hinglish
 *   - the route: v1 unchanged for older builds; v2 the person's own; what they have seen and when they last looked remembered
 *   - the AI digest: off by default; on, once per change, cached, length-checked, never told a private question's words, never slow
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { cutAtWord, widgetWords, needsWords, eventLine, fillIn, FILL_INS, WIDGET_LIMITS } = await import("../src/widgets/botWords.js");
const { doingLine } = await import("../src/experience/bots/live.js");
const { situationOf, situationLine, templateFor, SITUATION_RULES } = await import("../src/widgets/situation.js");
const { glanceV2Of, glanceChanges } = await import("../src/widgets/glance.js");
const { MemoryGlanceStore, withSeen, withGlance, unseen, emptyGlanceState } = await import("../src/widgets/glanceStore.js");
const { WIDGETS_DEFAULTS } = await import("../src/widgets/defaults.js");
const { buildNow } = await import("../src/widgets/now.js");
const { QuickActs, MemoryQuickActionStore } = await import("../src/widgets/act.js");
const { digestFor, changeSig, digestUser, usableDigest } = await import("../src/widgets/digest.js");
const { registerBotsShellRoutes } = await import("../src/routes/botsShell.js");
const { jobLite } = await import("../src/experience/bots/deps.js");
const { FIXED_NOW, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");

type GlanceInput = import("../src/widgets/glance.js").GlanceInput;
type JobLite = import("../src/experience/bots/live.js").JobLite;

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const payload = () => structuredClone(WIDGETS_DEFAULTS);
const knobs = (flags: Record<string, unknown> = {}, labels: Record<string, string> = {}) => {
  const p = payload();
  Object.assign(p.flags, flags);
  Object.assign(p.labels, labels);
  return p;
};

// ------------------------------------------------------------------ section 1: a bot's words

describe("a bot's widget words (section 1)", () => {
  it("are cut at a word, with … only when cut, and never in half a word", () => {
    expect(cutAtWord("Fix the cart", 28)).toBe("Fix the cart");
    expect(cutAtWord("  Fix   the\ncart  ", 28)).toBe("Fix the cart");
    const cut = cutAtWord("Round the cart total per item, or once at the end of the order please?", 40);
    expect(cut).toBe("Round the cart total per item, or once…");
    expect(cut.length).toBeLessThanOrEqual(40);
    // the word ends exactly where the room does: kept whole
    expect(cutAtWord("aaaa bbbb cccc", 10)).toBe("aaaa bbbb…");
    // one word longer than the room: no word to cut at
    expect(cutAtWord("Internationalisation", 14)).toBe("");
    expect(cutAtWord("Per item", 14)).toBe("Per item");
    for (let n = 2; n < 60; n++) {
      const s = cutAtWord("The quick brown fox jumps over the lazy dog, again and again", n);
      expect(s.length, String(n)).toBeLessThanOrEqual(n);
      if (s) expect("The quick brown fox jumps over the lazy dog, again and again".startsWith(s.replace(/…$/, ""))).toBe(true);
      if (s.endsWith("…")) expect(s.at(-2)).toMatch(/[a-z]/i);
    }
  });

  it("keep what fits, cut what is long, drop what is wrong, and never throw", () => {
    expect(widgetWords(null)).toEqual({});
    expect(widgetWords("x")).toEqual({});
    expect(widgetWords([1])).toEqual({});
    const w = widgetWords({
      question: "Round the cart total per item, or once at the end? This matters for tax on every single line of the order.",
      choices: ["Per item", "At the very end of it", "Internationalisation", "Fourth"], private: true,
      doing: "reading the cart code and its tests", stage: 3, of: 5, stageName: "Build", result: "Cart fix is ready", problem: "x".repeat(50),
      link: "javascript:alert(1)", pr: { number: 131, url: "https://github.com/a/b/pull/131" },
    });
    expect(w.question!.length).toBeLessThanOrEqual(WIDGET_LIMITS.question);
    expect(w.question!.endsWith("…")).toBe(true);
    expect(w.choices).toEqual(["Per item", "At the very…", ""]);
    expect(w).toMatchObject({ private: true, doing: "reading the cart code and…", stage: 3, of: 5, stageName: "Build", result: "Cart fix is ready", pr: { number: 131 } });
    expect(w.problem).toBeUndefined();
    expect(w.link).toBeUndefined();
    expect(widgetWords({ stage: 6, of: 5, pr: { number: -1, url: "http://x" }, private: "yes" })).toEqual({});
    expect(widgetWords({ link: "tulmi://screen/bots.code" }).link).toBe("tulmi://screen/bots.code");
    expect(needsWords({ result: "x" })).toBeUndefined();
    expect(needsWords({ question: "Per item?", choices: ["A"], result: "x" })).toEqual({ question: "Per item?", choices: ["A"] });
  });

  it("fall back to the server's lines, in English and Hinglish, when a bot gives nothing usable", () => {
    expect(eventLine("needs", undefined, { bot: "Xode" }, FILL_INS.en)).toBe("Xode needs you");
    expect(eventLine("needs", "", { bot: "Xode" }, FILL_INS.hg)).toBe("Xode ko aapki zaroorat hai");
    expect(eventLine("working", undefined, { bot: "Travel bot" }, FILL_INS.en)).toBe("Travel bot is working");
    expect(eventLine("failed", undefined, { bot: "Gym bot" }, FILL_INS.hg)).toBe("Gym bot atak gaya");
    expect(eventLine("idle", undefined, { bot: "Gym bot" }, FILL_INS.en)).toBe("Ready");
    // its own words win, cut to the event's limit
    expect(eventLine("done", "Cart fix is ready", { bot: "Xode", task: "x" }, FILL_INS.en)).toBe("Cart fix is ready");
    expect(eventLine("failed", "The checks failed twice on the payment page tests", { bot: "Xode" }, FILL_INS.en)).toBe("The checks failed twice on the payment…");
    // {task} is cut first, so the bot and the verb stay
    const done = eventLine("done", undefined, { bot: "Xode", task: "fix cart total rounding across every currency" }, FILL_INS.en);
    expect(done).toBe("Xode finished fix cart total rounding…");
    expect(done.length).toBeLessThanOrEqual(40);
    expect(fillIn("{bot} finished {task}", { bot: "Xode", task: "Supercalifragilisticexpialidocious" }, 40)).toBe("Xode finished");
  });

  it("the doing line is the task's first clause, cut at a word (it cut mid-word at 27)", () => {
    expect(doingLine("Fixing cart. Checkout redesign, team of 3")).toBe("fixing cart");
    expect(doingLine("Move the whole sign-in flow to phone OTP and remove passwords")).toBe("move the whole sign-in flow…");
    expect(doingLine("Move the whole sign-in flow to phone OTP and remove passwords").length).toBeLessThanOrEqual(28);
    expect(doingLine("Refactorisationofeverythingintheproject")).toBe("");
  });
});

// ------------------------------------------------------------------ section 3: the situation line

describe("the situation line (section 3)", () => {
  const base = { part: "morning" as const, weekend: false, firstLook: false, moved: 0, working: 0, quietDays: 0, name: "Aanya" };
  const lookup = (key: string) => (WIDGETS_DEFAULTS.labels as Record<string, string>)[key];

  it("picks the first situation that holds, in its order", () => {
    expect(situationOf(base)).toBeNull();
    expect(situationOf({ ...base, weekend: true })?.situation).toBe("weekend");
    expect(situationOf({ ...base, weekend: true, quietDays: 4 })?.situation).toBe("quietLong");
    expect(situationOf({ ...base, weekend: true, quietDays: 4, firstLook: true })?.situation).toBe("firstLook");
    expect(situationOf({ ...base, firstLook: true, longJob: { bot: "Xode", task: "fixing cart", minutes: 45 } })?.situation).toBe("longJob");
    expect(situationOf({ ...base, firstLook: true, longJob: { bot: "Xode", task: "fixing cart", minutes: 5 } })?.situation).toBe("firstLook");
    expect(situationOf({ ...base, working: 2, longJob: { bot: "Xode", task: "x", minutes: 45 } })).toMatchObject({ situation: "severalWorking", vars: { n: 2 } });
    expect(situationOf({ ...base, working: 3, moved: 1 })?.situation).toBe("severalWorking");
    expect(situationOf({ ...base, working: 3, moved: 2 })).toMatchObject({ situation: "moved", vars: { n: 2 } });
    expect(situationOf({ ...base, moved: 5, justFinished: { bot: "Xode", task: "Cart fix is ready" } })).toMatchObject({ situation: "justFinished", vars: { bot: "Xode", task: "Cart fix is ready" } });
    expect(situationOf({ ...base, moved: 2 }, { ...SITUATION_RULES, movedMin: 3 })).toBeNull();
  });

  it("writes it for the part of the day, in English or Hinglish, slots filled, 60 at most", () => {
    expect(situationLine(templateFor(lookup, "moved", "morning", false), { name: "Aanya", n: 3 })).toBe("3 things moved since you last looked");
    expect(situationLine(templateFor(lookup, "moved", "night", false), { name: "Aanya", n: 3 })).toBe("3 things moved while you were away");
    expect(situationLine(templateFor(lookup, "moved", "night", true), { name: "Aanya", n: 3 })).toBe("Aapke peeche 3 cheezein badlin");
    expect(situationLine(templateFor(lookup, "quietLong", "afternoon", false), { name: "Aanya" })).toBe("Quiet for a while, Aanya. Ask anything.");
    expect(situationLine(templateFor(lookup, "quietLong", "afternoon", false), { name: "" })).toBe("Quiet for a while. Ask anything.");
    const long = situationLine(templateFor(lookup, "justFinished", "afternoon", false), { name: "", bot: "Xode", task: "moved the whole sign-in flow to phone OTP and removed passwords" });
    expect(long.startsWith("Xode just finished: moved the whole")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(60);
    // every line the knobs hold fits once its slots are filled
    for (const [key, t] of Object.entries(WIDGETS_DEFAULTS.labels)) {
      if (!key.startsWith("x0.sit.")) continue;
      expect(situationLine(t, { name: "Aanya", bot: "Travel bot", task: "plan the Goa trip for the long weekend", n: 12 }).length, key).toBeLessThanOrEqual(60);
    }
  });
});

// ------------------------------------------------------------------ section 2: glance v2, built

const QUESTION: JobLite = {
  id: "j-ask", task: "Fix cart total rounding", state: "waiting_for_you", waitingOn: "answer",
  question: { text: "Round the cart total per item, or once at the end?", options: ["Per item", "At the end"] },
  spentPaise: 640, createdAt: FIXED_NOW - 40 * MIN, updatedAt: FIXED_NOW - 2 * MIN, phase: "work", startedAt: FIXED_NOW - 40 * MIN,
};
const RUNNING: JobLite = {
  id: "j-run", task: "Fixing cart. Checkout redesign, team of 3", state: "running", waitingOn: null,
  spentPaise: 1960, createdAt: FIXED_NOW - 3 * HOUR, updatedAt: FIXED_NOW - 5 * MIN, phase: "work", startedAt: FIXED_NOW - 58 * MIN,
};
const DONE: JobLite = {
  id: "j-done", task: "Answer the review on PR #128", state: "done", waitingOn: null, spentPaise: 110, createdAt: FIXED_NOW - 90 * MIN,
  updatedAt: FIXED_NOW - 20 * MIN, startedAt: FIXED_NOW - 78 * MIN, result: "Cart fix is ready", pr: { number: 131, url: "https://github.com/aanya/storefront/pull/131" },
};
const APPROVAL = {
  id: "t-1", state: "waiting" as const, title: "Move the dentist to Friday 10 am?", createdAt: FIXED_NOW - HOUR, updatedAt: FIXED_NOW - HOUR,
  approval: { id: "ap-1", connector: "google-calendar", preview: "Update event: Dentist, Friday 10 am", risk: "write" },
};

const input = (o: Partial<GlanceInput> = {}): GlanceInput => ({
  now: FIXED_NOW, tz: IST, hg: false, name: "Aanya", bots: SAMPLE_BOTS, jobs: [QUESTION, RUNNING, DONE], tasks: [APPROVAL], minutesSaved: 124,
  state: { seen: {}, all: 0, sinceAt: FIXED_NOW - 5 * HOUR }, ...o,
});

describe("glance v2 (section 2)", () => {
  it("leads with what matters most: needs, then a finish not seen, then working, then quiet", () => {
    expect(glanceV2Of(input(), payload()).case).toBe("needs");
    expect(glanceV2Of(input({ jobs: [RUNNING, DONE], tasks: [] }), payload()).case).toBe("done");
    expect(glanceV2Of(input({ jobs: [RUNNING, DONE], tasks: [], state: { seen: { "j-done": FIXED_NOW - MIN }, all: 0, sinceAt: null } }), payload()).case).toBe("working");
    expect(glanceV2Of(input({ jobs: [DONE], tasks: [], state: { seen: {}, all: FIXED_NOW - MIN, sinceAt: null } }), payload()).case).toBe("quiet");
    expect(glanceV2Of(input({ jobs: [], tasks: [] }), payload())).toMatchObject({ v: 2, case: "quiet", job: null, needs: { count: 0, items: [] }, counts: { working: 0, needs: 0 }, refreshAfterSec: 900 });
  });

  it("is the doc's shape: greeting, week, bots, needs, job, last done, counts, lock, links, words", () => {
    const g = glanceV2Of(input(), payload());
    expect(g).toMatchObject({
      v: 2, at: FIXED_NOW, refreshAfterSec: 300,
      greeting: { hello: "Good evening, Aanya", line: "Anything to write up before the day ends?", part: "evening" },
      week: { minutesSaved: 124, line: expect.stringMatching(/things? done this week · 2 h saved$/) },
      counts: { working: 1, needs: 2 },
      links: { ask: "tulmi://screen/bots.ask", home: "tulmi://", mic: "tulmi://screen/bots.ask?voice=1" },
      words: { needsYou: "Needs you", ready: "Ready", ask: "Ask any bot…", brand: "X0", youDecide: "You decide", working: "{n} working", step: "Step {stage} of {of}", minIn: "{n} min in", seePr: "See the PR", done: "Done", answered: "Answered", finish: "Open X0 to finish", doneSeePr: "Done · See the PR",
        min: "{n} min", pr: "PR #{n}", sending: "Sending…", gone: "Already answered", failed: "Open X0 to finish" },
      job: {
        id: "j-run", bot: "code", task: "Fixing cart", stage: 3, of: 5, stageName: "Build", stages: ["Understand", "Plan", "Build", "Check", "Ship"],
        startedAt: FIXED_NOW - 58 * MIN, link: "tulmi://screen/bots.code.job?id=j-run", phase: "working",
      },
      lastDone: {
        id: "j-done", bot: "code", botName: "Xode", face: "code", result: "Cart fix is ready", endedAt: FIXED_NOW - 20 * MIN, minutes: 58,
        pr: { number: 131, url: "https://github.com/aanya/storefront/pull/131" }, link: "tulmi://screen/bots.code.job?id=j-done",
      },
    });
    expect(g.week.dots).toBe(Math.min(5, g.week.done));
    expect(typeof g.summary).toBe("string");
    expect(g.summary!.length).toBeLessThanOrEqual(60);
  });

  it("sends the bots in Home's order, 8 at most, each with its face, line and link", () => {
    const g = glanceV2Of(input(), payload());
    expect(g.bots.map((b) => [b.slug, b.state])).toEqual([["code", "needs"], ["plan", "needs"], ["keybot", "idle"], ["travel", "idle"], ["gym-bot", "idle"]]);
    expect(g.bots[0]).toEqual({
      slug: "code", name: "Xode", color: "#4F7A3A", face: "code", faceUrl: "https://api.x0bot.com/blip/bots/head-code.png?v=1",
      state: "needs", needs: 1, working: true, line: "fixing cart", link: "tulmi://screen/bots.code",
    });
    // a person's bot has no head of its own
    expect(g.bots.find((b) => b.slug === "gym-bot")).toMatchObject({ face: null, faceUrl: null, line: "Ready", link: "tulmi://screen/bots.bot?slug=gym-bot" });
    // a connected app's yes is private: its bot's line says only that it needs them
    expect(g.bots.find((b) => b.slug === "plan")!.line).toBe("Plan Ease needs you");
    // done, not seen: after working, before the rest
    const done = glanceV2Of(input({ jobs: [DONE], tasks: [] }), payload());
    expect(done.bots[0]).toMatchObject({ slug: "code", state: "done", line: "Cart fix is ready" });
    // a failed job's bot says its problem
    const failed = glanceV2Of(input({ jobs: [{ ...DONE, state: "failed", reason: "The checks failed twice on the payment page tests", result: undefined }], tasks: [] }), payload());
    expect(failed.bots[0]).toMatchObject({ state: "failed", line: "The checks failed twice on the payment…" });
    expect(failed.lastDone).toMatchObject({ failed: true, result: "The checks failed twice on the payment…" });
    // 8 at most, the rest counted
    const many = Array.from({ length: 9 }, (_, n) => ({ slug: `bot-${n}`, name: `Bot ${n}`, colour: "sea", purpose: "x", builtin: false }));
    const crowded = glanceV2Of(input({ bots: [...SAMPLE_BOTS, ...many] }), payload());
    expect(crowded.bots).toHaveLength(8);
    expect(crowded.more).toBe(SAMPLE_BOTS.length + many.length - 8);
    expect(glanceV2Of(input({ bots: [...SAMPLE_BOTS, ...many] }), knobs({ "x0.bots.max": 3 })).bots).toHaveLength(3);
  });

  it("names what needs the person with the SAME id and kind as /v1/widgets/now, and choice ids POST /v1/widgets/act takes", async () => {
    const g = glanceV2Of(input(), payload());
    expect(g.needs.count).toBe(2);
    // oldest first
    expect(g.needs.items.map((n) => n.kind)).toEqual(["approval", "question"]);
    const [yes, q] = g.needs.items;
    expect(q).toMatchObject({
      kind: "question", bot: "code", botName: "Xode", face: "code", question: "Round the cart total per item, or once at the end?",
      choices: [{ id: "a0", label: "Per item", primary: true }, { id: "a1", label: "At the end" }],
      decideLink: "tulmi://screen/bots.code.job?id=j-ask", private: false, answerable: true, link: "tulmi://screen/bots.code",
    });
    expect(yes).toMatchObject({
      id: "task:t-1:ap-1", kind: "approval", bot: "plan", botName: "Plan Ease", question: "Update event: Dentist, Friday 10 am",
      choices: [{ id: "yes", label: "Yes", primary: true }, { id: "no", label: "No" }], decideLink: "tulmi://screen/bots.approve?task=t-1",
      private: true, answerable: true,
    });
    // the rows of /v1/widgets/now for the same records
    const now = buildNow({
      now: FIXED_NOW, tzOffsetMinutes: IST, inSpaces: false, people: { messages: [], shared: [], tasks: [] }, tokenReady: true,
      needs: { jobs: [QUESTION], approvals: [{ taskId: "t-1", approvalId: "ap-1", title: APPROVAL.title, preview: APPROVAL.approval.preview, risk: "write", who: "Plan Ease", at: APPROVAL.updatedAt, bot: "plan" }], tasks: [], codeBotName: "Xode" },
    }, payload());
    const rows = new Map(now.needs.rows.map((r) => [r.id, r]));
    for (const item of g.needs.items) {
      expect(rows.get(item.id)?.kind, item.id).toBe(item.kind);
      for (const c of item.choices) expect(rows.get(item.id)!.actions!.map((a) => a.id), item.id).toContain(c.id);
    }
    // and the act door answers a glance item with a glance choice: the question's own answer, never words from the phone
    const answered: string[] = [];
    const acts = new QuickActs({
      spaceTasks: null, threads: null, approvals: null,
      jobs: { question: async () => ({ text: QUESTION.question!.text, options: QUESTION.question!.options! }), answer: async (_u, _j, a) => { answered.push(a); return {}; } },
    }, new MemoryQuickActionStore(), () => FIXED_NOW);
    const out = await acts.run("u1", { item: q!.id, action: q!.choices[1]!.id }, { kind: "widget", scopes: ["needs.answer"] }, { inPlaceRisks: ["read", "write", "send"], modes: {}, tokenEnabled: true });
    expect(out).toMatchObject({ status: 200, body: { ok: true, state: "done" } });
    expect(answered).toEqual(["At the end"]);
  });

  it("answers in place only what can be: up to three answers that fit, a risk the server allows, a kind not kept in the app", () => {
    const three = { ...QUESTION, question: { text: "Which?", options: ["Per item", "At the end", "Never"] } };
    expect(glanceV2Of(input({ jobs: [three], tasks: [] }), payload()).needs.items[0]!.choices.map((c) => c.id)).toEqual(["a0", "a1", "a2"]);
    const four = { ...QUESTION, question: { text: "Which?", options: ["A", "B", "C", "D"] } };
    expect(glanceV2Of(input({ jobs: [four], tasks: [] }), payload()).needs.items[0]).toMatchObject({ choices: [], answerable: false });
    const long = { ...QUESTION, question: { text: "Which?", options: ["Internationalisation", "Localisation"] } };
    expect(glanceV2Of(input({ jobs: [long], tasks: [] }), payload()).needs.items[0]).toMatchObject({ answerable: false });
    // the bot's own short labels, one per answer, win
    const own = { ...QUESTION, question: { text: "Which?", options: ["Internationalisation", "Localisation"], widget: { question: "Which one?", choices: ["i18n", "l10n"], private: true } } };
    expect(glanceV2Of(input({ jobs: [own], tasks: [] }), payload()).needs.items[0]).toMatchObject({
      question: "Which one?", choices: [{ id: "a0", label: "i18n", primary: true }, { id: "a1", label: "l10n" }], answerable: true, private: true,
    });
    expect(glanceV2Of(input({ jobs: [QUESTION], tasks: [] }), knobs({ "widgets.needs.modes": { question: "open" } })).needs.items[0]).toMatchObject({ answerable: false, choices: [] });
    expect(glanceV2Of(input({ jobs: [QUESTION], tasks: [] }), knobs({ "widgets.token.enabled": false })).needs.items[0]!.answerable).toBe(false);
    const pay = { ...APPROVAL, approval: { ...APPROVAL.approval, risk: "pay" } };
    expect(glanceV2Of(input({ jobs: [], tasks: [pay] }), payload()).needs.items[0]).toMatchObject({ answerable: false, choices: [] });
    // a yes to a Xode's plan has no /v1/widgets row: open only
    const plan: JobLite = { ...QUESTION, waitingOn: "approval", question: undefined, approval: { summary: "Go ahead with this plan?" } };
    expect(glanceV2Of(input({ jobs: [plan], tasks: [] }), payload()).needs.items[0]).toMatchObject({ kind: "question", question: "Go ahead with this plan?", answerable: false, choices: [] });
    // three at most, the count is all of them
    const more = [1, 2, 3, 4].map((n) => ({ ...APPROVAL, id: `t-${n}`, updatedAt: FIXED_NOW - n * MIN, approval: { ...APPROVAL.approval, id: `ap-${n}` } }));
    const crowded = glanceV2Of(input({ jobs: [], tasks: more }), payload());
    expect(crowded.needs).toMatchObject({ count: 4 });
    expect(crowded.needs.items.map((n) => n.id)).toEqual(["task:t-4:ap-4", "task:t-3:ap-3", "task:t-2:ap-2"]);
  });

  it("never puts a private question's words on the Lock Screen", () => {
    const secret = { ...QUESTION, question: { ...QUESTION.question!, widget: { private: true } } };
    const g = glanceV2Of(input({ jobs: [secret], tasks: [] }), payload());
    expect(g.lock).toEqual({ inline: "Xode needs you", title: "Xode needs you", line: "Open X0 to answer" });
    expect(JSON.stringify(g.lock)).not.toContain("Round");
    const open = glanceV2Of(input({ jobs: [QUESTION], tasks: [] }), payload());
    expect(open.lock).toEqual({ inline: "Xode needs you", title: "Xode needs you", line: "Round the cart total per item, or once…" });
    // a connected app's yes is private unless the knobs say otherwise
    expect(glanceV2Of(input({ jobs: [], tasks: [APPROVAL] }), payload()).lock.line).toBe("Open X0 to answer");
    expect(glanceV2Of(input({ jobs: [], tasks: [APPROVAL] }), knobs({ "x0.needs.private": [] })).lock.line).toBe("Update event: Dentist, Friday 10 am");
    expect(glanceV2Of(input(), payload()).lock.title).toBe("2 things need you");
    expect(glanceV2Of(input({ jobs: [RUNNING, DONE], tasks: [] }), payload()).lock).toEqual({ inline: "Cart fix is ready", title: "Cart fix is ready", line: "PR #131 is ready" });
    expect(glanceV2Of(input({ jobs: [RUNNING], tasks: [] }), payload()).lock).toEqual({ inline: "Xode is working", title: "Xode is working", line: "Step 3 of 5 · Build" });
    expect(glanceV2Of(input({ jobs: [], tasks: [] }), payload()).lock).toMatchObject({ inline: "Ready", title: "X0" });
  });

  it("the last thing done: the newest finished job not seen, at most two hours old", () => {
    expect(glanceV2Of(input({ jobs: [{ ...DONE, updatedAt: FIXED_NOW - 3 * HOUR }], tasks: [] }), payload()).lastDone).toBeUndefined();
    expect(glanceV2Of(input({ jobs: [DONE], tasks: [] }), knobs({ "x0.done.windowMin": 10 })).lastDone).toBeUndefined();
    // opened after it ended: seen; opened before it ended (it was answered, then finished): news again
    expect(glanceV2Of(input({ jobs: [DONE], tasks: [], state: { seen: { "j-done": FIXED_NOW - 10 * MIN }, all: 0, sinceAt: null } }), payload()).lastDone).toBeUndefined();
    expect(glanceV2Of(input({ jobs: [DONE], tasks: [], state: { seen: { "j-done": FIXED_NOW - 30 * MIN }, all: 0, sinceAt: null } }), payload()).lastDone?.id).toBe("j-done");
    // a team's helper is not something a person follows
    expect(glanceV2Of(input({ jobs: [{ ...DONE, helper: true }], tasks: [] }), payload()).lastDone).toBeUndefined();
    // no words of its own: the fill-in, with what it was asked
    expect(glanceV2Of(input({ jobs: [{ ...DONE, result: undefined }], tasks: [] }), payload()).lastDone!.result).toBe("Xode finished answer the review on PR…");
  });

  it("the job: one at work, else one waiting for the person; 300 s while a bot works", () => {
    expect(glanceV2Of(input({ jobs: [QUESTION], tasks: [] }), payload())).toMatchObject({ job: { id: "j-ask", phase: "needs", stage: 3 }, refreshAfterSec: 900 });
    expect(glanceV2Of(input({ jobs: [{ ...RUNNING, phase: "verify" }], tasks: [] }), payload())).toMatchObject({ job: { stage: 4, stageName: "Check" }, refreshAfterSec: 300 });
    expect(glanceV2Of(input({ jobs: [{ ...RUNNING, phase: undefined, startedAt: undefined }], tasks: [] }), payload()).job).toMatchObject({ stage: 1, stageName: "Understand", startedAt: RUNNING.createdAt });
    expect(glanceV2Of(input({ jobs: [{ ...RUNNING, helper: true }], tasks: [] }), payload()).job).toBeNull();
    expect(glanceV2Of(input({ jobs: [RUNNING] }), knobs({ "x0.refreshSec.working": 120 })).refreshAfterSec).toBe(120);
  });

  it("speaks Hinglish when the app does", () => {
    const g = glanceV2Of(input({ hg: true }), payload());
    expect(g.greeting.line).toBe("Din khatam hone se pehle kuch likhwana hai?");
    expect(g.words).toMatchObject({ needsYou: "Aapki zaroorat", ready: "Taiyaar", youDecide: "Aap tay karo", seePr: "PR dekho", answered: "Jawab de diya", doneSeePr: "Ho gaya · PR dekho", sending: "Bhej rahe hain…", pr: "PR #{n}" });
    expect(g.needs.items[0]!.choices.map((c) => c.label)).toEqual(["Haan", "Nahi"]);
    expect(g.lock.title).toBe("2 cheezon mein aapki zaroorat");
    expect(g.week.line).toBe("Is hafte 1 kaam hua · 2 ghante bache");
    expect(g.bots.find((b) => b.slug === "plan")!.line).toBe("Plan Ease ko aapki zaroorat hai");
  });

  it("says what moved since the person last looked, and nothing of a connected app's words", () => {
    const i = input({ state: { seen: {}, all: 0, sinceAt: FIXED_NOW - 4 * HOUR } });
    const changes = glanceChanges(i, payload());
    expect(changes.map((c) => c.kind).sort()).toEqual(["done", "needs", "needs", "started"]);
    expect(changes.find((c) => c.id === "task:t-1:ap-1")).toMatchObject({ words: null });
    expect(glanceChanges(input({ state: { seen: {}, all: 0, sinceAt: null } }), payload())).toEqual([]);
    // the summary counts them, or says what just finished
    expect(glanceV2Of(i, payload()).summary).toBe("Xode wrapped up: Cart fix is ready");
    expect(glanceV2Of({ ...i, jobs: [QUESTION, RUNNING] }, payload()).summary).toBe("3 things moved since you last looked");
    expect(glanceV2Of({ ...i, digest: "Cart fix shipped; 2 things need you" }, payload()).summary).toBe("Cart fix shipped; 2 things need you");
  });
});

// ------------------------------------------------------------------ what the person has seen

describe("the seen marker and the look", () => {
  it("keeps one time per thing (the newest 100) and everything before a time", () => {
    let s = emptyGlanceState();
    s = withSeen(s, { ids: ["a"] }, 10);
    s = withSeen(s, { ids: ["b"] }, 20);
    expect(unseen(s, "a", 5)).toBe(false);
    expect(unseen(s, "a", 15)).toBe(true);
    expect(unseen(s, "c", 15)).toBe(true);
    s = withSeen(s, { all: true }, 30);
    expect(unseen(s, "c", 25)).toBe(false);
    expect(unseen(s, "c", 35)).toBe(true);
    for (let n = 0; n < 150; n++) s = withSeen(s, { ids: [`x${n}`] }, 100 + n);
    expect(Object.keys(s.seen)).toHaveLength(100);
    expect(s.seen.x149).toBe(249);
  });

  it("counts fetches close together as one look", () => {
    let s = emptyGlanceState();
    s = withGlance(s, 1000, 10 * MIN);
    expect(s).toMatchObject({ lastAt: 1000, sinceAt: null });
    s = withGlance(s, 1000 + 5 * MIN, 10 * MIN);
    expect(s).toMatchObject({ lastAt: 1000 + 5 * MIN, sinceAt: null });
    s = withGlance(s, 1000 + 30 * MIN, 10 * MIN);
    expect(s).toMatchObject({ lastAt: 1000 + 30 * MIN, sinceAt: 1000 + 5 * MIN });
    s = withGlance(s, 1000 + 31 * MIN, 10 * MIN);
    expect(s.sinceAt).toBe(1000 + 5 * MIN);
  });
});

// ------------------------------------------------------------------ the route

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (u: string) => ({ authorization: `Bearer ${u}` });

/** A CodeJob as the store keeps it, its agent's state in the checkpoint (what jobLite reads). */
const codeJob = (o: { id: string; task: string; state: string; waitingOn?: string | null; agent?: Record<string, unknown>; createdAt: number; updatedAt: number; reason?: string }) => ({
  id: o.id, userId: "u1", projectId: "p1", branch: "b", task: o.task, state: o.state, placement: "none", waitingOn: o.waitingOn ?? null, reason: o.reason ?? "",
  spentPaise: 10, createdAt: o.createdAt, updatedAt: o.updatedAt,
  checkpoint: { stepIndex: 0, headSha: "", notes: "", ...(o.agent ? { agent: { v: 1, startedAt: o.createdAt, work: {}, ...o.agent } } : {}) },
});

function served(o: { digest?: { on?: boolean; call?: (...a: never[]) => unknown }; now?: { t: number } } = {}) {
  const app = Fastify();
  const clock = o.now ?? { t: FIXED_NOW };
  const jobs = [
    codeJob({
      id: "j-ask", task: "Fix cart total rounding", state: "waiting_for_you", waitingOn: "answer", createdAt: FIXED_NOW - 40 * MIN, updatedAt: FIXED_NOW - 2 * MIN,
      agent: { phase: "work", waiting: { kind: "question", from: "model", question: "Round the cart total per item, or once at the end?", options: ["Per item", "At the end"], widget: { question: "Round per item or at the end?", choices: ["Per item", "At the end"] }, at: 1 } },
    }),
    codeJob({ id: "j-run", task: "Fixing cart. Checkout redesign", state: "running", createdAt: FIXED_NOW - 3 * HOUR, updatedAt: FIXED_NOW - 5 * MIN, agent: { phase: "verify" } }),
    codeJob({
      id: "j-done", task: "Answer the review on PR #128", state: "done", createdAt: FIXED_NOW - 90 * MIN, updatedAt: FIXED_NOW - 20 * MIN,
      agent: { phase: "done", pr: { number: 131, url: "https://github.com/aanya/storefront/pull/131", ready: true }, work: { doneResult: "Cart fix is ready" } },
    }),
  ];
  const glance = new MemoryGlanceStore();
  const deps = {
    rateLimit: RL, media: null, artifacts: null, code: null, bots: null,
    jobs: { listJobs: async (u: string, n: number) => (u === "u1" ? jobs.slice(0, n) : []) },
    connectors: { tasks: { list: async (u: string) => (u === "u1" ? [{ ...APPROVAL, steps: [], approval: { ...APPROVAL.approval, tool: "update_event", widget: { question: "Move the dentist?" } } }] : []) } },
  };
  registerBotsShellRoutes(app, deps as never, {
    now: () => clock.t, minutesSaved: async () => 90, voiceRows: async () => [{ at: FIXED_NOW - 3 * HOUR, words: 300 }],
    glance, profile: async (u) => (u.id === "u1" ? { fullName: "Aanya Sharma", language: "en" } : null), widgetsConfig: () => payload(),
    ...(o.digest ? { digest: o.digest as never } : {}),
  });
  return { app, glance, clock };
}

describe("GET /v1/shell/glance", () => {
  it("is v1, unchanged, without v=2 (older builds)", async () => {
    const { app } = served();
    const g = (await app.inject({ method: "GET", url: `/v1/shell/glance?tz=${IST}`, headers: who("u1") })).json();
    expect(g.v).toBe(1);
    expect(Object.keys(g).sort()).toEqual(["ask", "at", "bots", "job", "keybot", "needs", "v"]);
    expect(g.job).toMatchObject({ id: "j-run", stage: 4, of: 5, stageName: "Check" });
  });

  it("v=2: the person's own, from their records, their name, and the bot's own words", async () => {
    const { app } = served();
    expect((await app.inject({ method: "GET", url: "/v1/shell/glance?v=2" })).statusCode).toBe(401);
    const r = await app.inject({ method: "GET", url: `/v1/shell/glance?v=2&tz=${IST}`, headers: who("u1") });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    const g = r.json();
    expect(g).toMatchObject({
      v: 2, case: "needs", greeting: { hello: "Good evening, Aanya" }, week: { minutesSaved: 90 },
      job: { id: "j-run", stage: 4, stageName: "Check", phase: "working" },
      lastDone: { id: "j-done", result: "Cart fix is ready", pr: { number: 131 } },
      counts: { needs: 2, working: 1 },
    });
    expect(g.needs.items.map((n: { question: string }) => n.question)).toEqual(["Move the dentist?", "Round per item or at the end?"]);
    expect(g.needs.items[1].id).toMatch(/^job:j-ask:[0-9a-f]{8}$/);
    // someone else's glance has none of it
    const theirs = (await app.inject({ method: "GET", url: "/v1/shell/glance?v=2", headers: who("u2") })).json();
    expect(theirs).toMatchObject({ case: "quiet", needs: { count: 0 }, job: null });
    expect(theirs.lastDone).toBeUndefined();
  });

  it("Hinglish by the app's language", async () => {
    const { app } = served();
    const g = (await app.inject({ method: "GET", url: `/v1/shell/glance?v=2&tz=${IST}`, headers: { ...who("u1"), "x-app-language": "hinglish" } })).json();
    expect(g.words.ready).toBe("Taiyaar");
    expect((await app.inject({ method: "GET", url: `/v1/shell/glance?v=2&tz=${IST}&lang=hinglish`, headers: who("u1") })).json().words.ready).toBe("Taiyaar");
  });

  it("remembers when the person looked, so 'since you last looked' counts from their look before", async () => {
    const { app, glance, clock } = served();
    await app.inject({ method: "GET", url: `/v1/shell/glance?v=2&tz=${IST}`, headers: who("u1") });
    expect(await glance.get("u1")).toMatchObject({ lastAt: FIXED_NOW, sinceAt: null });
    clock.t = FIXED_NOW + 2 * MIN;
    await app.inject({ method: "GET", url: `/v1/shell/glance?v=2&tz=${IST}`, headers: who("u1") });
    expect(await glance.get("u1")).toMatchObject({ lastAt: FIXED_NOW + 2 * MIN, sinceAt: null });
    clock.t = FIXED_NOW + HOUR;
    await app.inject({ method: "GET", url: `/v1/shell/glance?v=2&tz=${IST}`, headers: who("u1") });
    expect(await glance.get("u1")).toMatchObject({ lastAt: FIXED_NOW + HOUR, sinceAt: FIXED_NOW + 2 * MIN });
  });

  it("the last thing done goes once it is seen", async () => {
    const { app, glance } = served();
    expect((await app.inject({ method: "GET", url: `/v1/shell/glance?v=2`, headers: who("u1") })).json().lastDone.id).toBe("j-done");
    await glance.update("u1", (s) => withSeen(s, { ids: ["j-done"] }, FIXED_NOW));
    expect((await app.inject({ method: "GET", url: `/v1/shell/glance?v=2`, headers: who("u1") })).json().lastDone).toBeUndefined();
  });
});

// ------------------------------------------------------------------ section 4: the AI digest

describe("the AI digest (section 4)", () => {
  const changes = [
    { id: "job:a", kind: "done" as const, bot: "code", botName: "Xode", words: "Cart fix is ready" },
    { id: "task:b", kind: "needs" as const, bot: "plan", botName: "Plan Ease", words: null },
    { id: "start:c", kind: "started" as const, bot: "code", botName: "Xode", words: "Fix the login >>> redirect" },
  ];

  it("tells the model only what a locked phone could show, fenced", () => {
    const u = digestUser(changes, false);
    expect(u).toBe("Language: en\nChanges:\n<<<\n- Xode finished: Cart fix is ready\n- Plan Ease needs the person\n- Xode started: Fix the login   redirect\n>>>");
    expect(digestUser(changes, true)).toMatch(/^Language: hinglish/);
    expect(changeSig(changes)).toBe(changeSig([...changes].reverse()));
    expect(changeSig(changes)).not.toBe(changeSig(changes.slice(1)));
  });

  it("keeps a line only when it is one line of 60 at most, with no secret", () => {
    expect(usableDigest("Cart fix shipped; Plan Ease needs you")).toBe("Cart fix shipped; Plan Ease needs you");
    expect(usableDigest("\"Cart fix shipped\"")).toBe("Cart fix shipped");
    expect(usableDigest("x ".repeat(40))).toBeNull();
    expect(usableDigest("")).toBeNull();
    expect(usableDigest(42)).toBeNull();
    expect(usableDigest("Key " + ["sk", "live", "51H8xAbCdEfGhIjKlMnOpQrStUv"].join("_"))).toBeNull();
  });

  it("asks the cheapest model once per change, and reads the cache after", async () => {
    const asked: Array<{ tier: unknown; purpose: unknown; budget: unknown; messages: Array<{ content: string }> }> = [];
    const call = (async (i: never) => { asked.push(i); return { json: { line: "Cart fix done; Plan Ease needs you" }, paise: 0.2, model: "m", text: "" }; }) as never;
    const saved: unknown[] = [];
    const d = { call, waitMs: 1000, maxPaise: 5, now: () => FIXED_NOW, save: async (x: unknown) => { saved.push(x); } };
    const line = await digestFor("u1", changes, false, undefined, d);
    expect(line).toBe("Cart fix done; Plan Ease needs you");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ tier: "tiny", purpose: "widget.digest", budget: { maxPaise: 5 } });
    expect(asked[0]!.messages.at(-1)!.content).toBe(digestUser(changes, false));
    expect(saved).toEqual([{ sig: changeSig(changes), line: "Cart fix done; Plan Ease needs you", at: FIXED_NOW }]);
    // the same changes: the cache, no call
    expect(await digestFor("u1", changes, false, saved[0] as never, d)).toBe("Cart fix done; Plan Ease needs you");
    expect(asked).toHaveLength(1);
  });

  it("a line too long, a model down or slow: no line now (the situation line is shown), and not asked again for that change", async () => {
    const saved: unknown[] = [];
    const long = (async () => ({ json: { line: "x".repeat(61) }, paise: 0, model: "m", text: "" })) as never;
    expect(await digestFor("u1", changes, false, undefined, { call: long, waitMs: 1000, maxPaise: 5, now: () => 1, save: async (x) => { saved.push(x); } })).toBeNull();
    expect(saved).toEqual([{ sig: changeSig(changes), line: null, at: 1 }]);
    const down = (async () => { throw new Error("down"); }) as never;
    expect(await digestFor("u1", changes, false, undefined, { call: down, waitMs: 1000, maxPaise: 5, now: () => 1, save: async () => undefined })).toBeNull();
    let release!: () => void;
    const slow = (() => new Promise((res) => { release = () => res({ json: { line: "Late but fine" }, paise: 0, model: "m", text: "" }); })) as never;
    const later: unknown[] = [];
    expect(await digestFor("u1", changes, false, undefined, { call: slow, waitMs: 5, maxPaise: 5, now: () => 2, save: async (x) => { later.push(x); } })).toBeNull();
    release();
    await new Promise((r) => setTimeout(r, 5));
    expect(later).toEqual([{ sig: changeSig(changes), line: "Late but fine", at: 2 }]);
  });

  it("is off by default; on, the route sends it in place of the situation line, and never tells a private question's words", async () => {
    const off = served({ now: { t: FIXED_NOW + HOUR } });
    await off.glance.update("u1", (s) => ({ ...s, lastAt: FIXED_NOW - 5 * HOUR }));
    expect((await off.app.inject({ method: "GET", url: `/v1/shell/glance?v=2&tz=${IST}`, headers: who("u1") })).json().summary).not.toBe("Three things moved");

    const sent: string[] = [];
    const call = (async (i: { messages: Array<{ content: string }> }) => { sent.push(i.messages.at(-1)!.content); return { json: { line: "Three things moved" }, paise: 0, model: "m", text: "" }; });
    const on = served({ digest: { on: true, call: call as never } });
    await on.glance.update("u1", (s) => ({ ...s, lastAt: FIXED_NOW - 5 * HOUR }));
    const g = (await on.app.inject({ method: "GET", url: `/v1/shell/glance?v=2&tz=${IST}`, headers: who("u1") })).json();
    expect(g.summary).toBe("Three things moved");
    expect(sent).toHaveLength(1);
    // the connected app's yes is private: its words never reach the model
    expect(sent[0]).not.toContain("dentist");
    expect(sent[0]).toContain("Plan Ease needs the person");
    expect((await on.glance.get("u1")).digest).toMatchObject({ line: "Three things moved" });
    // the same changes on the next glance: the cache
    await on.app.inject({ method: "GET", url: `/v1/shell/glance?v=2&tz=${IST}`, headers: who("u1") });
    expect(sent).toHaveLength(1);
  });
});
